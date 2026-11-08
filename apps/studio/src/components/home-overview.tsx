import { api } from '@influstep/convex/_generated/api'
import { Link } from '@tanstack/react-router'
import { useQuery } from 'convex/react'
import type { FunctionReturnType } from 'convex/server'
import { AccountMark } from './account-mark'
import { Card, Skeleton } from './ui'
import { formatMoney, relativeTime } from '@/lib/format'

type Overview = FunctionReturnType<typeof api.private.home.overview>

const ROW_LINK = 'underline decoration-fog underline-offset-2 hover:decoration-ink'

/**
 * Today's rail: how each account moved over the last week, what each earned
 * over the report's window, and what the accounts changed on their own this
 * week, each its own card; what waits on the operator is Today itself.
 */
export function HomeOverview() {
  const overview = useQuery(api.private.home.overview, {})
  if (overview === undefined) return <Skeleton className="h-64 rounded-xl" />
  return (
    <>
      <Growth growth={overview.growth} />
      <Earned earned={overview.earned} />
      <Changes changes={overview.changes} />
    </>
  )
}

function Changes(props: { changes: Overview['changes'] }) {
  const { changes } = props
  return (
    <Card title="Changed on their own" description="This week, by the analyst and the researcher.">
      {changes.count === 0 && <p className="text-sm text-ash">Nothing yet. Each account reviews its strategy on Mondays.</p>}
      <ul className="space-y-3 text-sm empty:hidden">
        {changes.entries.map((entry) => (
          <li key={entry._id} className="min-w-0">
            <Link to="/accounts/$accountId/strategy" params={{ accountId: entry.account._id }} className="line-clamp-2 hover:underline">
              <span className="font-medium">{entry.account.name}:</span> {entry.text}
            </Link>
            <span className="block text-xs text-ash">
              {relativeTime(entry.createdAt)} · by the {entry.actor}
            </span>
          </li>
        ))}
        {changes.count > changes.entries.length && (
          <li className="text-xs text-ash">and {changes.count - changes.entries.length} more in the accounts' journals</li>
        )}
      </ul>
    </Card>
  )
}

/** A count and how it moved against the week before: "12 (+4)", "3 (−1)", or the count alone when it held. */
function Moved(props: { now: number; before: number; unit: string }) {
  const change = props.now - props.before
  return (
    <span className={props.now === 0 ? 'text-ash' : undefined}>
      {props.now} {props.unit}
      {change !== 0 && (
        <span className={change > 0 ? 'ml-1 text-xs text-field-green-deep' : 'ml-1 text-xs text-signal-red-deep'}>
          ({change > 0 ? '+' : '−'}
          {Math.abs(change)})
        </span>
      )}
    </span>
  )
}

/** Each account's signups and paid of the last week against the week before, and the test it runs now. */
function Growth(props: { growth: Overview['growth'] }) {
  const { growth } = props
  return (
    <Card
      title={`Last ${growth.days} days`}
      description={`Signups and paid against the ${growth.days} days before.${growth.mock ? ' Mock numbers.' : ''}`}
    >
      {growth.accounts.length === 0 && <p className="text-sm text-ash">No account yet.</p>}
      <ul className="space-y-3 text-sm empty:hidden">
        {growth.accounts.map((row) => (
          <li key={row.account._id} className="min-w-0">
            <Link to="/reports/$accountId" params={{ accountId: row.account._id }} className="font-medium hover:underline">
              {row.account.name}
            </Link>
            <p className="tabular flex flex-wrap items-center gap-x-3">
              <Moved now={row.signups} before={row.before.signups} unit="signups" />
              <Moved now={row.paid} before={row.before.paid} unit="paid" />
            </p>
            <p className="truncate text-xs text-ash">{row.testing === null ? 'Testing nothing now.' : `Testing "${row.testing}".`}</p>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function Earned(props: { earned: Overview['earned'] }) {
  const { earned } = props
  const currency = earned.currency
  return (
    <Card
      title={`Earned, last ${earned.days} days`}
      actions={
        <Link to="/reports" className={`text-xs text-ash ${ROW_LINK}`}>
          Reports
        </Link>
      }
    >
      {currency === null && <p className="text-sm text-ash">No account yet.</p>}
      {currency !== null && (
        <>
          <ul className="space-y-2 text-sm">
            {earned.accounts.map((row) => (
              <li key={row.account._id} className="tabular grid grid-cols-[auto_1fr_auto] items-center gap-2">
                <AccountMark platform={row.account.platform} size={20} state="idle" />
                <Link to="/reports/$accountId" params={{ accountId: row.account._id }} className="truncate hover:underline">
                  {row.account.name}
                </Link>
                <span className={row.value === 0 ? 'text-ash' : undefined}>
                  {formatMoney(row.value, currency)}
                  <span className="ml-2 text-xs text-ash">{row.paid} paid</span>
                </span>
              </li>
            ))}
          </ul>
          <p
            className="mt-2 text-xs text-ash"
            title="Paid conversions times the value of one, first touch, short of visitors who declined cookies."
          >
            An estimate, first touch.{earned.mock && ' Mock numbers.'}
          </p>
        </>
      )}
    </Card>
  )
}
