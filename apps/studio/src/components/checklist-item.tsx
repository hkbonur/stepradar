import { api } from '@influstep/convex/_generated/api'
import type { Doc } from '@influstep/convex/_generated/dataModel'
import { ticksOffByHand } from '@influstep/shared'
import { useMutation } from 'convex/react'
import { cn } from '@/lib/cn'
import { ConnectButton } from './connect-button'
import { ExternalLinkButton, LinkButton } from './ui'

type Item = Pick<Doc<'checklistItems'>, '_id' | 'accountId' | 'title' | 'action'>

/**
 * Ticks the item off. A connect item closes only by connecting the account,
 * so it has no checkbox; an empty box of the same size keeps the rows aligned.
 */
export function ChecklistCheckbox(props: { item: Item; className: string }) {
  const complete = useMutation(api.private.checklist.complete)
  if (!ticksOffByHand(props.item)) return <span aria-hidden className={cn('shrink-0', props.className)} />
  return (
    <input
      type="checkbox"
      className={cn('accent-ink', props.className)}
      aria-label={`Done: ${props.item.title}`}
      onChange={() => complete({ itemId: props.item._id })}
    />
  )
}

/** The item's action: set a key on the Providers page, open a page the operator acts on by hand, connect the account, or learn its voice. */
export function ChecklistAction(props: { item: Item }) {
  const action = props.item.action
  if (action === undefined) return null
  switch (action.kind) {
    case 'set_provider_key':
      return (
        <LinkButton to="/providers" size="sm">
          Set {action.key}
        </LinkButton>
      )
    case 'visit':
      return (
        <ExternalLinkButton href={action.url} size="sm">
          Open
        </ExternalLinkButton>
      )
    case 'connect_account':
      return <ConnectButton accountId={props.item.accountId} />
    case 'learn_voice':
      return (
        <LinkButton to="/accounts/$accountId/voice" params={{ accountId: props.item.accountId }} size="sm">
          Open voice
        </LinkButton>
      )
  }
}
