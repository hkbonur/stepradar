import { api } from '@influstep/convex/_generated/api'
import type { Id } from '@influstep/convex/_generated/dataModel'
import {
  CONVERSION_KIND_LABELS,
  EXPERIMENT_KIND_LABELS,
  EXPERIMENT_METRIC_LABELS,
  isReplyExperimentKind,
  rateText,
  ITEM_REACH_LABELS,
  METRIC_LABELS,
  SPONSOR_SEGMENT_LABELS,
  ACCOUNT_REACH_LABELS,
  VALUE_LABEL,
  countsSource,
  placeOf,
} from '@influstep/shared'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useQuery } from 'convex/react'
import type { FunctionReturnType } from 'convex/server'
import { Funnel, MetricStrip, ReachLine, Trend, reportStrip } from '@/components/charts'
import { ItemNumbers, notReadText } from '@/components/item-numbers'
import { ProbableLine } from '@/components/probable'
import { AccountFrame } from '@/components/account-frame'
import { Alert, AttributionNote, Card, CardList, Empty, LinkButton, MockNote, Pill, Skeleton } from '@/components/ui'
import { formatCount, formatDate, formatDay, formatKnown, formatMoney, plural } from '@/lib/format'

export const Route = createFileRoute('/reports/$accountId')({ component: ReportPage })

type Report = NonNullable<FunctionReturnType<typeof api.private.report.forAccount>>
type PostedItem = Report['posted'][number]

function ReportPage() {
  const params = Route.useParams()
  const accountId = params.accountId as Id<'accounts'>
  const report = useQuery(api.private.report.forAccount, { accountId })
  return (
    <AccountFrame
      accountId={accountId}
      tab="report"
      lead={report != null && <span className="text-ash">Last {report.windowDays} days</span>}
      actions={
        <LinkButton to="/reports" size="sm" variant="ghost">
          All accounts
        </LinkButton>
      }
    >
      {report === undefined && <Skeleton className="h-96 rounded-xl" />}
      {report !== undefined && report !== null && <ReportBody report={report} />}
    </AccountFrame>
  )
}

/**
 * The account's report (DESIGN.md, Report), as cards: where it leaks first,
 * then its numbers with where they come from, its reach line and how it
 * posted as planned, the funnel and the days, its experiments, and every item
 * that went out.
 */
function ReportBody(props: { report: Report }) {
  const { report } = props
  const { account, trend } = report
  const funnel = { ...report.funnel, everyClickCounted: report.funnel.clicks !== null }
  const platform = account.platform
  const place = placeOf(account)
  const nothing = funnel.items === 0 && (funnel.clicks ?? 0) === 0 && report.reachLine === null
  // Where a number comes from: its platform once read; else why it was not, from what the account's reader reads.
  const sourceOf = (value: number | null) => countsSource(place, value !== null || report.reads.counts)
  const reachLabel = ITEM_REACH_LABELS[platform]
  const reach = {
    label: reachLabel,
    value: funnel.reach,
    note: `${funnel.reached} of ${funnel.items} items`,
    source: sourceOf(funnel.reach),
  }
  if (nothing) return <Empty>Nothing measured yet. Once you post a draft and the match finds it, the analyst fills this page.</Empty>
  return (
    <div className="space-y-6">
      {report.leak !== null && (
        <Alert tone="warning" title="Where the funnel leaks">
          {report.leak.text}
        </Alert>
      )}
      <Card
        title="The numbers"
        footer={
          <div className="space-y-1.5">
            <AttributionNote />
            <MockNote when={funnel.mock || report.reachLine?.mock === true} />
            <ProbableLine probable={report.probable} currency={report.currency} />
          </div>
        }
      >
        <MetricStrip items={reportStrip(funnel, reach, sourceOf(funnel.replies), report.currency)} />
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <ReachLineCard report={report} />
        <Card title="Posted as planned" description="The posts due each week, and how many went out.">
          <ul className="tabular grid grid-cols-2 gap-3 text-sm">
            {report.posting.map((week, index) => (
              <li key={week.weekStart} className="rounded-lg bg-paper-tint px-3 py-2">
                <span className="text-xs text-ash">
                  {index === report.posting.length - 1
                    ? 'This week'
                    : `Week of ${formatDay(week.weekStart, { month: 'short', day: 'numeric' })}`}
                </span>
                <span className="block font-medium">
                  {week.due === 0 ? <span className="font-normal text-ash">Nothing due</span> : `${week.posted} of ${week.due} posted`}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <Card title={`From ${reachLabel.toLowerCase()} to a paid plan`}>
          <Funnel data={{ ...funnel, reach }} />
        </Card>
        <Card title="Per day">
          <Trend points={trend} reachLabel={reachLabel} />
        </Card>
      </div>

      <Card title="Experiments" count={report.experiments.length} flush>
        {report.experiments.length === 0 && <p className="card-x py-4 text-sm text-ash">No experiments for this account.</p>}
        <CardList>
          {report.experiments.map((experiment) => (
            <li key={experiment._id} className="text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Link to="/experiments" className="font-medium hover:underline">
                  {experiment.name}
                </Link>
                <Pill tint={experiment.status === 'running' ? 'field-green' : experiment.status === 'decided' ? 'ink' : 'fog'}>
                  {experiment.status}
                </Pill>
                <span className="text-xs text-ash">
                  {EXPERIMENT_KIND_LABELS[experiment.kind]} on {EXPERIMENT_METRIC_LABELS[experiment.metric]}
                </span>
              </div>
              <div className="tabular mt-1 flex flex-wrap gap-x-5 gap-y-1 text-xs text-graphite">
                {experiment.stats.map((stat) => (
                  <span key={stat.key}>
                    {experiment.variants.find((variant) => variant.key === stat.key)?.label ?? stat.key}{' '}
                    <span className="text-ink">{stat.items > 0 ? rateText(experiment.metric, stat.rate) : 'no data'}</span>{' '}
                    <span className="text-ash">
                      · {stat.items}{' '}
                      {isReplyExperimentKind(experiment.kind)
                        ? plural(stat.items, 'reply', 'replies')
                        : plural(stat.items, 'post', 'posts')}
                    </span>
                  </span>
                ))}
              </div>
              {experiment.decision && <p className="mt-1 text-xs text-ash">{experiment.decision.note}</p>}
            </li>
          ))}
        </CardList>
      </Card>

      <Card title="What went out" count={report.posted.length} flush>
        {report.posted.length === 0 && (
          <p className="card-x py-4 text-sm text-ash">Nothing went out in the last {report.windowDays} days.</p>
        )}
        {report.posted.length > 0 && (
          <PostedTable items={report.posted} currency={report.currency} missing={notReadText(place, report.reads.counts)} />
        )}
      </Card>
    </div>
  )
}

/**
 * The account's reach line (CONTEXT.md, "Report"), as a card: its karma or
 * followers at each day's last read, how far it moved over the window, and
 * where it was read; a reader that cannot read it says so.
 */
function ReachLineCard(props: { report: Report }) {
  const { account, reachLine, reads, windowDays } = props.report
  const label = ACCOUNT_REACH_LABELS[account.platform]
  const place = placeOf(account)
  return (
    <Card title={label}>
      {reachLine === null && (
        <p className="text-sm text-ash">{reads.account ? `Not read in the last ${windowDays} days yet.` : countsSource(place, false)}</p>
      )}
      {reachLine !== null && (
        <div className="grid gap-4 sm:grid-cols-[9rem_1fr] sm:items-end">
          <div>
            <p className="text-metric tabular">{formatCount(reachLine.latest)}</p>
            <p className="tabular text-xs text-ash">
              {reachLine.change >= 0 ? '+' : ''}
              {formatCount(reachLine.change)} in {windowDays} days
            </p>
            <p className="mt-0.5 text-[11px] text-ash">{countsSource(place, reads.account)}</p>
          </div>
          <ReachLine points={reachLine.points} label={label} />
        </div>
      )}
    </Card>
  )
}

/** Every post and reply that went out in the window, newest first, with its numbers and, for a post, what it did for the sponsor. */
function PostedTable(props: { items: PostedItem[]; currency: string; missing: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="card-table w-full text-sm">
        <thead className="bg-paper-tint text-xs text-ash">
          <tr className="text-left">
            <th className="py-2 pr-4 font-medium">Day</th>
            <th className="py-2 font-medium">What went out</th>
            <th className="py-2 pl-3 font-medium">On the platform</th>
            <th className="py-2 pl-3 text-right font-medium">{METRIC_LABELS.clicks}</th>
            <th className="py-2 pl-3 text-right font-medium">{CONVERSION_KIND_LABELS.signup}</th>
            <th className="py-2 pl-3 text-right font-medium">{CONVERSION_KIND_LABELS.paid}</th>
            <th className="py-2 pl-3 text-right font-medium">{VALUE_LABEL}</th>
          </tr>
        </thead>
        <tbody className="tabular">
          {props.items.map((item) => (
            <tr key={item._id} className="border-t border-mist align-baseline">
              <td className="py-2.5 pr-4 font-mono text-xs whitespace-nowrap text-ash">{formatDate(item.postedAt)}</td>
              <td className="max-w-[28rem] py-2.5">
                <PostedWhat item={item} />
              </td>
              <td className="py-2.5 pl-3 text-xs text-ash">
                <span className="flex flex-wrap gap-x-2">
                  <ItemNumbers numbers={item.numbers} missing={props.missing} />
                </span>
              </td>
              {item.kind === 'post' ? (
                <>
                  <td className="py-2.5 pl-3 text-right">{formatKnown(item.clicks)}</td>
                  <td className="py-2.5 pl-3 text-right">{item.signups}</td>
                  <td className="py-2.5 pl-3 text-right">{item.paid}</td>
                  <td className="py-2.5 pl-3 text-right">{formatMoney(item.value, props.currency)}</td>
                </>
              ) : (
                // A reply carries no tracked link, so it has no clicks or conversions of its own.
                <td colSpan={4} className="py-2.5 pl-3 text-right text-xs text-ash">
                  {item.kind === 'reply' ? 'reply' : 'without a draft'}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** A post by its title, linked to its page; a reply by its words and what it answers; an item posted without a draft by its words. */
function PostedWhat(props: { item: PostedItem }) {
  const item = props.item
  if (item.kind === 'post') {
    return (
      <>
        <Link to="/posts/$postId" params={{ postId: item._id }} className="hover:underline">
          {item.title}
        </Link>
        {item.sponsorSegment !== 'none' && <span className="ml-2 text-xs text-ash">{SPONSOR_SEGMENT_LABELS[item.sponsorSegment]}</span>}
      </>
    )
  }
  if (item.kind === 'item') return <span className="line-clamp-1">{item.text}</span>
  return (
    <>
      <span className="line-clamp-1">{item.text}</span>
      <span className="line-clamp-1 text-xs text-ash">to {item.answers}</span>
    </>
  )
}
