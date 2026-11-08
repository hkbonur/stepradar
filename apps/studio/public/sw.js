// The studio's service worker (docs/plan.md, "Notifier: web push"): it shows each push the notifier sends,
// and a click focuses the studio, or opens it, at the address the push names.
self.addEventListener('push', (event) => {
  if (!event.data) return
  const push = event.data.json()
  event.waitUntil(
    self.registration.showNotification(push.title, {
      body: push.body,
      // A repeat with the same tag replaces the earlier notification instead of stacking.
      tag: push.tag,
      data: { url: push.url },
      icon: '/icon-192.png',
      badge: '/icon-192.png',
    })
  )
})

// Take over the open studio at once, so a click on a push can move it to the page the push names.
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = new URL(event.notification.data.url, self.location.origin).href
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const studio = windows.find((client) => new URL(client.url).origin === self.location.origin)
      if (studio) {
        await studio.focus()
        // A tab this worker does not control cannot be moved; a new one opens at the page instead.
        return studio.navigate(url).catch(() => self.clients.openWindow(url))
      }
      return self.clients.openWindow(url)
    })()
  )
})
