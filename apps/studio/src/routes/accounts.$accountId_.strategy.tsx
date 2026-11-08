import { api } from '@influstep/convex/_generated/api'
import type { Doc, Id } from '@influstep/convex/_generated/dataModel'
import {
  EXPERIMENT_KINDS,
  EXPERIMENT_KIND_LABELS,
  JOURNAL_KIND_LABELS,
  EXPERIMENT_METRIC_LABELS,
  itemsNoun,
  effectiveVariant,
  pillarWeights,
} from '@influstep/shared'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import type { FunctionReturnType } from 'convex/server'
import React from 'react'
import { JobState } from '@/components/status'
import { AccountFrame } from '@/components/account-frame'
import { Button, Card, Collapsible, ErrorLine, Meter, Skeleton, Spinner } from '@/components/ui'
import { errorMessage } from '@/lib/errors'
import { formatCount, formatDate, formatDateTime, formatNumber } from '@/lib/format'
import { ACTOR_WORDS, nextReviewAt, wholePercents } from '@/lib/strategy'
import { useNow } from '@/lib/use-now'

// `$accountId_`: the same /accounts/:id/strategy address, outside the account page's route, like the voice page. The
// account page renders no outlet, so a route nested under it would show the account page and never this one.
export const Route = createFileRoute('/accounts/$accountId_/strategy')({ component: StrategyPage })

/*
 * Where the page reads from (docs/plan.md v0.2, slice 8):
 * - private.accounts.get: the account (its stored strategy, pillars, formats, timezone) and its posts, whose
 *   titles name the journal's evidence.
 * - private.experiments.list for the account: the running experiment with its per-variant stats and createdBy, and
 *   the names of the experiments a learning or a journal entry points at. The Experiments page shows the same rows.
 * - private.strategy.get: `goal`, the workspace's goal with the account's goal note in force (null before the first
 *   review), `learnings` (the account's learning rows in memory, active and superseded) and `journal` (its
 *   journal rows), which the page orders itself, newest first, `reviewJob`, the account's newest review_strategy
 *   job (null before the first), for Review now, and `signals`, the id and title of each signal a journal entry
 *   names as evidence (a swapped concept's two signals), so the entry can name them.
 * The pillar weights and the defaults in force are never read raw: they go through shared pillarWeights and
 * effectiveStyle, the one rule for each.
 */
type AccountData = NonNullable<FunctionReturnType<typeof api.private.accounts.get>>
type StrategyData = NonNullable<FunctionReturnType<typeof api.private.strategy.get>>
type Learning = StrategyData['learnings'][number]
type JournalEntry = StrategyData['journal'][number]
type ExperimentRow = FunctionReturnType<typeof api.private.experiments.list>[number]

/** The names of the account's experiments by id, for the links of its learnings and its journal. */
type ExperimentNames = Map<Id<'experiments'>, string>

/**
 * An account's strategy (DESIGN.md, Strategy page), in the account's frame:
 * the goal and where the account stands against it, what it tests now and
 * the journal of every change with its reasons; beside them the pillar
 * weights the planner follows, what it does by default and what it learned.
 */
function StrategyPage() {
  const params = Route.useParams()
  const accountId = params.accountId as Id<'accounts'>
  const data = useQuery(api.private.accounts.get, { accountId })
  const strategy = useQuery(api.private.strategy.get, { accountId })
  const experiments = useQuery(api.private.experiments.list, { accountId })
  const review = useReviewNow(accountId, strategy?.reviewJob ?? null)
  const now = useNow(60_000)
  const loaded = data != null && strategy != null && experiments !== undefined
  return (
    <AccountFrame
      accountId={accountId}
      tab="strategy"
      lead={
        <>
          {data != null && <p className="text-ash">{reviewTimes(data.account, now)}</p>}
          {/* Mounted before the first review exists, so the job appearing is announced, and every status after it. */}
          <div aria-live="polite" className="mt-1 space-y-2 empty:hidden">
            {strategy?.reviewJob && <JobState job={strategy.reviewJob} />}
            {review.error !== null && <ErrorLine>{review.error}</ErrorLine>}
          </div>
        </>
      }
      actions={
        <Button size="sm" aria-busy={review.busy} onClick={() => void review.ask()}>
          {review.busy && <Spinner />}
          Review now
        </Button>
      }
    >
      {!loaded && <Skeleton className="h-96 rounded-xl" />}
      {loaded && <StrategyBody data={data} strategy={strategy} experiments={experiments} />}
    </AccountFrame>
  )
}

function StrategyBody(props: { data: AccountData; strategy: StrategyData; experiments: ExperimentRow[] }) {
  const { data, strategy, experiments } = props
  const account = data.account
  const running = experiments.find((experiment) => experiment.status === 'running')
  const names: ExperimentNames = new Map(experiments.map((experiment) => [experiment._id, experiment.name]))
  return (
    <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="min-w-0 space-y-6">
        <Goal account={account} goal={strategy.goal} />
        <NowTesting account={account} running={running === undefined ? null : running} />
        <Journal entries={strategy.journal} posts={data.posts} signals={strategy.signals} names={names} />
      </div>
      <div className="min-w-0 space-y-6">
        <Pillars account={account} />
        <Defaults account={account} learnings={strategy.learnings} runningKind={running?.kind} />
        <Learnings account={account} learnings={strategy.learnings} names={names} />
      </div>
    </div>
  )
}

/** When the analyst last reviewed the strategy and when it reviews next; a paused account's review waits. */
function reviewTimes(account: Doc<'accounts'>, now: number): string {
  const reviewedAt = account.strategy?.reviewedAt
  const last = reviewedAt === undefined ? 'Not reviewed yet.' : `Reviewed ${formatDate(reviewedAt)}.`
  // The weekly review queues only for accounts that are not paused.
  const next = account.paused
    ? `Paused: the weekly review waits until you resume ${account.name}.`
    : `Next review ${formatDateTime(nextReviewAt(now))}.`
  return `${last} ${next}`
}

/**
 * Review now asks the analyst for a review out of turn. The button is never
 * disabled, so focus stays on it: while the request is out, and while the
 * review waits or runs, it is aria-busy with a spinner. A click during the
 * request is ignored, so one click queues one review; a click while a review
 * is queued reaches the backend, whose refusal says so under the header.
 */
type ReviewState =
  | { status: 'idle' }
  | { status: 'asking' }
  // The review job as it stood at the click (null before the page saw one), so the error lasts only as long as that.
  | { status: 'error'; message: string; job: JobMark | null }

/** A review job at one moment: which job, and in which status. */
type JobMark = { id: Id<'jobs'>; status: Doc<'jobs'>['status'] }

/**
 * The error to show under the header, if any. A refusal such as "already
 * reviewing" is true only while the review job stands as it did at the click;
 * once that review ends, or a review the page had not seen yet appears, the
 * Job state line says what is true and the error would contradict it.
 */
function standingError(state: ReviewState, job: Doc<'jobs'> | null): string | null {
  if (state.status !== 'error') return null
  if (state.job === null) return job === null ? state.message : null
  if (job === null) return null
  if (job._id !== state.job.id || job.status !== state.job.status) return null
  return state.message
}

/** Review now's request and what the page says of it: busy while asked or while the review waits or runs, and a standing refusal. */
function useReviewNow(accountId: Id<'accounts'>, reviewJob: Doc<'jobs'> | null) {
  const reviewNow = useMutation(api.private.strategy.reviewNow)
  const [state, setState] = React.useState<ReviewState>({ status: 'idle' })
  const asking = state.status === 'asking'
  const reviewing = reviewJob?.status === 'queued' || reviewJob?.status === 'running'
  const ask = async () => {
    if (asking) return
    const clicked = reviewJob
    setState({ status: 'asking' })
    try {
      await reviewNow({ accountId })
      setState({ status: 'idle' })
    } catch (caught) {
      const job = clicked === null ? null : { id: clicked._id, status: clicked.status }
      setState({ status: 'error', message: errorMessage(caught), job })
    }
  }
  return { ask, busy: asking || reviewing, error: standingError(state, reviewJob) }
}

/**
 * The one goal every account works toward, and the goal note the last review
 * left: paid customers this span against the one before, and what comes next.
 */
function Goal(props: { account: Doc<'accounts'>; goal: StrategyData['goal'] }) {
  const note = props.goal.note
  return (
    <Card title="Goal">
      <h3 className="font-medium">{props.goal.text}</h3>
      {note === null && <p className="mt-0.5 text-ash">No standing yet. Every review says where {props.account.name} stands.</p>}
      {note !== null && (
        <>
          <p className="mt-0.5">{note.text}</p>
          <p className="mt-0.5 text-[11px] text-ash">
            {formatDate(note.createdAt)} · {ACTOR_WORDS[note.actor]}
          </p>
        </>
      )}
    </Card>
  )
}

/**
 * The one experiment running: what it compares, on which metric, who chose
 * it, and how far each variant is from the items it needs before the
 * analyst can decide.
 */
function NowTesting(props: { account: Doc<'accounts'>; running: ExperimentRow | null }) {
  const running = props.running
  if (running === null) {
    return (
      <Card title="Now testing">
        <p className="text-sm text-ash">Nothing running. The next review picks one.</p>
      </Card>
    )
  }
  const denominator = itemsNoun(running.kind)
  return (
    <Card title="Now testing">
      <h3 className="font-medium">{running.name}</h3>
      <p className="mt-0.5 text-xs text-ash">
        On {EXPERIMENT_METRIC_LABELS[running.metric]} ·{' '}
        {running.createdBy === 'operator' ? 'set up by you' : `picked by ${props.account.name}`} ·{' '}
        <Link to="/experiments" className="underline decoration-fog hover:text-ink hover:decoration-ink">
          Experiments
        </Link>
      </p>
      <ul className="mt-4 space-y-4">
        {running.variants.map((variant) => {
          // The backend counts every variant of the experiment, measured or not, so a missing row is a bug.
          const stats = running.stats.find((stat) => stat.key === variant.key)
          if (!stats) throw new Error(`experiment ${running._id} has no stats for its variant "${variant.key}"`)
          const items = stats.items
          return (
            <li key={variant.key}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span>
                  {variant.label}
                  {variant.isControl && <span className="ml-1.5 text-xs text-ash">control</span>}
                </span>
                <span className="tabular font-mono text-[11px] text-ash">
                  {items < running.minItems
                    ? `${formatCount(items)} of ${formatCount(running.minItems)} ${denominator}`
                    : `${formatCount(items)} ${denominator}, enough`}
                </span>
              </div>
              <p className="text-xs text-ash">{variant.description}</p>
              <Meter value={items} max={running.minItems} className="mt-1.5" />
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

/**
 * What every reply does on each dimension unless its experiment varies it:
 * the account's default from a decided experiment, or the catalog's control,
 * "as before". A default names the day it took over and the learning behind it.
 */
function Defaults(props: { account: Doc<'accounts'>; learnings: Learning[]; runningKind: ExperimentRow['kind'] | undefined }) {
  const stored = props.account.strategy?.defaults
  const rows = EXPERIMENT_KINDS.map((kind) => {
    const testedNow = props.runningKind === kind
    const variant = effectiveVariant(kind, {}, stored)
    const decided = stored?.find((entry) => entry.kind === kind)
    const learning =
      decided?.experimentId === undefined
        ? undefined
        : props.learnings.find((entry) => entry.status === 'active' && entry.evidence.experimentId === decided.experimentId)
    return {
      kind,
      changed: !variant.isControl,
      testedNow,
      row: (
        <DefaultRow
          key={kind}
          label={EXPERIMENT_KIND_LABELS[kind]}
          value={variant.isControl ? `${variant.label} (as before)` : variant.label}
          since={decided?.since}
          testedNow={testedNow}
        >
          {learning?.text}
        </DefaultRow>
      ),
    }
  })
  // What a decision changed, or what a test puts in play, is what the operator reads; the rest is the catalog's usual.
  const lead = rows.filter((entry) => entry.changed || entry.testedNow)
  const usual = rows.filter((entry) => !entry.changed && !entry.testedNow)
  return (
    <Card title="Defaults" description="What every post and reply does unless a test varies it.">
      {lead.length === 0 && <p className="mb-2 text-sm text-ash">Every dimension is at its usual setting.</p>}
      {lead.length > 0 && <dl className="divide-y divide-mist">{lead.map((entry) => entry.row)}</dl>}
      {usual.length > 0 && (
        <Collapsible summary={lead.length === 0 ? 'Show them' : 'More as before'} count={usual.length} className="mt-2">
          <dl className="divide-y divide-mist">{usual.map((entry) => entry.row)}</dl>
        </Collapsible>
      )}
    </Card>
  )
}

/** One dimension's row: its label, the variant in force with when it took over, and an ash line under it. */
function DefaultRow(props: { label: string; value: string; since?: number; testedNow: boolean; children: React.ReactNode }) {
  return (
    <div className="py-2.5 text-sm">
      <dt className="text-xs text-ash">{props.label}</dt>
      <dd className="mt-0.5 min-w-0">
        <p>
          {props.value}
          {props.since !== undefined && <span className="text-xs text-ash"> · since {formatDate(props.since)}</span>}
          {props.testedNow && <span className="text-xs text-ash"> · being tested now</span>}
        </p>
        {props.children !== undefined && <p className="text-xs text-ash">{props.children}</p>}
      </dd>
    </div>
  )
}

/** How the planner shares the evergreen slots between the pillars, in the account's pillar order. */
function Pillars(props: { account: Doc<'accounts'> }) {
  const weights = pillarWeights(props.account.pillars, props.account.strategy?.pillarWeights)
  const percents = wholePercents(weights.map((entry) => entry.weight))
  return (
    <Card title="Pillars" description="Reactive posts follow the signals; the rest of the week is shared out by these weights.">
      <ul className="space-y-3 text-sm">
        {weights.map((entry, index) => (
          <li key={entry.pillar}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate">{entry.pillar}</span>
              <span className="tabular font-mono text-[11px] text-ash">{percents[index]}%</span>
            </div>
            <Meter value={entry.weight} max={1} className="mt-1.5" />
          </li>
        ))}
      </ul>
    </Card>
  )
}

/**
 * What the account learned from its decided experiments and from the changes
 * its reviews made, which the writer reads before every post and reply. A newer
 * learning on the same subject supersedes an older one, which stays under
 * Earlier, so the account can show why it changed its mind. The rest of its
 * memory is on the Memory page.
 */
function Learnings(props: { account: Doc<'accounts'>; learnings: Learning[]; names: ExperimentNames }) {
  const newestFirst = [...props.learnings].sort((a, b) => b.createdAt - a.createdAt)
  const active = newestFirst.filter((learning) => learning.status === 'active')
  const earlier = newestFirst.filter((learning) => learning.status === 'superseded')
  return (
    <Card title="Learnings" count={active.length}>
      {active.length === 0 && (
        <p className="text-sm text-ash">Nothing learned yet. Each decided experiment and each change a review makes leaves one.</p>
      )}
      {active.length > 0 && (
        <ul className="space-y-3 text-sm">
          {active.map((learning) => (
            <LearningRow key={learning._id} learning={learning} names={props.names} />
          ))}
        </ul>
      )}
      {earlier.length > 0 && (
        <Collapsible summary="Earlier" count={earlier.length} className="mt-3">
          <ul className="space-y-3 text-sm">
            {earlier.map((learning) => (
              <LearningRow key={learning._id} learning={learning} names={props.names} />
            ))}
          </ul>
        </Collapsible>
      )}
      <p className="mt-3 text-xs text-ash">
        Rules, facts and problems are in{' '}
        <Link
          to="/accounts/$accountId/memory"
          params={{ accountId: props.account._id }}
          className="underline decoration-fog hover:text-ink hover:decoration-ink"
        >
          Memory
        </Link>
        .
      </p>
    </Card>
  )
}

function LearningRow(props: { learning: Learning; names: ExperimentNames }) {
  const learning = props.learning
  return (
    <li>
      <p>{learning.text}</p>
      <p className="mt-0.5 text-[11px] text-ash">
        {formatDate(learning.createdAt)}
        {learning.evidence.experimentId !== undefined && (
          <ExperimentLink experimentId={learning.evidence.experimentId} names={props.names} />
        )}
      </p>
    </li>
  )
}

/** An experiment named as evidence, linking the Experiments page, which has no page per experiment. */
function ExperimentLink(props: { experimentId: Id<'experiments'>; names: ExperimentNames }) {
  const name = props.names.get(props.experimentId)
  if (name === undefined) return null
  return (
    <>
      {' · '}
      <Link to="/experiments" className="underline decoration-fog hover:text-ink hover:decoration-ink">
        {name}
      </Link>
    </>
  )
}

/**
 * Every change to the strategy, newest first: what changed, why, with the
 * numbers and the evidence it rests on, and who made it. Last on the page: it
 * explains the sections above it.
 */
function Journal(props: {
  entries: JournalEntry[]
  posts: AccountData['posts']
  signals: StrategyData['signals']
  names: ExperimentNames
}) {
  const newestFirst = [...props.entries].sort((a, b) => b.createdAt - a.createdAt)
  const titles = new Map(props.posts.map((post) => [post._id, post.title]))
  const signalTitles = new Map(props.signals.map((signal) => [signal._id, signal.title]))
  return (
    <Card title="Journal" count={newestFirst.length} description="Every change, newest first, with its reason." flush>
      {newestFirst.length === 0 && (
        <p className="card-x py-4 text-sm text-ash">No changes yet. Each change a review makes is written here with its reason.</p>
      )}
      {newestFirst.length > 0 && (
        <ol className="divide-y divide-mist">
          {newestFirst.map((entry) => (
            <li key={entry._id} className="card-x py-3 text-sm">
              <p className="text-[11px] text-ash">
                <span className="tabular font-mono">{formatDate(entry.createdAt)}</span> · {JOURNAL_KIND_LABELS[entry.kind]} ·{' '}
                {ACTOR_WORDS[entry.actor]}
              </p>
              <p className="mt-0.5">{entry.text}</p>
              <p className="mt-0.5 text-xs text-ash">{entry.reason}</p>
              <JournalDetails entry={entry} titles={titles} signalTitles={signalTitles} names={props.names} />
            </li>
          ))}
        </ol>
      )}
    </Card>
  )
}

/**
 * The numbers and the evidence an entry rests on, folded: the sentence and its
 * reason say what changed and why, and these are there to check it.
 */
function JournalDetails(props: {
  entry: JournalEntry
  titles: Map<Id<'posts'>, string>
  signalTitles: Map<Id<'signals'>, string>
  names: ExperimentNames
}) {
  const numbers = props.entry.evidence.numbers
  const evidence = <EvidenceLinks entry={props.entry} titles={props.titles} signalTitles={props.signalTitles} names={props.names} />
  if (numbers.length === 0 && !hasEvidence(props.entry, props.titles, props.signalTitles, props.names)) return null
  return (
    <details className="mt-1">
      <summary className="w-fit cursor-pointer text-[11px] text-ash hover:text-ink">Numbers and evidence</summary>
      {numbers.length > 0 && (
        <dl className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px]">
          {numbers.map((number) => (
            <div key={number.label} className="flex gap-1.5">
              <dt className="text-ash">{number.label}</dt>
              <dd className="tabular font-mono text-graphite">{formatNumber(number.value)}</dd>
            </div>
          ))}
        </dl>
      )}
      {evidence}
    </details>
  )
}

function hasEvidence(
  entry: JournalEntry,
  titles: Map<Id<'posts'>, string>,
  signalTitles: Map<Id<'signals'>, string>,
  names: ExperimentNames
): boolean {
  const experimentId = entry.evidence.experimentId
  if (experimentId !== undefined && names.has(experimentId)) return true
  if (entry.evidence.postIds.some((postId) => titles.has(postId))) return true
  return entry.evidence.signalIds.some((signalId) => signalTitles.has(signalId))
}

/**
 * The experiment, the posts and the signals a journal entry rests on, as
 * links. A post or a signal no longer listed shows nothing. A signal links
 * the Signals page, filtered to the account, which has no page per signal.
 */
function EvidenceLinks(props: {
  entry: JournalEntry
  titles: Map<Id<'posts'>, string>
  signalTitles: Map<Id<'signals'>, string>
  names: ExperimentNames
}) {
  const experimentId = props.entry.evidence.experimentId
  const experimentName = experimentId === undefined ? undefined : props.names.get(experimentId)
  const posts = props.entry.evidence.postIds.flatMap((postId) => {
    const title = props.titles.get(postId)
    return title === undefined ? [] : [{ postId, title }]
  })
  const signals = props.entry.evidence.signalIds.flatMap((signalId) => {
    const title = props.signalTitles.get(signalId)
    return title === undefined ? [] : [{ signalId, title }]
  })
  if (experimentName === undefined && posts.length === 0 && signals.length === 0) return null
  return (
    <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-ash">
      <span>Evidence</span>
      {experimentName !== undefined && (
        <Link to="/experiments" className="underline decoration-fog hover:text-ink hover:decoration-ink">
          {experimentName}
        </Link>
      )}
      {posts.map((post) => (
        <Link
          key={post.postId}
          to="/posts/$postId"
          params={{ postId: post.postId }}
          className="underline decoration-fog hover:text-ink hover:decoration-ink"
        >
          {post.title}
        </Link>
      ))}
      {signals.map((signal) => (
        <Link
          key={signal.signalId}
          to="/signals"
          search={{ account: props.entry.accountId }}
          className="underline decoration-fog hover:text-ink hover:decoration-ink"
        >
          {signal.title}
        </Link>
      ))}
    </p>
  )
}
