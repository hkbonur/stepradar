import { api } from '@influstep/convex/_generated/api'
import { useMutation, useQuery } from 'convex/react'
import React from 'react'
import { deviceLabel, deviceSubscribed, pushSupport, subscribeDevice } from '@/lib/push'
import { errorMessage } from '@/lib/errors'
import { Button, ErrorLine, Mono } from './ui'

type ButtonState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'on' }
  | { status: 'declined' }
  | { status: 'error'; message: string }

/**
 * Turn on notifications for this device: the browser asks for permission
 * after the click, and the device joins the ones the notifier pushes to. On
 * an iPhone a push arrives only once the studio is on the Home Screen, so it
 * says that instead.
 */
export function NotificationsButton() {
  const settings = useQuery(api.private.notifications.settings, {})
  const subscribe = useMutation(api.private.notifications.subscribe)
  const [state, setState] = React.useState<ButtonState>({ status: 'idle' })
  const support = pushSupport()
  // The browser knows whether this device subscribed before; it says so asynchronously.
  React.useEffect(() => {
    if (support.kind !== 'supported') return
    let live = true
    void deviceSubscribed().then((subscribed) => {
      if (live && subscribed) setState((current) => (current.status === 'idle' ? { status: 'on' } : current))
    })
    return () => {
      live = false
    }
  }, [support.kind])
  if (settings === undefined) return null
  if (support.kind === 'home-screen') {
    return (
      <p className="text-xs text-ash">
        On an iPhone, notifications need the studio on the Home Screen: tap Share, then Add to Home Screen, and turn them on from there.
      </p>
    )
  }
  if (support.kind === 'unsupported') return <p className="text-xs text-ash">This browser cannot show notifications.</p>
  if (settings.publicKey === null) {
    return (
      <p className="text-xs text-ash">
        Set <Mono>VAPID_PUBLIC_KEY</Mono> on the deployment to turn notifications on.
      </p>
    )
  }
  if (Notification.permission === 'denied')
    return <p className="text-xs text-ash">Notifications are blocked for the studio in this browser's settings.</p>
  const publicKey = settings.publicKey
  const turnOn = async () => {
    if (state.status === 'saving') return
    setState({ status: 'saving' })
    try {
      const device = await subscribeDevice(publicKey)
      if (device === null) {
        setState({ status: 'declined' })
        return
      }
      await subscribe({ ...device, label: deviceLabel() })
      setState({ status: 'on' })
    } catch (caught) {
      setState({ status: 'error', message: errorMessage(caught) })
    }
  }
  if (state.status === 'on') return <p className="text-xs text-ash">Notifications are on for this device.</p>
  return (
    <div className="space-y-1.5" aria-live="polite">
      <Button size="sm" variant="outline" busy={state.status === 'saving'} onClick={() => void turnOn()}>
        Turn on notifications
      </Button>
      {state.status === 'declined' && <p className="text-xs text-ash">The browser was not allowed to show them.</p>}
      {state.status === 'error' && <ErrorLine>{state.message}</ErrorLine>}
    </div>
  )
}
