import { api } from '@influstep/convex/_generated/api'
import { CONVERSION_KIND_LABELS, ITEM_REACH_LABELS, METRIC_LABELS, ACCOUNT_REACH_LABELS, VALUE_LABEL } from '@influstep/shared'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useQuery } from 'convex/react'
import type { FunctionReturnType } from 'convex/server'
import { Funnel, MetricStrip, reportStrip } from '@/components/charts'
import { AccountMark } from '@/components/account-mark'
import { ProbableLine } from '@/components/probable'
import { AttributionNote, Card, Empty, MockNote, Mono, PageHeader, Skeleton } from '@/components/ui'
import { cn } from '@/lib/cn'
import { formatCount, formatKnown, formatMoney, formatPercent, plural } from '@/lib/format'

export const Route = createFileRoute('/reports/')({ component: WorkspaceReport })

type Report = FunctionReturnType<typeof api.private.report.forWorkspace>
type Total = Report['total']
type Row = Report['accounts'][number]
type Group = Report['whatWorks']['pillar'][number]

/**
 * The workspace report (DESIGN.md, Reports): every account together, then one
 * row per account with the same columns, then what works across them. A
 * account's row opens its own report, whose funnel is the same reading.
 */
function WorkspaceReport() {
  const report = useQuery(api.private.report.forWorkspace, {})
  if (report === undefined) return <Skeleton className="h-96 rounded-xl" />
  const { total } = report
  return (
    <>
      <PageHeader
        title="Reports"
        lead={`Last ${report.windowDays} days, every account together. Open one for its days, posts, replies and experiments.`}
      />
      {report.accounts.length === 0 && <Empty>No accounts to report on.</Empty>}
      {report.accounts.length > 0 && (
        <div className="space-y-6">
          <Card
            title="The numbers"
            footer={
              <div className="space-y-1.5">
                <AttributionNote />
                <MockNote when={total.mock} />
                {report.probable.map((probable) => (
                  <ProbableLine key={probable.platform} probable={probable} currency={report.currency} />
                ))}
              </div>
            }
          >
            {/* Each platform counts reach its own way, so the accounts' rows below carry it, and the total starts at the comments. */}
            <MetricStrip items={reportStrip(total, null, 'Read from each platform', report.currency)} />
          </Card>

          <Card title="Accounts" count={report.accounts.length} description="The most value first. Each opens its own report." flush>
            <AccountTable report={report} />
          </Card>

          <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
            <Card title="From a comment to a paid plan">
              <Funnel data={{ ...total, reach: null }} />
            </Card>
            <WhatWorks report={report} />
          </div>
        </div>
      )}
    </>
  )
}

const NUMBER_CELL = 'py-2.5 pl-3 text-right'
const HEAD_CELL = 'py-2 pl-3 text-right font-medium'

/**
 * One row per account, the most value first: its reach and its karma or
 * followers as its platform counts them, then the strip's columns; the
 * totals close it, without reach, which no two platforms count alike.
 */
function AccountTable(props: { report: Report }) {
  const { report } = props
  const cells = (funnel: Omit<Total, 'everyClickCounted'>) => (
    <>
      <td className={NUMBER_CELL}>{formatKnown(funnel.replies)}</td>
      <td className={NUMBER_CELL}>{formatKnown(funnel.clicks)}</td>
      <td className={cn(NUMBER_CELL, 'hidden lg:table-cell')}>{funnel.demos}</td>
      <td className={NUMBER_CELL}>{funnel.signups}</td>
      <td className={cn(NUMBER_CELL, 'hidden lg:table-cell')}>{funnel.trials}</td>
      <td className={NUMBER_CELL}>{funnel.paid}</td>
      <td className={NUMBER_CELL}>{formatMoney(funnel.value, report.currency)}</td>
    </>
  )
  return (
    <div className="overflow-x-auto">
      <table className="card-table w-full text-sm">
        <thead className="bg-paper-tint text-xs text-ash">
          <tr className="text-left">
            <th className="py-2 font-medium">Account</th>
            <th className={HEAD_CELL}>Reach</th>
            <th className={cn(HEAD_CELL, 'hidden sm:table-cell')}>Karma or followers</th>
            <th className={HEAD_CELL}>Comments</th>
            <th className={HEAD_CELL}>{METRIC_LABELS.clicks}</th>
            <th className={cn(HEAD_CELL, 'hidden lg:table-cell')}>{CONVERSION_KIND_LABELS.demo_started}</th>
            <th className={HEAD_CELL}>{CONVERSION_KIND_LABELS.signup}</th>
            <th className={cn(HEAD_CELL, 'hidden lg:table-cell')}>{CONVERSION_KIND_LABELS.trial_started}</th>
            <th className={HEAD_CELL}>{CONVERSION_KIND_LABELS.paid}</th>
            <th className={HEAD_CELL}>{VALUE_LABEL}</th>
          </tr>
        </thead>
        <tbody className="tabular">
          {report.accounts.map((row) => (
            <tr key={row.account._id} className="border-t border-mist">
              <td className="py-2.5">
                <span className="flex min-w-0 items-center gap-2">
                  <AccountMark platform={row.account.platform} size={20} state={row.account.paused ? 'paused' : 'idle'} />
                  <Link to="/reports/$accountId" params={{ accountId: row.account._id }} className="truncate font-medium hover:underline">
                    {row.account.name}
                  </Link>
                  {row.account.paused && <span className="text-xs text-ash">paused</span>}
                </span>
              </td>
              <ReachCells row={row} />
              {cells(row.funnel)}
            </tr>
          ))}
        </tbody>
        {report.accounts.length > 1 && (
          <tfoot className="tabular border-t border-fog font-medium">
            <tr>
              <td className="py-2.5">All accounts</td>
              <td className={NUMBER_CELL}>–</td>
              <td className={cn(NUMBER_CELL, 'hidden sm:table-cell')}>–</td>
              {cells(report.total)}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}

/** An account's reach in the window and its karma or followers at the last read, each named as its platform counts it; a dash where none was read. */
function ReachCells(props: { row: Row }) {
  const { account, funnel, reach } = props.row
  return (
    <>
      <NamedCount value={funnel.reach} unit={ITEM_REACH_LABELS[account.platform]} />
      <NamedCount value={reach} unit={ACCOUNT_REACH_LABELS[account.platform]} className="hidden sm:table-cell" />
    </>
  )
}

function NamedCount(props: { value: number | null; unit: string; className?: string }) {
  return (
    <td className={cn(NUMBER_CELL, props.className)}>
      {props.value === null ? (
        '–'
      ) : (
        <>
          {formatCount(props.value)} <span className="text-xs text-ash">{props.unit.toLowerCase()}</span>
        </>
      )}
    </td>
  )
}

/**
 * Two ranked lists over every account's measured posts (core/report.ts
 * `whatWorks`): the facts the weekly strategy review moves pillar weight on.
 */
function WhatWorks(props: { report: Report }) {
  const { whatWorks, currency } = props.report
  return (
    <Card
      title="What works"
      description={
        <>
          <span className="tabular">{whatWorks.posts}</span> measured {plural(whatWorks.posts, 'post', 'posts')} of the last{' '}
          {props.report.whatWorksDays} days, ranked by value per post. The strategy reviews weigh pillars on the same numbers.
        </>
      }
    >
      {whatWorks.posts === 0 && <p className="text-sm text-ash">No post has been measured in that time yet.</p>}
      {whatWorks.posts > 0 && (
        <div className="grid gap-6 sm:grid-cols-2">
          <GroupList title="By pillar" groups={whatWorks.pillar} currency={currency} empty="None of these posts has a pillar." />
          <GroupList
            title="By sponsor mention"
            groups={whatWorks.sponsor}
            currency={currency}
            empty="None of these posts has a sponsor line."
          />
        </div>
      )}
    </Card>
  )
}

function GroupList(props: { title: string; groups: Group[]; currency: string; empty: string }) {
  return (
    <div className="min-w-0">
      <h3 className="mb-2 text-xs font-medium text-graphite">{props.title}</h3>
      {props.groups.length === 0 && <p className="text-ash">{props.empty}</p>}
      {props.groups.length > 0 && (
        <ol className="divide-y divide-mist">
          {props.groups.map((group) => (
            <li key={group.key} className="grid grid-cols-[1fr_auto] items-baseline gap-x-4 py-2 text-sm">
              <span className="truncate">{group.label}</span>
              <span className="tabular text-right">
                {formatMoney(group.valuePerPost, props.currency)}
                <span className="text-xs text-ash"> per post</span>
              </span>
              <span className="tabular col-span-2 text-xs text-ash">
                {group.clicksPerReach === null ? 'Clicks not counted' : `${formatPercent(group.clicksPerReach, 2)} clicks per reach`} ·{' '}
                <Mono>{group.posts}</Mono> {plural(group.posts, 'post', 'posts')}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
