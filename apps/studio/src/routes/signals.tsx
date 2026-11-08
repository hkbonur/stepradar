import { api } from '@influstep/convex/_generated/api'
import type { Id } from '@influstep/convex/_generated/dataModel'
import {
  FRESHNESS_HALF_LIFE_DAYS,
  SIGNAL_SOURCES,
  SIGNAL_SOURCE_LABELS,
  isCold,
  signalFreshness,
  type SignalSource,
  handleOf,
} from '@influstep/shared'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import React from 'react'
import { z } from 'zod'
import { Button, Card, Collapsible, Empty, ErrorLine, Input, MockNote, Mono, PageHeader, Pill, Skeleton } from '@/components/ui'
import { cn } from '@/lib/cn'
import { errorMessage } from '@/lib/errors'
import { addDays, relativeTime, todayKey } from '@/lib/format'
import { useNow } from '@/lib/use-now'

const searchSchema = z.object({ account: z.string().optional(), source: z.enum(SIGNAL_SOURCES).optional() })

export const Route = createFileRoute('/signals')({ component: SignalsPage, validateSearch: searchSchema })

/** Freshness moves by about a point an hour, so the page reads the clock once a minute. */
const CLOCK_MS = 60_000

function SignalsPage() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const accountId = search.account ? (search.account as Id<'accounts'>) : undefined
  const signals = useQuery(api.private.signals.list, { accountId })
  const accounts = useQuery(api.private.accounts.list, {})
  const pollSignals = useMutation(api.private.accounts.pollSignals)
  const now = useNow(CLOCK_MS)
  // The query lists no dismissed signal and ranks by freshness on the backend's clock; the page ranks again on its own
  // clock. The sort is stable, so signals of equal freshness keep the query's order, newest found first.
  const rows = (signals ?? [])
    .filter((signal) => !search.source || signal.source === search.source)
    .map((signal) => ({ signal, freshness: signalFreshness(signal, now) }))
    .sort((a, b) => b.freshness - a.freshness)
  const warm = rows.filter((row) => !isCold(row.freshness))
  const cold = rows.filter((row) => isCold(row.freshness))
  const counts = new Map<SignalSource, number>()
  for (const signal of signals ?? []) counts.set(signal.source, (counts.get(signal.source) ?? 0) + 1)

  return (
    <>
      <PageHeader
        title="Signals"
        lead={`What the researcher found, freshest first. Freshness halves every ${FRESHNESS_HALF_LIFE_DAYS} days.`}
        actions={
          <>
            <select
              value={search.account ?? ''}
              onChange={(event) => navigate({ search: (previous) => ({ ...previous, account: event.target.value || undefined }) })}
              className="field w-auto pr-8"
              aria-label="Account"
            >
              <option value="">All accounts</option>
              {accounts?.map((account) => (
                <option key={account._id} value={account._id}>
                  {account.name}
                </option>
              ))}
            </select>
            <Button
              onClick={() => {
                const targets = accountId ? [accountId] : (accounts ?? []).map((account) => account._id)
                for (const id of targets) void pollSignals({ accountId: id })
              }}
            >
              Poll now
            </Button>
          </>
        }
      />
      <div className="mb-4 flex flex-wrap gap-1.5">
        <FilterChip active={!search.source} onClick={() => navigate({ search: (previous) => ({ ...previous, source: undefined }) })}>
          All
        </FilterChip>
        {SIGNAL_SOURCES.map((source) => (
          <FilterChip
            key={source}
            active={search.source === source}
            onClick={() => navigate({ search: (previous) => ({ ...previous, source }) })}
          >
            {SIGNAL_SOURCE_LABELS[source]} <span className="tabular text-ash">{counts.get(source) ?? 0}</span>
          </FilterChip>
        ))}
      </div>
      {!signals && <Skeleton className="h-40 rounded-xl" />}
      {signals && rows.length === 0 && <Empty>No signals here. The researcher polls every hour; poll now to see it work.</Empty>}
      {rows.length > 0 && (
        <Card flush>
          {/* A column head for the numbers; each row also names its number for screen readers, so the head is hidden from them. */}
          <div
            aria-hidden
            className="card-x grid grid-cols-[3.5rem_1fr] gap-x-4 border-b border-mist bg-paper-tint py-2 text-[11px] text-ash"
          >
            <span className="text-right">Freshness</span>
            <span>Signal</span>
          </div>
          {warm.length === 0 && <p className="card-x py-4 text-sm text-ash">Every signal here is cold.</p>}
          <ol className="divide-y divide-mist">
            {warm.map((row) => (
              <SignalRow key={row.signal._id} signal={row.signal} freshness={row.freshness} now={now} showAccount={!accountId} />
            ))}
          </ol>
          {/* Too old to plan from; kept in reach, out of the way. */}
          {cold.length > 0 && (
            <Collapsible summary="Cold" count={cold.length} inset className="border-t border-mist">
              <ol className="divide-y divide-mist">
                {cold.map((row) => (
                  <SignalRow key={row.signal._id} signal={row.signal} freshness={row.freshness} now={now} showAccount={!accountId} />
                ))}
              </ol>
            </Collapsible>
          )}
        </Card>
      )}
      <div className="mt-3">
        <MockNote when={rows.some((row) => row.signal.mock)}>Mock providers: these signals are a fixed set, not fetched.</MockNote>
      </div>
    </>
  )
}

function FilterChip(props: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={cn('inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium', {
        'bg-ink text-paper': props.active,
        'bg-hairline text-graphite hover:bg-hairline-strong': !props.active,
      })}
    >
      {props.children}
    </button>
  )
}

type SignalRowData = NonNullable<ReturnType<typeof useQuery<typeof api.private.signals.list>>>[number]

/**
 * When the signal is from, the moment its freshness counts from (shared
 * signalFreshness): when the source says the item was posted, or, for a source
 * that names no post time, when the researcher found it. The page's clock
 * ticks once a minute and the backend pushes in between, so a newer moment
 * reads "now", never "in 12 seconds".
 */
function sinceWords(signal: SignalRowData, now: number): string {
  if (signal.publishedAt !== undefined) return relativeTime(signal.publishedAt, Math.max(now, signal.publishedAt))
  return relativeTime(signal.foundAt, Math.max(now, signal.foundAt))
}

function SignalRow(props: { signal: SignalRowData; freshness: number; now: number; showAccount: boolean }) {
  const dismiss = useMutation(api.private.signals.dismiss)
  const makePost = useMutation(api.private.signals.makePost)
  const [picking, setPicking] = React.useState(false)
  const [day, setDay] = React.useState(addDays(todayKey(), 1))
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const signal = props.signal
  const make = async () => {
    setBusy(true)
    setError(null)
    try {
      await makePost({ signalId: signal._id, plannedFor: day })
      setPicking(false)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }
  return (
    <li className="group card-x grid grid-cols-[3.5rem_minmax(0,1fr)] gap-x-4 gap-y-2 py-3 hover:bg-paper-tint sm:grid-cols-[3.5rem_minmax(0,1fr)_auto]">
      <div className="flex flex-col items-end pt-px">
        <Mono className="text-ink">
          <span className="sr-only">Freshness </span>
          {props.freshness}
        </Mono>
        {isCold(props.freshness) && <span className="text-[11px] text-ash">cold</span>}
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-ash">
          <span>{SIGNAL_SOURCE_LABELS[signal.source]}</span>
          <span aria-hidden>·</span>
          <span title={`Score ${Math.round(signal.score)}`}>{sinceWords(signal, props.now)}</span>
          {props.showAccount && (
            <>
              <span aria-hidden>·</span>
              <Mono className="text-[11px]">{handleOf(signal.account)}</Mono>
            </>
          )}
          {signal.status === 'used' && (
            <Pill tint="fog" className="ml-1">
              Used
            </Pill>
          )}
        </div>
        {/* A problem comes from the account's own problem log, so there is no page to open. */}
        {signal.source === 'problems' ? (
          <p className="mt-0.5 font-medium">{signal.title}</p>
        ) : (
          <a href={signal.url} target="_blank" rel="noreferrer" className="mt-0.5 block font-medium hover:underline">
            {signal.title}
          </a>
        )}
        <p className="mt-0.5 line-clamp-1 text-ash" title={signal.summary}>
          {signal.summary}
        </p>
      </div>
      {/* With a mouse the actions wait until the row is pointed at or focused, so forty rows do not read as eighty buttons; on touch they stay. */}
      <div
        className={cn('col-start-2 flex items-start gap-2 sm:col-start-3', {
          'pointer-fine:opacity-0 pointer-fine:transition-opacity pointer-fine:group-focus-within:opacity-100 pointer-fine:group-hover:opacity-100':
            !picking,
        })}
      >
        {picking ? (
          <>
            <Input
              type="date"
              value={day}
              min={todayKey()}
              onChange={(event) => setDay(event.target.value)}
              className="w-auto"
              aria-label="Planned day"
            />
            <Button size="sm" variant="primary" busy={busy} onClick={make}>
              Create
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPicking(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" onClick={() => setPicking(true)}>
              Make a post
            </Button>
            {/* A signal a post already uses has nothing left to dismiss. */}
            {signal.status !== 'used' && (
              <Button size="sm" variant="ghost" onClick={() => dismiss({ signalId: signal._id })}>
                Dismiss
              </Button>
            )}
          </>
        )}
      </div>
      {error && (
        <div className="col-start-2 sm:col-span-2">
          <ErrorLine>{error}</ErrorLine>
        </div>
      )}
    </li>
  )
}
