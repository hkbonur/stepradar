import { v } from 'convex/values'
import { mutation } from '../_generated/server'
import { planLaunch } from '../core/launch'
import { refusal } from '../lib/errors'

/** Plan a launch on the day the operator picks: one post per account that can announce it (core/launch.ts). */
export const plan = mutation({
  args: { day: v.string(), what: v.string() },
  handler: async (ctx, args) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.day)) throw refusal('Pick the day of the launch.')
    return planLaunch(ctx, { day: args.day, what: args.what, now: Date.now() })
  },
})
