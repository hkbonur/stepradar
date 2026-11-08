import { v } from 'convex/values'
import { quietHoursProblems } from '@influstep/shared'
import type { Doc, Id } from '../_generated/dataModel'
import { mutation, query } from '../_generated/server'
import { requireWorkspace } from '../core/workspace'
import { refusal } from '../lib/errors'
import { quietHoursValidator } from '../lib/validators'

/** How many notifications Today lists. */
const RECENT = 20

/** The newest notifications, as Today's in-app list shows them; in mock mode they are all there is. */
export const recent = query({
  args: {},
  handler: async (ctx): Promise<Doc<'notifications'>[]> => ctx.db.query('notifications').order('desc').take(RECENT),
})

/**
 * The devices the operator turned notifications on in, the key a browser
 * subscribes with (null until `VAPID_PUBLIC_KEY` is set), the quiet hours
 * and the newest push error, for Providers and the button.
 */
export const settings = query({
  args: {},
  handler: async (ctx) => {
    const workspace = await ctx.db.query('workspaces').first()
    const devices = await ctx.db.query('pushSubscriptions').collect()
    // The newest push that finished: a failure shows until a later push goes out.
    const finished = (await ctx.db.query('notifications').order('desc').take(RECENT)).find(
      (notification) => notification.status === 'sent' || notification.status === 'failed'
    )
    return {
      publicKey: process.env.VAPID_PUBLIC_KEY ?? null,
      devices: devices.map((device) => ({
        _id: device._id,
        label: device.label,
        createdAt: device.createdAt,
        lastOkAt: device.lastOkAt ?? null,
      })),
      quietHours: workspace?.quietHours ?? null,
      lastError:
        finished?.status === 'failed' && finished.error !== undefined
          ? { error: finished.error, at: finished.sentAt ?? finished.dueAt }
          : null,
    }
  },
})

/** A device turned notifications on: its browser's push subscription, kept once per endpoint. */
export const subscribe = mutation({
  args: { endpoint: v.string(), p256dh: v.string(), auth: v.string(), label: v.string() },
  handler: async (ctx, args): Promise<Id<'pushSubscriptions'>> => {
    const existing = await ctx.db
      .query('pushSubscriptions')
      .withIndex('by_endpoint', (q) => q.eq('endpoint', args.endpoint))
      .first()
    if (existing) {
      await ctx.db.patch(existing._id, { p256dh: args.p256dh, auth: args.auth, label: args.label })
      return existing._id
    }
    return ctx.db.insert('pushSubscriptions', { ...args, createdAt: Date.now() })
  },
})

export const removeDevice = mutation({
  args: { subscriptionId: v.id('pushSubscriptions') },
  handler: async (ctx, args) => {
    if ((await ctx.db.get(args.subscriptionId)) !== null) await ctx.db.delete(args.subscriptionId)
  },
})

/** The operator's quiet hours, or none. */
export const setQuietHours = mutation({
  args: { quietHours: v.union(quietHoursValidator, v.null()) },
  handler: async (ctx, args) => {
    const workspace = await requireWorkspace(ctx)
    if (args.quietHours === null) {
      await ctx.db.patch(workspace._id, { quietHours: undefined })
      return
    }
    const [problem] = quietHoursProblems(args.quietHours)
    if (problem) throw refusal(problem)
    await ctx.db.patch(workspace._id, { quietHours: args.quietHours })
  },
})
