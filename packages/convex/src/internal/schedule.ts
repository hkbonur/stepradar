import { SIGNAL_TTL_MS, signalAgesOut } from '@influstep/shared'
import { internalMutation } from '../_generated/server'
import { addDays, dayKey, weekStart } from '../core/dates'
import { queueDuePosts } from '../core/posts'
import { listens } from '../core/formats'
import { enqueueJob } from '../jobs/queue'
import { accountReader } from '../core/connections'
import { awaitsMatch } from '../core/match'
import { commentTargets } from '../core/comments'
import { activeAccounts } from '../core/accounts'

/** One job per active account for each cron, so every run shows up in the jobs table. */

export const pollSignals = internalMutation({
  args: {},
  handler: async (ctx) => {
    for (const account of await activeAccounts(ctx)) {
      await enqueueJob(ctx, { kind: 'poll_signals', accountId: account._id })
    }
  },
})

/**
 * The comment poll for every active account whose reader hears its mentions,
 * or reads comments and has something posted within COMMENT_WINDOW_MS to
 * read under.
 */
export const pollComments = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now()
    for (const account of await activeAccounts(ctx)) {
      const reader = await accountReader(ctx, account)
      const under = reader.comments !== undefined && (await commentTargets(ctx, account._id, now)).length > 0
      if (!reader.mentions && !under) continue
      await enqueueJob(ctx, { kind: 'poll_comments', accountId: account._id })
    }
  },
})

/** The researcher's morning: poll the sources, log repeated questions as problems, write the daily brief. */
export const morningSweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    for (const account of await activeAccounts(ctx)) {
      await enqueueJob(ctx, { kind: 'morning_sweep', accountId: account._id })
    }
  },
})

/**
 * Tomorrow's posts, after the sweep (core `queueDuePosts`): no args, so
 * `npx convex run internal/schedule:writeDuePosts` runs it by hand.
 */
export const writeDuePosts = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ queued: number; skipped: number }> => {
    const now = Date.now()
    let queued = 0
    let skipped = 0
    for (const account of await activeAccounts(ctx)) {
      const outcome = await queueDuePosts(ctx, account, now)
      queued += outcome.queued
      skipped += outcome.skipped
    }
    return { queued, skipped }
  },
})

/** The listener's sweep for every active account that answers people (a reply budget above zero) and whose reader searches. */
export const listen = internalMutation({
  args: {},
  handler: async (ctx) => {
    for (const account of await activeAccounts(ctx)) {
      if (!listens(account)) continue
      const reader = await accountReader(ctx, account)
      if (!reader.search) continue
      await enqueueJob(ctx, { kind: 'listen', accountId: account._id })
    }
  },
})

/** The match for every active account whose reader lists its posts and that has something to find (core `awaitsMatch`). */
export const match = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now()
    for (const account of await activeAccounts(ctx)) {
      if (!(await accountReader(ctx, account)).activity) continue
      if (!(await awaitsMatch(ctx, account._id, now))) continue
      await enqueueJob(ctx, { kind: 'match', accountId: account._id })
    }
  },
})

export const pullMetrics = internalMutation({
  args: {},
  handler: async (ctx) => {
    const accounts = await activeAccounts(ctx)
    for (const account of accounts) {
      await enqueueJob(ctx, { kind: 'pull_metrics', accountId: account._id })
    }
    // The probable conversions are the workspace's, read once; the job is listed under the first account.
    const [first] = accounts
    if (first) await enqueueJob(ctx, { kind: 'pull_probable', accountId: first._id })
  },
})

export const planNextWeek = internalMutation({
  args: {},
  handler: async (ctx) => {
    for (const account of await activeAccounts(ctx)) {
      const nextMonday = addDays(weekStart(dayKey(Date.now(), account.timezone)), 7)
      await enqueueJob(ctx, { kind: 'plan_week', accountId: account._id, weekStart: nextMonday })
    }
  },
})

/** The weekly strategy review, queued before the week is planned so the plan follows the fresh strategy. */
export const reviewStrategies = internalMutation({
  args: {},
  handler: async (ctx) => {
    for (const account of await activeAccounts(ctx)) {
      await enqueueJob(ctx, { kind: 'review_strategy', accountId: account._id })
    }
  },
})

export const ageOutSignals = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - SIGNAL_TTL_MS
    const old = await ctx.db
      .query('signals')
      .withIndex('by_found', (q) => q.lt('foundAt', cutoff))
      .collect()
    for (const signal of old) if (signalAgesOut(signal)) await ctx.db.delete(signal._id)
  },
})
