import { api } from '@influstep/convex/_generated/api'
import { quietHoursProblems, type QuietHours } from '@influstep/shared'
import { useMutation, useQuery } from 'convex/react'
import React from 'react'
import { NotificationsButton } from './notifications-button'
import { Button, ErrorLine, Field, Input, Skeleton } from './ui'
import { errorMessage } from '@/lib/errors'
import { formatHour, relativeTime } from '@/lib/format'

const HOURS = Array.from({ length: 24 }, (_, hour) => hour)

/**
 * Notifications on Providers (docs/plan.md, "Notifier: web push"): the
 * devices the notifier pushes to, each with Remove, the quiet hours, and the
 * newest push error.
 */
export function NotificationSettings() {
  const settings = useQuery(api.private.notifications.settings, {})
  const remove = useMutation(api.private.notifications.removeDevice)
  if (settings === undefined) return <Skeleton className="h-32" />
  return (
    <div className="space-y-4 text-sm">
      <NotificationsButton />
      {settings.devices.length === 0 && <p className="text-ash">No device yet.</p>}
      <ul className="divide-y divide-mist border-y border-mist empty:hidden">
        {settings.devices.map((device) => (
          <li key={device._id} className="flex items-center gap-3 py-1.5">
            <span className="min-w-0 flex-1 truncate">{device.label}</span>
            <span className="text-xs text-ash">
              {device.lastOkAt === null ? `added ${relativeTime(device.createdAt)}` : `last push ${relativeTime(device.lastOkAt)}`}
            </span>
            <RemoveDevice onRemove={() => remove({ subscriptionId: device._id })} />
          </li>
        ))}
      </ul>
      {settings.lastError !== null && (
        <ErrorLine>
          Last push failed {relativeTime(settings.lastError.at)}: {settings.lastError.error}
        </ErrorLine>
      )}
      <QuietHoursForm key={JSON.stringify(settings.quietHours)} saved={settings.quietHours} />
    </div>
  )
}

function RemoveDevice(props: { onRemove: () => Promise<unknown> }) {
  const [busy, setBusy] = React.useState(false)
  const click = async () => {
    setBusy(true)
    try {
      await props.onRemove()
    } finally {
      setBusy(false)
    }
  }
  return (
    <Button size="sm" variant="ghost" busy={busy} onClick={() => void click()}>
      Remove
    </Button>
  )
}

type QuietState = { status: 'idle' } | { status: 'saving' } | { status: 'error'; message: string }

/** Hours when nothing is pushed; what comes in them waits for their end. */
function QuietHoursForm(props: { saved: QuietHours | null }) {
  const save = useMutation(api.private.notifications.setQuietHours)
  const [draft, setDraft] = React.useState<QuietHours>(
    props.saved ?? { start: 22, end: 7, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }
  )
  const [state, setState] = React.useState<QuietState>({ status: 'idle' })
  const problems = quietHoursProblems(draft)
  const run = async (quietHours: QuietHours | null) => {
    if (state.status === 'saving') return
    setState({ status: 'saving' })
    try {
      await save({ quietHours })
      setState({ status: 'idle' })
    } catch (caught) {
      setState({ status: 'error', message: errorMessage(caught) })
    }
  }
  const hourSelect = (label: string, value: number, onChange: (hour: number) => void) => (
    <label className="grid gap-1 text-xs text-graphite">
      {label}
      <select className="field w-auto" value={value} onChange={(event) => onChange(Number(event.target.value))}>
        {HOURS.map((hour) => (
          <option key={hour} value={hour}>
            {formatHour(hour)}
          </option>
        ))}
      </select>
    </label>
  )
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (problems.length === 0) void run(draft)
      }}
    >
      <p className="text-xs text-ash">
        {props.saved === null
          ? 'No quiet hours: notifications are pushed as they come.'
          : `Quiet from ${formatHour(props.saved.start)} to ${formatHour(props.saved.end)}, ${props.saved.timezone}: what comes in them waits for their end.`}
      </p>
      <div className="flex flex-wrap items-end gap-3">
        {hourSelect('Quiet from', draft.start, (start) => setDraft((current) => ({ ...current, start })))}
        {hourSelect('until', draft.end, (end) => setDraft((current) => ({ ...current, end })))}
        <Field label="Timezone" className="min-w-40 flex-1">
          <Input value={draft.timezone} onChange={(event) => setDraft((current) => ({ ...current, timezone: event.target.value }))} />
        </Field>
      </div>
      {problems.length > 0 && <ErrorLine>{problems.join(' ')}</ErrorLine>}
      {state.status === 'error' && <ErrorLine>{state.message}</ErrorLine>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant="primary" busy={state.status === 'saving'} disabled={problems.length > 0}>
          Save quiet hours
        </Button>
        {props.saved !== null && (
          <Button type="button" size="sm" variant="ghost" onClick={() => void run(null)}>
            Turn off
          </Button>
        )}
      </div>
    </form>
  )
}
