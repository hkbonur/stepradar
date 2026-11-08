import { v } from 'convex/values'
import { internalMutation } from '../_generated/server'
import type { Doc } from '../_generated/dataModel'
import { claimDue as claimDueRule, queueMorningDigests, recordDelivery } from '../core/notifications'
import { providersMode } from '../lib/env'
import { pushOutcomeValidator } from '../lib/validators'

/** The notifications due now, claimed for one push run, and the devices to push them to (internal/push.ts). */
export const claimDue = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ notifications: Doc<'notifications'>[]; devices: Doc<'pushSubscriptions'>[] }> => ({
    notifications: await claimDueRule(ctx, Date.now()),
    devices: await ctx.db.query('pushSubscriptions').collect(),
  }),
})

export const delivered = internalMutation({
  args: {
    notificationId: v.id('notifications'),
    outcomes: v.array(v.object({ subscriptionId: v.id('pushSubscriptions'), outcome: pushOutcomeValidator })),
  },
  handler: async (ctx, args) => recordDelivery(ctx, args.notificationId, args.outcomes, Date.now()),
})

/** The morning digests: what waits on the operator, at DIGEST_HOUR in each account's timezone, when anything does. */
export const morningDigest = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ queued: number }> => {
    const workspace = await ctx.db.query('workspaces').first()
    if (!workspace) return { queued: 0 }
    return { queued: await queueMorningDigests(ctx, workspace, { now: Date.now(), mock: providersMode() === 'mock' }) }
  },
})
