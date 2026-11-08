/**
 * Web push in the browser (docs/plan.md, "Notifier: web push"): whether this
 * device can show the notifier's pushes, and its subscription for the
 * backend to push to.
 */

/**
 * What this browser can do with notifications: show them; show them only
 * once the studio is on the Home Screen (an iPhone or iPad, iOS 16.4 or
 * later); or not at all.
 */
export type PushSupport = { kind: 'supported' } | { kind: 'home-screen' } | { kind: 'unsupported' }

export function pushSupport(): PushSupport {
  // An iPad says it is a Mac; a Mac has no touch screen.
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
  const standalone = window.matchMedia('(display-mode: standalone)').matches
  if (ios && !standalone) return { kind: 'home-screen' }
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return { kind: 'unsupported' }
  return { kind: 'supported' }
}

/** A VAPID public key as the push service takes it: the base64url text decoded to bytes. */
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64url
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(base64url.length / 4) * 4, '=')
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
}

/** This device as the Providers page lists it, e.g. "Chrome on macOS". */
export function deviceLabel(): string {
  const agent = navigator.userAgent
  const browser = /Edg\//.test(agent)
    ? 'Edge'
    : /Firefox\//.test(agent)
      ? 'Firefox'
      : /Chrome\//.test(agent)
        ? 'Chrome'
        : /Safari\//.test(agent)
          ? 'Safari'
          : 'A browser'
  const system = /iPhone/.test(agent)
    ? 'iPhone'
    : /iPad/.test(agent)
      ? 'iPad'
      : /Android/.test(agent)
        ? 'Android'
        : /Mac OS X/.test(agent)
          ? 'macOS'
          : /Windows/.test(agent)
            ? 'Windows'
            : 'Linux'
  return `${browser} on ${system}`
}

/** Whether this device already gets the notifier's pushes. */
export async function deviceSubscribed(): Promise<boolean> {
  const registration = await navigator.serviceWorker.ready
  return (await registration.pushManager.getSubscription()) !== null
}

/** The keys a push is encrypted to, as the backend stores them. */
export interface DeviceSubscription {
  endpoint: string
  p256dh: string
  auth: string
}

/**
 * Asks for permission (the browser asks only after a click) and subscribes
 * this device with the deployment's VAPID public key. Null when the
 * operator declined.
 */
export async function subscribeDevice(publicKey: string): Promise<DeviceSubscription | null> {
  if ((await Notification.requestPermission()) !== 'granted') return null
  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) })
  const { endpoint, keys } = subscription.toJSON()
  if (!endpoint || !keys?.p256dh || !keys.auth) throw new Error('The browser gave a push subscription without its keys.')
  return { endpoint, p256dh: keys.p256dh, auth: keys.auth }
}
