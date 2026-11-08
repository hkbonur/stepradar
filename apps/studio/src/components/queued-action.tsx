import React from 'react'
import { ErrorLine } from './ui'
import { cn } from '@/lib/cn'
import { errorMessage } from '@/lib/errors'

/** A request that queues work for an agent (Plan this week, Poll signals): busy while it is out, then what it queued or why it was refused. */
export type QueuedAction<Key extends string> =
  | { status: 'idle' }
  | { status: 'busy'; key: Key }
  | { status: 'done'; message: string }
  | { status: 'error'; message: string }

/** One queued request at a time: busy while it is out, then what it queued or why it was refused. */
export function useQueuedAction<Key extends string>() {
  const [state, setState] = React.useState<QueuedAction<Key>>({ status: 'idle' })
  const run = async (key: Key, request: () => Promise<unknown>, done: string) => {
    if (state.status === 'busy') return
    setState({ status: 'busy', key })
    try {
      await request()
      setState({ status: 'done', message: done })
    } catch (caught) {
      setState({ status: 'error', message: errorMessage(caught) })
    }
  }
  const busy = (key: Key) => state.status === 'busy' && state.key === key
  return { state, run, busy }
}

/** Stays mounted, so what an action queued, or why it was refused, is heard where the operator's focus already is. */
export function QueuedLine(props: { state: QueuedAction<string>; className?: string }) {
  return (
    <div aria-live="polite" className={cn('text-xs', props.className)}>
      {props.state.status === 'done' && <p className="text-ash">{props.state.message}</p>}
      {props.state.status === 'error' && <ErrorLine>{props.state.message}</ErrorLine>}
    </div>
  )
}
