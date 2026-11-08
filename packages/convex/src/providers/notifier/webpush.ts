'use node'

import webpush from 'web-push'
import { requireEnv } from '../../lib/env'
import type { NotifierProvider } from './types'

/** How long a push service keeps a push for a device that is offline: a comment a day old is still worth showing. */
const PUSH_TTL_SECONDS = 24 * 3600

/**
 * Web push with the deployment's VAPID keys (`VAPID_PUBLIC_KEY`,
 * `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`); a missing one is an error that
 * names it (ADR 0002). Runs in a Node action only.
 */
export const webPushNotifier: NotifierProvider = {
  name: 'web push',
  async send(device, payload) {
    const vapid = {
      subject: requireEnv('VAPID_SUBJECT'),
      publicKey: requireEnv('VAPID_PUBLIC_KEY'),
      privateKey: requireEnv('VAPID_PRIVATE_KEY'),
    }
    try {
      await webpush.sendNotification(
        { endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } },
        JSON.stringify(payload),
        {
          TTL: PUSH_TTL_SECONDS,
          vapidDetails: vapid,
        }
      )
      return { kind: 'sent' }
    } catch (caught) {
      if (caught instanceof webpush.WebPushError && (caught.statusCode === 404 || caught.statusCode === 410)) return { kind: 'gone' }
      return { kind: 'failed', error: caught instanceof Error ? caught.message : String(caught) }
    }
  },
}
