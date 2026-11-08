import type { NotificationPayload } from '@influstep/shared'

/** A device the operator turned notifications on in: the push service's endpoint and the keys the payload is encrypted to. */
export interface PushDevice {
  endpoint: string
  p256dh: string
  auth: string
}

/**
 * What one device made of a push: it went out, the mock recorded it without
 * pushing, the push service no longer knows the device (404 or 410, so it is
 * removed), or it failed with the error.
 */
export type PushOutcome = { kind: 'sent' } | { kind: 'recorded' } | { kind: 'gone' } | { kind: 'failed'; error: string }

/** The notifier (docs/plan.md, "Notifier: web push"): web push in real mode, a recorder in mock mode. */
export interface NotifierProvider {
  readonly name: string
  send(device: PushDevice, payload: NotificationPayload): Promise<PushOutcome>
}
