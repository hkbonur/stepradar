import { v } from 'convex/values'
import { canApply, isChatTask, type JobKind } from '@influstep/shared'
import { internal } from '../_generated/api'
import type { Doc, Id } from '../_generated/dataModel'
import { internalAction, internalMutation, internalQuery, type ActionCtx } from '../_generated/server'
import { reportChatTaskFailure } from '../core/chat'
import { applyEvent } from '../core/pipeline'
import { enqueueJob, markDone, markFailed, markRunning } from '../jobs/queue'
import { refusal } from '../lib/errors'
import type { JudgedWords } from '../lib/validators'

/**
 * Runs one job. Every agent action is reached from here, so a job's row
 * carries what happened: running, done with a result, or failed with the
 * error. A post-bound job that fails also fails the post; a chat task that
 * fails says so in the chat it was asked in.
 */

const RUNNERS: Record<JobKind, (ctx: ActionCtx, job: Doc<'jobs'>) => Promise<unknown>> = {
  poll_signals: (ctx, job) => ctx.runAction(internal.internal.researcher.pollSignals, { accountId: job.accountId }),
  morning_sweep: (ctx, job) => ctx.runAction(internal.internal.researcher.morningSweep, { accountId: job.accountId }),
  plan_week: (ctx, job) => ctx.runMutation(internal.internal.writer.planWeek, { accountId: job.accountId, weekStart: weekStartOf(job) }),
  write_post: (ctx, job) => ctx.runAction(internal.internal.writer.writePost, { postId: postIdOf(job) }),
  judge_post: (ctx, job) => ctx.runAction(internal.internal.judge.judgePost, { postId: postIdOf(job), wordsBy: wordsByOf(job) }),
  poll_comments: (ctx, job) => ctx.runAction(internal.internal.comments.poll, { accountId: job.accountId }),
  pull_metrics: (ctx, job) => ctx.runAction(internal.internal.analyst.pullMetrics, { accountId: job.accountId }),
  pull_probable: (ctx) => ctx.runAction(internal.internal.analyst.pullProbable, {}),
  import_history: (ctx, job) => ctx.runAction(internal.internal.researcher.importHistory, { accountId: job.accountId }),
  learn_voice: (ctx, job) => ctx.runAction(internal.internal.analyst.learnVoice, { accountId: job.accountId }),
  listen: (ctx, job) => ctx.runAction(internal.internal.replies.listen, { accountId: job.accountId }),
  write_replies: (ctx, job) => ctx.runAction(internal.internal.replies.writeReplies, { accountId: job.accountId }),
  match: (ctx, job) => ctx.runAction(internal.internal.match.match, { accountId: job.accountId }),
  review_strategy: (ctx, job) => ctx.runMutation(internal.internal.analyst.reviewStrategy, { accountId: job.accountId }),
  // A chat task reads its account, its topic and the message it answers from its own row.
  research_brief: (ctx, job) => ctx.runAction(internal.internal.chat.runTask, { jobId: job._id }),
  comment_digest: (ctx, job) => ctx.runAction(internal.internal.chat.runTask, { jobId: job._id }),
  analytics_summary: (ctx, job) => ctx.runAction(internal.internal.chat.runTask, { jobId: job._id }),
}

function weekStartOf(job: Doc<'jobs'>): string {
  if (job.weekStart === undefined) throw new Error(`${job.kind} job ${job._id} has no weekStart`)
  return job.weekStart
}

function wordsByOf(job: Doc<'jobs'>): JudgedWords {
  if (job.wordsBy === undefined) throw new Error(`${job.kind} job ${job._id} has no wordsBy`)
  return job.wordsBy
}

function postIdOf(job: Doc<'jobs'>): Id<'posts'> {
  if (job.postId === undefined) throw new Error(`${job.kind} job ${job._id} has no post`)
  return job.postId
}

export const runJob = internalAction({
  args: { jobId: v.id('jobs') },
  handler: async (ctx, args): Promise<void> => {
    const job = await ctx.runQuery(internal.internal.dispatch.getJob, { jobId: args.jobId })
    if (!job) throw new Error(`job ${args.jobId} not found`)
    if (job.status !== 'queued') return
    const run = RUNNERS[job.kind]
    await ctx.runMutation(internal.internal.dispatch.setRunning, { jobId: args.jobId })
    try {
      const result = await run(ctx, job)
      await ctx.runMutation(internal.internal.dispatch.setDone, { jobId: args.jobId, result })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await ctx.runMutation(internal.internal.dispatch.setFailed, { jobId: args.jobId, error: message })
      // Only a failed write fails its post: a judgment that fails leaves the draft as it was written.
      if (job.postId && job.kind === 'write_post')
        await ctx.runMutation(internal.internal.dispatch.failPost, { postId: job.postId, error: message })
    }
  },
})

export const getJob = internalQuery({
  args: { jobId: v.id('jobs') },
  handler: async (ctx, args): Promise<Doc<'jobs'> | null> => ctx.db.get(args.jobId),
})

/** Fails the post when its status allows it; a posted, measured or killed post keeps its state. */
export const failPost = internalMutation({
  args: { postId: v.id('posts'), error: v.string() },
  handler: async (ctx, args) => {
    const post = await ctx.db.get(args.postId)
    if (!post) return
    if (!canApply(post.status, 'failed')) return
    await applyEvent(ctx, post, { type: 'failed', error: args.error })
  },
})

export const setRunning = internalMutation({
  args: { jobId: v.id('jobs') },
  handler: async (ctx, args) => markRunning(ctx, args.jobId),
})

export const setDone = internalMutation({
  args: { jobId: v.id('jobs'), result: v.any() },
  handler: async (ctx, args) => markDone(ctx, args.jobId, args.result),
})

export const setFailed = internalMutation({
  args: { jobId: v.id('jobs'), error: v.string() },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId)
    if (!job) throw new Error(`job ${args.jobId} not found`)
    await markFailed(ctx, args.jobId, args.error)
    // The task's own action posts nothing when it throws, so this is the one failure message.
    if (isChatTask(job.kind)) await reportChatTaskFailure(ctx, job, args.error)
  },
})

/**
 * Retry a failed job: a fresh row with the same fields, so the audit trail
 * keeps the failure. Nothing of a killed post runs again.
 */
export const retryJob = internalMutation({
  args: { jobId: v.id('jobs') },
  handler: async (ctx, args): Promise<Id<'jobs'>> => {
    const job = await ctx.db.get(args.jobId)
    if (!job) throw new Error(`job ${args.jobId} not found`)
    if (job.postId !== undefined) {
      const post = await ctx.db.get(job.postId)
      if (!post) throw new Error(`post ${job.postId} of job ${job._id} not found`)
      if (post.status === 'killed') throw refusal(`"${post.title}" was killed; its jobs do not run again.`)
    }
    return enqueueJob(ctx, {
      kind: job.kind,
      accountId: job.accountId,
      postId: job.postId,
      messageId: job.messageId,
      weekStart: job.weekStart,
      topic: job.topic,
    })
  },
})
