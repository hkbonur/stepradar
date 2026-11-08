import { api } from '@influstep/convex/_generated/api'
import { useRouter } from '@tanstack/react-router'
import { useQuery } from 'convex/react'
import type { FunctionReturnType } from 'convex/server'
import { NotificationsButton } from './notifications-button'
import { Card, Skeleton } from './ui'
import { formatTime, plural, relativeTime } from '@/lib/format'

type Notification = FunctionReturnType<typeof api.private.notifications.recent>[number]

/** How many notifications the home page lists. */
const SHOWN = 5

/**
 * The notifier's newest notifications (docs/plan.md, slice 6): what it pushed
 * or holds for the end of the quiet hours. In mock mode nothing is pushed,
 * so this list is all there is.
 */
export function NotificationList() {
  const notifications = useQuery(api.private.notifications.recent, {})
  const router = useRouter()
  if (notifications === undefined) return <Skeleton className="h-40 rounded-xl" />
  return (
    <Card title="Notifications" footer={<NotificationsButton />} flush>
      {notifications.length === 0 && (
        <p className="card-x py-4 text-sm text-ash">Nothing yet. A comment under what you posted shows here and on your devices.</p>
      )}
      <ul className="divide-y divide-mist empty:hidden">
        {notifications.slice(0, SHOWN).map((notification) => (
          <li key={notification._id} className="card-x py-3 text-sm">
            <a
              href={notification.url}
              onClick={(event) => {
                // The studio moves to the page without reloading; the address is the push's own, for the service worker too.
                event.preventDefault()
                router.history.push(notification.url)
              }}
              className="block min-w-0 hover:underline"
            >
              <span className="font-medium">{notification.title}</span>
              <span className="mt-0.5 line-clamp-2 block text-graphite">{notification.body}</span>
            </a>
            <span className="mt-1 block text-xs text-ash">
              {relativeTime(notification._creationTime)} · {deliveryOf(notification)}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  )
}

/** Where a notification stands, in a few words. */
function deliveryOf(notification: Notification): string {
  if (notification.status === 'queued' || notification.status === 'sending') {
    return notification.dueAt > Date.now() ? `held until ${formatTime(notification.dueAt)}` : 'being pushed'
  }
  if (notification.status === 'failed') return 'not pushed'
  if (notification.mock) return 'mock, not pushed'
  if (notification.devices === 0) return 'no device'
  return `to ${notification.devices} ${plural(notification.devices, 'device', 'devices')}`
}
