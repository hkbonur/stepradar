import { ChatsCircleIcon, LinkedinLogoIcon, RedditLogoIcon, XLogoIcon } from '@phosphor-icons/react'
import type { Platform } from '@influstep/shared'
import { cn } from '@/lib/cn'

/** What an account's agents are doing, as its mark shows it. */
export type AccountState = 'idle' | 'working' | 'paused'

/** A paused account rests, even with jobs waiting in its queue; else it works while a job is queued or running. */
export function accountState(account: { working: boolean; paused: boolean }): AccountState {
  if (account.paused) return 'paused'
  return account.working ? 'working' : 'idle'
}

/** Each platform's logo at a size; Phosphor has no Hacker News logo, so its Y is set in type, and every forum shares one mark. */
const LOGOS: Record<Platform, (props: { size: number }) => React.ReactNode> = {
  reddit: (props) => <RedditLogoIcon size={props.size} weight="bold" />,
  hackernews: (props) => (
    <span className="leading-none font-bold" style={{ fontSize: props.size }}>
      Y
    </span>
  ),
  x: (props) => <XLogoIcon size={props.size} weight="bold" />,
  linkedin: (props) => <LinkedinLogoIcon size={props.size} weight="bold" />,
  forum: (props) => <ChatsCircleIcon size={props.size} weight="bold" />,
}

/**
 * Whose a row is: the platform's logo in monochrome graphite on a round
 * paper-warm chip, beside the handle or the name (DESIGN.md, identity rule).
 * A working account carries a note-blue dot; a paused one is fog. Hidden
 * from screen readers: the name or handle beside it says whose it is.
 */
export function AccountMark(props: { platform: Platform; size: number; state: AccountState; className?: string }) {
  const Logo = LOGOS[props.platform]
  return (
    <span
      aria-hidden
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center rounded-full border border-mist bg-paper-warm',
        props.state === 'paused' ? 'text-fog' : 'text-graphite',
        props.className
      )}
      style={{ width: props.size, height: props.size }}
    >
      <Logo size={Math.round(props.size * 0.55)} />
      {props.state === 'working' && (
        <span className="absolute -right-0.5 -bottom-0.5 size-2 rounded-full border border-paper bg-note-blue" />
      )}
    </span>
  )
}

/** Whose an item is, at the top of its card: the account's mark beside its name. */
export function AccountLabel(props: { platform: Platform; name: string; className?: string }) {
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5 font-medium text-graphite', props.className)}>
      <AccountMark platform={props.platform} size={18} state="idle" />
      <span className="truncate">{props.name}</span>
    </span>
  )
}
