import { v } from 'convex/values'
import { internal } from '../_generated/api'
import type { Id } from '../_generated/dataModel'
import { mutation, query } from '../_generated/server'

/** The account's newest jobs, newest first. */
export const recent = query({
  args: { accountId: v.id('accounts') },
  handler: async (ctx, args) =>
    ctx.db
      .query('jobs')
      .withIndex('by_account', (q) => q.eq('accountId', args.accountId))
      .order('desc')
      .take(50),
})

export const retry = mutation({
  args: { jobId: v.id('jobs') },
  handler: async (ctx, args): Promise<Id<'jobs'>> => ctx.runMutation(internal.internal.dispatch.retryJob, { jobId: args.jobId }),
})
