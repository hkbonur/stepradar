import { v } from 'convex/values'
import { variantRate } from '@influstep/shared'
import { mutation, query } from '../_generated/server'
import { applyExperimentDecision, measurableMetrics, experimentStats, startExperiment, stopExperiment } from '../core/experiments'
import { experimentKindValidator, experimentMetricValidator, variantValidator } from '../lib/validators'
import { accountRefOf } from '../core/accounts'

export const list = query({
  args: { accountId: v.optional(v.id('accounts')) },
  handler: async (ctx, args) => {
    const all = await ctx.db.query('experiments').collect()
    const out = []
    for (const experiment of all) {
      if (args.accountId && experiment.accountId !== args.accountId) continue
      const account = await ctx.db.get(experiment.accountId)
      if (!account) throw new Error(`account ${experiment.accountId} of experiment ${experiment._id} not found`)
      const { stats, leftOut } = await experimentStats(ctx, experiment)
      out.push({
        ...experiment,
        // Rows from before the strategy review were all set up by the operator, so an absent value means the operator.
        createdBy: experiment.createdBy ?? ('operator' as const),
        account: accountRefOf(account),
        stats: stats.map((stat) => ({ ...stat, rate: variantRate(stat) })),
        leftOut,
      })
    }
    return out.sort((a, b) => (a.status === b.status ? b.createdAt - a.createdAt : a.status === 'running' ? -1 : 1))
  },
})

/** The metrics a dimension can be decided on for the account, and why not every one: what the new experiment form offers. */
export const measurable = query({
  args: { accountId: v.id('accounts'), kind: experimentKindValidator },
  handler: async (ctx, args) => {
    const account = await ctx.db.get(args.accountId)
    if (!account) throw new Error(`account ${args.accountId} not found`)
    return measurableMetrics(ctx, account, args.kind)
  },
})

export const create = mutation({
  args: {
    accountId: v.id('accounts'),
    name: v.string(),
    hypothesis: v.string(),
    kind: experimentKindValidator,
    metric: experimentMetricValidator,
    variants: v.array(variantValidator),
    minItems: v.number(),
    minConfidence: v.number(),
  },
  handler: async (ctx, args) => {
    const account = await ctx.db.get(args.accountId)
    if (!account) throw new Error(`account ${args.accountId} not found`)
    return startExperiment(ctx, account, {
      name: args.name,
      hypothesis: args.hypothesis,
      kind: args.kind,
      metric: args.metric,
      variants: args.variants,
      minItems: args.minItems,
      minConfidence: args.minConfidence,
      createdBy: 'operator',
      // The operator's reason for an experiment is the hypothesis they wrote.
      reason: args.hypothesis,
    })
  },
})

export const stop = mutation({
  args: { experimentId: v.id('experiments') },
  handler: async (ctx, args) => {
    await stopExperiment(ctx, args.experimentId, { actor: 'operator' })
  },
})

/** The operator's own verdict, recorded as such: it lands like the analyst's, with no lift and no confidence of its own. */
export const override = mutation({
  args: { experimentId: v.id('experiments'), winnerKey: v.string(), note: v.string() },
  handler: async (ctx, args) => {
    const experiment = await ctx.db.get(args.experimentId)
    if (!experiment) throw new Error('experiment not found')
    await applyExperimentDecision(ctx, experiment, { winnerKey: args.winnerKey, lift: 0, confidence: 0 }, 'operator', args.note)
  },
})
