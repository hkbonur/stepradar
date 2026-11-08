import { api } from '@influstep/convex/_generated/api'
import type { Id } from '@influstep/convex/_generated/dataModel'
import {
  BroadcastIcon,
  ChartLineIcon,
  FlaskIcon,
  ListChecksIcon,
  PlugsIcon,
  PlusIcon,
  RobotIcon,
  SunIcon,
  UsersThreeIcon,
} from '@phosphor-icons/react'
import { Link, Navigate, Outlet, createRootRoute, useLocation, useMatchRoute } from '@tanstack/react-router'
import { handleOf, placeLabel, placeOf } from '@influstep/shared'
import { useQuery } from 'convex/react'
import type { FunctionReturnType } from 'convex/server'
import React from 'react'
import { AccountMark, accountState } from '@/components/account-mark'
import { Skeleton } from '@/components/ui'
import { cn } from '@/lib/cn'

// `exact`: an account's own page, its voice, its strategy and its report light up the account's row instead, so the section
// stays dark there and the sidebar never shows two selections at once.
const NAV = [
  { to: '/', label: 'Today', icon: SunIcon, exact: true },
  { to: '/accounts', label: 'Accounts', icon: UsersThreeIcon, exact: true },
  { to: '/agents', label: 'Agents', icon: RobotIcon, exact: false },
  { to: '/experiments', label: 'Experiments', icon: FlaskIcon, exact: false },
  { to: '/signals', label: 'Signals', icon: BroadcastIcon, exact: false },
  { to: '/checklist', label: 'Checklist', icon: ListChecksIcon, exact: false },
  { to: '/reports', label: 'Reports', icon: ChartLineIcon, exact: true },
  { to: '/providers', label: 'Providers', icon: PlugsIcon, exact: false },
] as const

type AccountRow = FunctionReturnType<typeof api.private.accounts.list>[number]

/** The one mark a roster row may carry: what waits on the operator first, then a failure, else nothing. */
type WaitingMark = { kind: 'waiting'; count: number } | { kind: 'failed' } | { kind: 'none' }

/** Below this width the sidebar is a rail that opens over the page, so the page keeps its width on a phone. */
const NARROW_QUERY = '(max-width: 767px)'

function subscribeNarrow(onChange: () => void): () => void {
  const query = window.matchMedia(NARROW_QUERY)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

function useNarrow(): boolean {
  return React.useSyncExternalStore(
    subscribeNarrow,
    () => window.matchMedia(NARROW_QUERY).matches,
    () => false
  )
}

function Sidebar(props: {
  collapsed: boolean
  onToggle: () => void
  /** On a narrow screen, the open sidebar lies over the page instead of beside it, and a link followed or Escape closes it. */
  overlay?: { onClose: () => void }
}) {
  const checklist = useQuery(api.private.checklist.list, {})
  const providers = useQuery(api.private.providers.status, {})
  const open = checklist?.filter((item) => item.status === 'open').length ?? 0
  return (
    // Sticky rather than a scroll container of its own: the page keeps window scroll, which the router resets on navigation.
    <aside
      className={cn(
        'top-0 flex h-dvh shrink-0 flex-col self-start border-r border-mist bg-paper-tint transition-[width] duration-200 ease-out-quint',
        {
          'w-[232px]': !props.collapsed,
          'w-14': props.collapsed,
          sticky: props.overlay === undefined,
          'fixed left-0 z-30 shadow-xl': props.overlay !== undefined,
        }
      )}
      onClickCapture={(event) => {
        if (props.overlay && event.target instanceof Element && event.target.closest('a')) props.overlay.onClose()
      }}
      onKeyDown={(event) => {
        if (props.overlay && event.key === 'Escape') props.overlay.onClose()
      }}
    >
      <div className="flex h-14 shrink-0 items-center gap-2 px-3">
        <button
          type="button"
          onClick={props.onToggle}
          className="flex size-8 items-center justify-center rounded-lg hover:bg-hairline-strong"
          aria-label={props.collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <span aria-hidden className="flex size-4 items-center justify-center rounded-[5px] bg-ink">
            <span className="size-1.5 rounded-full bg-field-green" />
          </span>
        </button>
        {!props.collapsed && <span className="font-semibold tracking-tight">Influstep</span>}
      </div>
      <nav className="flex shrink-0 flex-col gap-0.5 px-2">
        {NAV.map((item) => (
          <NavItem key={item.to} item={item} count={item.to === '/checklist' ? open : 0} collapsed={props.collapsed} />
        ))}
      </nav>
      <AccountRoster collapsed={props.collapsed} />
      <div className="shrink-0 px-4 py-4 text-xs text-ash">
        {/* Whether the numbers and drafts are real or generated; the rail keeps the mode alone. */}
        {providers && (
          <p className={cn('flex items-center gap-2', { 'justify-center': props.collapsed })}>
            {!props.collapsed && 'Providers'}
            <span className={cn('font-mono', { 'ml-auto': !props.collapsed })}>{providers.mode}</span>
          </p>
        )}
      </div>
    </aside>
  )
}

/** A nav entry: icon and name when open, the icon alone on the rail, where an open count shrinks to an amber dot. */
function NavItem(props: { item: (typeof NAV)[number]; count: number; collapsed: boolean }) {
  const ItemIcon = props.item.icon
  const name = props.count > 0 ? `${props.item.label}, ${props.count} open` : props.item.label
  return (
    <Link
      to={props.item.to}
      activeOptions={{ exact: props.item.exact, includeSearch: false }}
      className={cn('flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-sm text-graphite hover:bg-hairline-strong', {
        'justify-center px-0': props.collapsed,
      })}
      activeProps={{ className: 'bg-hairline-strong text-ink font-medium' }}
      title={props.collapsed ? name : undefined}
      aria-label={props.collapsed ? name : undefined}
    >
      {(state) => (
        <>
          <span className="relative flex shrink-0">
            <ItemIcon size={16} weight={state.isActive ? 'fill' : 'regular'} aria-hidden />
            {props.collapsed && props.count > 0 && (
              <span aria-hidden className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-alert-amber ring-2 ring-paper" />
            )}
          </span>
          {!props.collapsed && <span className="truncate">{props.item.label}</span>}
          {!props.collapsed && props.count > 0 && (
            <span className="tabular ml-auto rounded-full bg-alert-amber/20 px-1.5 font-mono text-[11px] text-graphite">{props.count}</span>
          )}
        </>
      )}
    </Link>
  )
}

/** Every account as a row, oldest first, so the one the operator talks to is one click from any page. */
function AccountRoster(props: { collapsed: boolean }) {
  const accounts = useQuery(api.private.accounts.list, {})
  const selectedAccountId = useSelectedAccountId()
  const headingId = React.useId()
  return (
    <section aria-labelledby={headingId} className="mt-5 flex min-h-0 flex-1 flex-col">
      {props.collapsed && <div aria-hidden className="mx-auto mb-2 h-px w-6 shrink-0 bg-mist" />}
      <div
        className={cn('flex h-7 shrink-0 items-center justify-between pr-2 pl-4.5', {
          'justify-center px-0': props.collapsed,
        })}
      >
        <h2 id={headingId} className={cn('eyebrow', { 'sr-only': props.collapsed })}>
          Accounts
        </h2>
        <Link
          to="/onboarding"
          // One account through the onboarding flow; with no roster yet, the flow asks how many to build.
          search={accounts !== undefined && accounts.length > 0 ? { count: 1 } : {}}
          aria-label="New account"
          title="New account"
          className="flex size-6 items-center justify-center rounded-md text-ash hover:bg-hairline-strong hover:text-ink"
        >
          <PlusIcon size={14} aria-hidden />
        </Link>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pt-1 pb-2">
        <RosterBody accounts={accounts} selectedAccountId={selectedAccountId} collapsed={props.collapsed} />
      </div>
    </section>
  )
}

function RosterBody(props: { accounts: AccountRow[] | undefined; selectedAccountId: string | null; collapsed: boolean }) {
  if (props.accounts === undefined) return <RosterSkeleton collapsed={props.collapsed} />
  if (props.accounts.length === 0) {
    // The rail has no room for the sentence; its + button already leads to the flow.
    if (props.collapsed) return null
    return (
      <Link to="/onboarding" className="block rounded-lg px-2 py-1.5 text-ash hover:bg-paper-warm hover:text-ink">
        No account yet.
      </Link>
    )
  }
  return (
    <ul className={cn('flex flex-col gap-0.5', { 'items-center': props.collapsed })}>
      {props.accounts.map((account) => (
        <li key={account._id} className={cn({ 'w-full': !props.collapsed })}>
          <AccountLink account={account} selected={account._id === props.selectedAccountId} collapsed={props.collapsed} />
        </li>
      ))}
    </ul>
  )
}

function AccountLink(props: { account: AccountRow; selected: boolean; collapsed: boolean }) {
  const mark = waitingMark(props.account)
  const summary = rowSummary(props.account, mark)
  return (
    <Link
      to="/accounts/$accountId"
      params={{ accountId: props.account._id }}
      title={summary}
      aria-label={summary}
      // Its voice, its strategy, its report and its posts select the row too; the router marks the account page itself as "page".
      aria-current={props.selected ? 'true' : undefined}
      className={cn('flex items-center rounded-lg hover:bg-paper-warm', {
        'h-9 gap-2.5 pr-2 pl-1': !props.collapsed,
        'size-9 justify-center': props.collapsed,
        'bg-paper-warm': props.selected,
      })}
    >
      <span className="relative flex shrink-0">
        <AccountMark platform={props.account.platform} size={28} state={accountState(props.account)} />
        {props.collapsed && <CornerDot mark={mark} />}
      </span>
      {!props.collapsed && (
        <span
          className={cn('min-w-0 flex-1 truncate font-medium', {
            'text-ash': props.account.paused,
            'text-ink': props.selected && !props.account.paused,
            'text-graphite': !props.selected && !props.account.paused,
          })}
        >
          {handleOf(props.account)}
        </span>
      )}
      {!props.collapsed && <RowMark mark={mark} />}
    </Link>
  )
}

function RowMark(props: { mark: WaitingMark }) {
  if (props.mark.kind === 'waiting') {
    return (
      <span aria-hidden className="tabular shrink-0 rounded-full bg-alert-amber/20 px-1.5 font-mono text-[11px] text-graphite">
        {props.mark.count}
      </span>
    )
  }
  if (props.mark.kind === 'failed') return <span aria-hidden className="mx-1 size-1.5 shrink-0 rounded-full bg-signal-red" />
  return null
}

/** The rail's version of the mark: a dot on the account mark's top-right corner, ringed so it reads against the mark. */
function CornerDot(props: { mark: WaitingMark }) {
  if (props.mark.kind === 'none') return null
  return (
    <span
      aria-hidden
      className={cn('absolute -top-px -right-px size-2 rounded-full ring-2 ring-paper', {
        'bg-alert-amber': props.mark.kind === 'waiting',
        'bg-signal-red': props.mark.kind === 'failed',
      })}
    />
  )
}

function RosterSkeleton(props: { collapsed: boolean }) {
  return (
    <ul aria-hidden className={cn('flex flex-col gap-0.5', { 'items-center': props.collapsed })}>
      {['w-24', 'w-20', 'w-28'].map((width) => (
        <li
          key={width}
          className={cn('flex items-center gap-2.5', { 'h-9 pl-1': !props.collapsed, 'size-9 justify-center': props.collapsed })}
        >
          <span className="size-7 shrink-0 rounded-full bg-fog" />
          {!props.collapsed && <Skeleton className={cn('h-3', width)} />}
        </li>
      ))}
    </ul>
  )
}

/**
 * What waits on the operator, each thing once: open checklist items, and the
 * drafts to post (core `waitingOn`). Failed has its own mark, the red
 * dot.
 */
function waitingMark(account: AccountRow): WaitingMark {
  const waiting = account.counts.waitingTotal
  if (waiting > 0) return { kind: 'waiting', count: waiting }
  if (account.counts.failed > 0) return { kind: 'failed' }
  return { kind: 'none' }
}

/**
 * The row's tooltip and accessible name. It replaces the row's content for
 * screen readers, so "paused" is always there, never only in the fog account
 * mark. Then the mark, which is what the operator acts on; "working" only
 * when there is no mark and the account mark shows its working dot.
 */
function rowSummary(account: AccountRow, mark: WaitingMark): string {
  const parts = [`${account.name}, ${handleOf(account)} on ${placeLabel(placeOf(account))}`]
  if (account.paused) parts.push('paused')
  if (mark.kind === 'waiting') parts.push(`${mark.count} waiting on you`)
  if (mark.kind === 'failed') parts.push('failed post')
  if (mark.kind === 'none' && accountState(account) === 'working') parts.push('working')
  return parts.join(', ')
}

/**
 * The account the current page belongs to: its own page, its voice, its
 * strategy, its memory, its replies, its report, or one of its posts. A post's route names only the post, so its account
 * comes from the post itself.
 */
function useSelectedAccountId(): string | null {
  const matchRoute = useMatchRoute()
  const accountPage = matchRoute({ to: '/accounts/$accountId' })
  // Their own matches: route matching is exact by default, so the account page's match never covers /voice or /strategy.
  const voicePage = matchRoute({ to: '/accounts/$accountId/voice' })
  const strategyPage = matchRoute({ to: '/accounts/$accountId/strategy' })
  const memoryPage = matchRoute({ to: '/accounts/$accountId/memory' })
  const repliesPage = matchRoute({ to: '/accounts/$accountId/replies' })
  const reportPage = matchRoute({ to: '/reports/$accountId' })
  const postPage = matchRoute({ to: '/posts/$postId' })
  const post = useQuery(api.private.posts.get, postPage ? { postId: postPage.postId as Id<'posts'> } : 'skip')
  if (accountPage) return accountPage.accountId
  if (voicePage) return voicePage.accountId
  if (strategyPage) return strategyPage.accountId
  if (memoryPage) return memoryPage.accountId
  if (repliesPage) return repliesPage.accountId
  if (reportPage) return reportPage.accountId
  // Undefined while the post loads, null when it does not exist: no row is selected in either case.
  if (post) return post.post.accountId
  return null
}

function RootComponent() {
  const [collapsed, setCollapsed] = React.useState(() => {
    try {
      return localStorage.getItem('sidebar') === 'collapsed'
    } catch {
      return false
    }
  })
  const toggle = () => {
    setCollapsed((current) => {
      try {
        localStorage.setItem('sidebar', current ? 'open' : 'collapsed')
      } catch {
        // Private mode: the preference lives for this tab only.
      }
      return !current
    })
  }
  const narrow = useNarrow()
  const [drawer, setDrawer] = React.useState(false)
  const workspace = useQuery(api.private.workspace.get, {})
  const location = useLocation()
  // The first run's last step builds the accounts on /onboarding, still in the setup's layout (setup.tsx hands over with `first`).
  const onSetup =
    location.pathname === '/setup' || (location.pathname === '/onboarding' && 'first' in location.search && location.search.first === true)
  // On a narrow screen the rail stays in the page's flow and the open sidebar lies over it; the wide preference is untouched.
  const open = narrow && drawer
  // Every page reads the product, so nothing renders until it is known, and the first run goes to the setup.
  if (workspace === undefined) return <div className="min-h-dvh bg-canvas" />
  if (workspace === null && !onSetup) return <Navigate to="/setup" replace />
  if (onSetup) return <SetupLayout />
  return (
    <div className="flex min-h-dvh bg-canvas">
      {narrow ? (
        <div className="w-14 shrink-0">
          <Sidebar
            collapsed={!drawer}
            onToggle={() => setDrawer((current) => !current)}
            overlay={open ? { onClose: () => setDrawer(false) } : undefined}
          />
        </div>
      ) : (
        <Sidebar collapsed={collapsed} onToggle={toggle} />
      )}
      {open && (
        <button type="button" aria-label="Close the menu" className="fixed inset-0 z-20 bg-ink/20" onClick={() => setDrawer(false)} />
      )}
      <main className="min-w-0 flex-1">
        <div className="mx-auto max-w-[1280px] px-4 py-6 sm:px-6">
          <Outlet />
        </div>
      </main>
    </div>
  )
}

/** The first run: the setup alone, no sidebar, since every page it would lead to needs the product first. */
function SetupLayout() {
  return (
    <div className="min-h-dvh bg-canvas">
      <div className="mx-auto max-w-[40rem] px-5 py-10 sm:py-16">
        <div className="mb-10 flex items-center gap-2">
          <span aria-hidden className="flex size-5 items-center justify-center rounded-[6px] bg-ink">
            <span className="size-2 rounded-full bg-field-green" />
          </span>
          <span className="font-semibold tracking-tight">Influstep</span>
        </div>
        <main>
          <Outlet />
        </main>
      </div>
    </div>
  )
}

function NotFound() {
  return (
    <div className="py-20 text-center text-ash">
      <p>There is nothing at this address.</p>
      <Link to="/" className="mt-2 inline-block underline">
        Back to Today
      </Link>
    </div>
  )
}

export const Route = createRootRoute({ component: RootComponent, notFoundComponent: NotFound })
