import { api } from '@stepradar/convex/_generated/api'
import { PROVIDER_KEY_HINTS, PROVIDER_KEY_LABELS, providerKeyProblem } from '@stepradar/shared'
import { useMutation } from 'convex/react'
import type { FunctionReturnType } from 'convex/server'
import React from 'react'
import { Button, ErrorLine, Field, Input } from './ui'
import { errorMessage } from '@/lib/errors'
import { relativeTime } from '@/lib/format'

/** What the studio knows of one stored key (core/keys.ts `keyStatuses`): whether it is set, its last characters and when. */
export type KeyStatus = FunctionReturnType<typeof api.private.providers.status>['providerKeys'][number]

/** A key as stored, in words: never the key, only its end. */
export function keyStatusText(status: KeyStatus): string {
  return status.set ? `Set, ends in …${status.ending}, ${relativeTime(status.setAt)}` : 'Not set'
}

/** The form is in exactly one of these; a save that failed says why until the operator types again. */
type KeyFormState = { status: 'idle' } | { status: 'saving' } | { status: 'removing' } | { status: 'error'; message: string }

/**
 * The operator's keys on the Providers page (ADR 0005): each one set,
 * replaced or removed in place. A typed key is sent once and the field
 * empties; the studio never reads a key back.
 */
export function ProviderKeys(props: { keys: KeyStatus[] }) {
  return (
    <ul className="divide-y divide-mist">
      {props.keys.map((status) => (
        <li key={status.name} className="py-3 first:pt-0 last:pb-0">
          <KeyField status={status} />
        </li>
      ))}
    </ul>
  )
}

function KeyField(props: { status: KeyStatus }) {
  const { status } = props
  const set = useMutation(api.private.keys.set)
  const remove = useMutation(api.private.keys.remove)
  const [draft, setDraft] = React.useState('')
  const [state, setState] = React.useState<KeyFormState>({ status: 'idle' })
  const busy = state.status === 'saving' || state.status === 'removing'
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy) return
    const problem = providerKeyProblem(status.name, draft)
    if (problem !== null) {
      setState({ status: 'error', message: problem })
      return
    }
    setState({ status: 'saving' })
    try {
      await set({ name: status.name, value: draft })
      setDraft('')
      setState({ status: 'idle' })
    } catch (caught) {
      setState({ status: 'error', message: errorMessage(caught) })
    }
  }
  const forget = async () => {
    if (busy) return
    setState({ status: 'removing' })
    try {
      await remove({ name: status.name })
      setState({ status: 'idle' })
    } catch (caught) {
      setState({ status: 'error', message: errorMessage(caught) })
    }
  }
  return (
    <form onSubmit={submit} className="space-y-2" noValidate>
      <Field label={PROVIDER_KEY_LABELS[status.name]} hint={PROVIDER_KEY_HINTS[status.name]}>
        <Input
          name={status.name}
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value)
            if (state.status === 'error') setState({ status: 'idle' })
          }}
          placeholder={status.set ? 'Paste a new key to replace it' : 'Paste the key'}
          aria-invalid={state.status === 'error' || undefined}
        />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" variant="primary" busy={state.status === 'saving'} disabled={draft.trim() === ''}>
          {status.set ? 'Replace' : 'Save'}
        </Button>
        {status.set && (
          <Button size="sm" variant="ghost" busy={state.status === 'removing'} onClick={() => void forget()}>
            Remove
          </Button>
        )}
        <span className={status.set ? 'text-xs text-field-green-deep' : 'text-xs text-ash'}>{keyStatusText(status)}</span>
      </div>
      <div aria-live="polite">{state.status === 'error' && <ErrorLine>{state.message}</ErrorLine>}</div>
    </form>
  )
}
