import { JOB_KINDS, type JobKind } from '@influstep/shared'
import { internal } from '../_generated/api'
import type { Id } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'
import type { JudgedWords } from '../lib/validators'

/** The one place a job is created: every job works for one account, and is scheduled right away. */
export async function enqueueJob(
  ctx: MutationCtx,
  args: {
    kind: JobKind
    accountId: Id<'accounts'>
    postId?: Id<'posts'>
    /** The operator's chat message that asked for the job, for a chat task. */
    messageId?: Id<'messages'>
    /** The Monday of the week a plan_week plans. */
    weekStart?: string
    /** The topic a chat task was asked on, trimmed; absent when the message named none. */
    topic?: string
    /** Whose words a judge_post reads. */
    wordsBy?: JudgedWords
  }
): Promise<Id<'jobs'>> {
  const meta = JOB_KINDS[args.kind]
  const jobId = await ctx.db.insert('jobs', {
    kind: args.kind,
    role: meta.role,
    status: 'queued',
    accountId: args.accountId,
    postId: args.postId,
    messageId: args.messageId,
    weekStart: args.weekStart,
    topic: args.topic,
    wordsBy: args.wordsBy,
    attempts: 0,
    createdAt: Date.now(),
  })
  await ctx.scheduler.runAfter(0, internal.internal.dispatch.runJob, { jobId })
  return jobId
}

export async function markRunning(ctx: MutationCtx, jobId: Id<'jobs'>): Promise<void> {
  const job = await ctx.db.get(jobId)
  if (!job) throw new Error(`job ${jobId} not found`)
  await ctx.db.patch(jobId, { status: 'running', startedAt: Date.now(), attempts: job.attempts + 1 })
}

export async function markDone(ctx: MutationCtx, jobId: Id<'jobs'>, result: unknown): Promise<void> {
  await ctx.db.patch(jobId, { status: 'done', result, finishedAt: Date.now(), error: undefined })
}

export async function markFailed(ctx: MutationCtx, jobId: Id<'jobs'>, error: string): Promise<void> {
  await ctx.db.patch(jobId, { status: 'failed', error, finishedAt: Date.now() })
}
