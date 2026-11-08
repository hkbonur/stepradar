import { api } from '@influstep/convex/_generated/api'
import type { Id } from '@influstep/convex/_generated/dataModel'
import { useAction } from 'convex/react'
import React from 'react'
import { errorMessage } from '@/lib/errors'
import { Button, ErrorLine } from './ui'

/**
 * Connect the account to its platform. In real mode the operator leaves for
 * the platform's consent page and comes back to the account; in mock mode it
 * connects at once. A refusal (a key the deployment lacks) shows under it.
 */
export function ConnectButton(props: { accountId: Id<'accounts'> }) {
  const connect = useAction(api.private.connections.connect)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const start = async () => {
    setBusy(true)
    setError(null)
    try {
      const outcome = await connect({ accountId: props.accountId })
      if (outcome.kind === 'authorize') {
        window.location.assign(outcome.url)
        return
      }
      setBusy(false)
    } catch (caught) {
      setError(errorMessage(caught))
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-col items-start gap-1.5">
      <Button size="sm" busy={busy} onClick={() => void start()}>
        Connect
      </Button>
      <div aria-live="polite">{error && <ErrorLine>{error}</ErrorLine>}</div>
    </div>
  )
}
