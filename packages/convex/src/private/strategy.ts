import { v } from 'convex/values'
import type { Id } from '../_generated/dataModel'
import { mutation, query } from '../_generated/server'
import { strategyView } from '../core/strategy'
import { enqueueJob } from '../jobs/queue'
import { refusal } from '../lib/errors'

/** What the strategy page reads beside the account and its experiments: its learnings, its journal and its newest review job. */
export const get = query({
  args: { accountId: v.id('accounts') },
  handler: async (ctx, args) => {
    const account = await ctx.db.get(args.accountId)
    if (!account) return null
    return strategyView(ctx, account)
  },
})

/** Review the account's strategy now rather than on Monday. One review at a time per account. */
export const reviewNow = mutation({
  args: { accountId: v.id('accounts') },
  handler: async (ctx, args): Promise<Id<'jobs'>> => {
    const account = await ctx.db.get(args.accountId)
    if (!account) throw new Error(`account ${args.accountId} not found`)
    const jobs = await ctx.db
      .query('jobs')
      .withIndex('by_account', (q) => q.eq('accountId', account._id))
      .collect()
    const pending = jobs.find((job) => job.kind === 'review_strategy' && (job.status === 'queued' || job.status === 'running'))
    if (pending) throw refusal(`${account.name} is already reviewing the strategy.`)
    return enqueueJob(ctx, { kind: 'review_strategy', accountId: account._id })
  },
})
