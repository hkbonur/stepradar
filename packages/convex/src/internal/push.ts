'use node'

import { internal } from '../_generated/api'
import type { Id } from '../_generated/dataModel'
import { internalAction } from '../_generated/server'
import { notifierProvider, type PushOutcome } from '../providers/notifier'

/**
 * The notifier's run: it claims the notifications due, pushes each to every
 * device the operator turned notifications on in, and records what each
 * device made of it. Scheduled when a notification is queued, for its due
 * time, and every ten minutes as a sweep.
 */
export const sendDue = internalAction({
  args: {},
  handler: async (ctx): Promise<{ pushed: number }> => {
    const { notifications, devices } = await ctx.runMutation(internal.internal.notifications.claimDue, {})
    const notifier = notifierProvider()
    for (const notification of notifications) {
      const payload = { title: notification.title, body: notification.body, url: notification.url, tag: notification.tag }
      const outcomes: { subscriptionId: Id<'pushSubscriptions'>; outcome: PushOutcome }[] = []
      for (const device of devices) {
        // A missing VAPID key is written on the notification, naming the key, so Providers shows it.
        const outcome: PushOutcome = await notifier.send(device, payload).catch((caught: unknown) => ({
          kind: 'failed' as const,
          error: caught instanceof Error ? caught.message : String(caught),
        }))
        outcomes.push({ subscriptionId: device._id, outcome })
      }
      await ctx.runMutation(internal.internal.notifications.delivered, { notificationId: notification._id, outcomes })
    }
    return { pushed: notifications.length }
  },
})
