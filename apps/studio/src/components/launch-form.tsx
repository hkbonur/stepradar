import { api } from '@influstep/convex/_generated/api'
import { LAUNCH_WHAT_MAX } from '@influstep/shared'
import { Link } from '@tanstack/react-router'
import { useMutation } from 'convex/react'
import type { FunctionReturnType } from 'convex/server'
import React from 'react'
import { AccountMark } from './account-mark'
import { Button, Collapsible, ErrorLine, Field, type FormState, Input } from './ui'
import { errorMessage } from '@/lib/errors'
import { addDays, todayKey } from '@/lib/format'

type Outcomes = FunctionReturnType<typeof api.private.launches.plan>

/** The launch form: idle or saving like any form, then what became of each account's post. */
type LaunchState = FormState | { status: 'planned'; outcomes: Outcomes }

/**
 * When the product ships something, one post per account announces it on
 * the day the operator picks (core/launch.ts): each in its platform's shape
 * and place, and an account where it cannot go is named with why.
 */
export function LaunchForm() {
  const plan = useMutation(api.private.launches.plan)
  const [day, setDay] = React.useState(() => addDays(todayKey(), 1))
  const [what, setWhat] = React.useState('')
  const [state, setState] = React.useState<LaunchState>({ status: 'idle' })
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (state.status === 'saving') return
    setState({ status: 'saving' })
    try {
      setState({ status: 'planned', outcomes: await plan({ day, what }) })
      setWhat('')
    } catch (caught) {
      setState({ status: 'error', message: errorMessage(caught) })
    }
  }
  return (
    <Collapsible summary="Plan a launch">
      <form className="max-w-2xl space-y-3" onSubmit={(event) => void submit(event)}>
        <p className="text-sm text-graphite">
          Shipped something? Every account announces it on the day you pick, in its platform's shape, naming your product with its
          affiliation line.
        </p>
        <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
          <Field label="Day">
            <Input type="date" value={day} min={todayKey()} onChange={(event) => setDay(event.target.value)} required />
          </Field>
          <Field label="What shipped" hint="One line, as you would say it to a customer.">
            <Input value={what} onChange={(event) => setWhat(event.target.value)} maxLength={LAUNCH_WHAT_MAX} required />
          </Field>
        </div>
        <Button type="submit" variant="primary" busy={state.status === 'saving'}>
          Plan the launch posts
        </Button>
      </form>
      <div aria-live="polite" className="mt-3 max-w-2xl">
        {state.status === 'error' && <ErrorLine>{state.message}</ErrorLine>}
        {state.status === 'planned' && <LaunchOutcomes outcomes={state.outcomes} />}
      </div>
    </Collapsible>
  )
}

function LaunchOutcomes(props: { outcomes: Outcomes }) {
  return (
    <ul className="space-y-1.5 text-sm">
      {props.outcomes.map((outcome) => (
        <li key={outcome.account._id} className="flex items-start gap-2">
          <AccountMark platform={outcome.account.platform} size={20} state="idle" />
          <span className="min-w-0">
            <span className="font-medium">{outcome.account.name}</span>{' '}
            {outcome.kind === 'planned' ? (
              <Link to="/posts/$postId" params={{ postId: outcome.postId }} className="underline decoration-fog underline-offset-2">
                planned
              </Link>
            ) : (
              <span className="text-ash">left out: {outcome.why}</span>
            )}
          </span>
        </li>
      ))}
    </ul>
  )
}
