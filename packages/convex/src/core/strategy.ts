import {
  AUTO_MIN_CONFIDENCE,
  EXPERIMENT_KIND_LABELS,
  EXPERIMENT_METRIC_LABELS,
  EXPERIMENT_KINDS,
  REVIEW_MIN_ITEMS,
  accountCatalog,
  contradictionMinItems,
  contradicts,
  grouped,
  rateText,
  isReplyExperimentKind,
  itemsNoun,
  reviewMetric,
  pickNextExperiment,
  pillarWeights,
  communityLabel,
  reachOf,
  shiftPillarWeights,
  shiftWeights,
  postsToMetCommunity,
  LEAK_DIMENSIONS,
  type ItemRead,
  variantRate,
  workspaceGoal,
  type CatalogVariant,
  type ExperimentHistoryRow,
  type ExperimentKind,
  type ExperimentMetric,
  type NextExperiment,
  type PillarScore,
} from '@influstep/shared'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { activeCommunities, communitiesOf, sameCommunity } from './communities'
import { dayKey } from './dates'
import { leakOf, leakReason, type AccountLeak } from './growth'
import { measurableMetrics, startExperiment, variantStatsSince } from './experiments'
import { activeEntries, supersedeOthers } from './memory'
import { WHAT_WORKS_DAYS, measuredPostsSince, postOutcomes, rankGroups, reportFunnel } from './report'
import { workspaceOf } from './workspace'

/**
 * The weekly strategy review. Every rule it applies is deterministic: the pure rules live in shared experiments.ts,
 * and this file reads the account's numbers for them and writes what they
 * decide, each change with a journal entry that says why.
 */

type Reader = { db: QueryCtx['db'] }
type Strategy = NonNullable<Doc<'accounts'>['strategy']>

const DAY_MS = 24 * 60 * 60 * 1000
/** Measured posts of this many days score the pillars: the report's "what works" window. */
const PILLAR_WINDOW_DAYS = WHAT_WORKS_DAYS
/** How far back a decided experiment counts toward what the account knows about a dimension; shared pickNextExperiment's window. */
const DECISION_MEMORY_DAYS = 180
/** The newest journal entries the strategy page shows. */
const JOURNAL_PAGE = 200
/** Paid conversions of this many days, against the same span before it, say where an account stands against the goal. */
const STANDING_WINDOW_DAYS = 28

export interface ReviewOutcome {
  /** Changes made, one journal entry each. */
  changes: number
  startedExperimentId?: Id<'experiments'>
  /** The goal note this review left (every review leaves one). */
  goalNoteId: Id<'memories'>
}

/**
 * A change the review made, as a learning in the account's memory: what the
 * numbers showed and what the account does since. `key` names the subject; a
 * newer learning on it supersedes the older one, so the writer reads only
 * what the account believes now.
 */
async function writeLearning(
  ctx: MutationCtx,
  account: Doc<'accounts'>,
  args: { text: string; key: string; postIds: Id<'posts'>[]; now: number }
): Promise<void> {
  const learningId = await ctx.db.insert('memories', {
    accountId: account._id,
    kind: 'learning',
    text: args.text,
    actor: 'analyst',
    evidence: { postIds: [...new Set(args.postIds)], signalIds: [] },
    key: args.key,
    status: 'active',
    createdAt: args.now,
  })
  await supersedeOthers(ctx, { _id: learningId, accountId: account._id, kind: 'learning' }, (older) => older.key === args.key)
}

/** One change of the review: the journal entry is written; the phrase goes into the one chat message. */
interface Change {
  phrase: string
}

function percent(weight: number): number {
  return Math.round(weight * 100)
}

function joinAnd(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join('')
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

function withoutPeriod(text: string): string {
  return text.trim().replace(/[.!?]$/, '')
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1)
}

/**
 * The pillar weights step: each pillar's value per measured post of the last
 * 28 days (paid conversions of its posts times the workspace's value per
 * paid), with signups per post to break a tie, which every platform counts, then
 * shared `shiftPillarWeights`. The scores are the report's "what works" by
 * pillar for this account alone (core/report.ts `rankGroups`), so the
 * operator reads the numbers the review acts on.
 */
async function reviewPillars(
  ctx: MutationCtx,
  account: Doc<'accounts'>,
  strategy: Strategy,
  posts: Doc<'posts'>[],
  conversions: Doc<'conversions'>[],
  now: number
): Promise<{ strategy: Strategy; change: Change } | null> {
  const workspace = await workspaceOf(ctx, account)
  const outcomes = await postOutcomes(
    ctx,
    account.platform,
    measuredPostsSince(posts, now - PILLAR_WINDOW_DAYS * DAY_MS),
    conversions,
    workspace.valuePerPaid
  )
  const groups = rankGroups(outcomes, (post) =>
    post.pillar !== undefined && account.pillars.includes(post.pillar) ? { key: post.pillar, label: post.pillar } : null
  )
  const scores: (PillarScore & { postIds: Id<'posts'>[] })[] = groups.map((group) => ({
    pillar: group.key,
    score: group.valuePerPost,
    tiebreak: group.signupsPerPost,
    posts: group.posts,
    postIds: group.postIds,
  }))
  const before = pillarWeights(account.pillars, strategy.pillarWeights)
  const shift = shiftPillarWeights(before, scores)
  if (!shift) return null
  const { up, down } = shift.change
  const upScore = scores.find((score) => score.pillar === up)
  const downScore = scores.find((score) => score.pillar === down)
  if (!upScore || !downScore) throw new Error(`the pillar shift moved between "${up}" and "${down}" without both scores`)
  const weightOf = (weights: readonly { pillar: string; weight: number }[], pillar: string) => {
    const entry = weights.find((candidate) => candidate.pillar === pillar)
    if (!entry) throw new Error(`pillar "${pillar}" has no weight`)
    return entry.weight
  }
  const money = (value: number) => `${grouped(value)} ${workspace.currency}`
  const onValue =
    `Over the last ${PILLAR_WINDOW_DAYS} days "${up}" made ${money(upScore.score)} per measured post over ${upScore.posts} posts, ` +
    `and "${down}" ${money(downScore.score)} over ${downScore.posts}.`
  const onSignups =
    `Over the last ${PILLAR_WINDOW_DAYS} days "${up}" and "${down}" made the same value per measured post, ` +
    `and "${up}" brought ${upScore.tiebreak.toFixed(2)} signups per post against ${downScore.tiebreak.toFixed(2)}.`
  const reason = upScore.score === downScore.score ? onSignups : onValue
  await ctx.db.insert('journal', {
    accountId: account._id,
    kind: 'pillar_weights',
    actor: 'analyst',
    text:
      `"${up}" gets ${percent(weightOf(shift.weights, up))}% of the evergreen plan, up from ${percent(weightOf(before, up))}%, ` +
      `and "${down}" ${percent(weightOf(shift.weights, down))}%, down from ${percent(weightOf(before, down))}%.`,
    reason,
    evidence: {
      postIds: [...upScore.postIds, ...downScore.postIds],
      signalIds: [],
      numbers: [
        { label: `"${up}" value per post (${workspace.currency})`, value: Math.round(upScore.score) },
        { label: `"${down}" value per post (${workspace.currency})`, value: Math.round(downScore.score) },
        { label: `"${up}" signups per post`, value: Math.round(upScore.tiebreak * 100) / 100 },
        { label: `"${down}" signups per post`, value: Math.round(downScore.tiebreak * 100) / 100 },
        { label: `"${up}" weight (%)`, value: percent(weightOf(shift.weights, up)) },
        { label: `"${down}" weight (%)`, value: percent(weightOf(shift.weights, down)) },
      ],
    },
    createdAt: now,
  })
  await writeLearning(ctx, account, {
    text:
      `${reason} So "${up}" gets ${percent(weightOf(shift.weights, up))}% of the evergreen plan ` +
      `and "${down}" ${percent(weightOf(shift.weights, down))}%.`,
    key: 'pillars',
    postIds: [...upScore.postIds, ...downScore.postIds],
    now,
  })
  return {
    strategy: { ...strategy, pillarWeights: shift.weights },
    change: { phrase: `gave "${up}" more of the plan and "${down}" less` },
  }
}

/**
 * The community weights step, on Reddit and on a forum, where the planner
 * sends posts by community (core/planner.ts `communitiesFor`): each
 * subreddit or category the account takes part in (core/communities.ts
 * `activeCommunities`), scored by the signups per measured post of the last
 * 28 days, with reach per post to break a tie, then shared `shiftWeights`:
 * more posts go where they earn more, fewer where they earn nothing. A post
 * there links to the sponsor directly, so no click is counted (shared
 * `countsClicks`); replies are left out, since the weight decides where
 * posts go.
 */
async function reviewCommunities(
  ctx: MutationCtx,
  account: Doc<'accounts'>,
  conversions: readonly Doc<'conversions'>[],
  now: number
): Promise<Change | null> {
  if (!postsToMetCommunity(account.platform)) return null
  const communities = activeCommunities(await communitiesOf(ctx, account._id))
  if (communities.length < 2) return null
  const since = now - PILLAR_WINDOW_DAYS * DAY_MS
  const tally = new Map<string, { items: number; signups: number; reach: number }>()
  const add = (name: string | undefined, signups: number, numbers: ItemRead | undefined) => {
    const community = name === undefined ? undefined : communities.find((candidate) => sameCommunity(candidate.name, name))
    if (!community) return
    const entry = tally.get(community.name) ?? { items: 0, signups: 0, reach: 0 }
    // A reach not read adds nothing.
    const reach = numbers === undefined ? null : reachOf(numbers.counts)
    tally.set(community.name, { items: entry.items + 1, signups: entry.signups + signups, reach: entry.reach + (reach ?? 0) })
  }
  const posts = await ctx.db
    .query('posts')
    .withIndex('by_account_status', (q) => q.eq('accountId', account._id).eq('status', 'measured'))
    .collect()
  for (const post of posts) {
    if (post.posted === undefined || post.posted.at < since || post.removedAt !== undefined) continue
    const signups = conversions.filter((conversion) => conversion.kind === 'signup' && conversion.postId === post._id).length
    add(post.community, signups, post.numbers)
  }
  const total = communities.reduce((sum, community) => sum + community.weight, 0)
  const scores = communities.map((community) => {
    const entry = tally.get(community.name) ?? { items: 0, signups: 0, reach: 0 }
    const per = (value: number) => (entry.items === 0 ? 0 : value / entry.items)
    return { name: community.name, score: per(entry.signups), tiebreak: per(entry.reach), items: entry.items }
  })
  const shift = shiftWeights(
    communities.map((community) => ({ name: community.name, weight: community.weight / total })),
    scores
  )
  if (!shift) return null
  for (const community of communities) {
    const weight = shift.weights.find((entry) => entry.name === community.name)?.weight
    if (weight === undefined) throw new Error(`community ${community.name} lost its weight in the shift`)
    await ctx.db.patch(community._id, { weight })
  }
  const label = (name: string) => communityLabel(account.platform, name)
  const { up, down } = shift.change
  const scoreOf = (name: string) => {
    const score = scores.find((entry) => entry.name === name)
    if (!score) throw new Error(`community ${name} moved without a score`)
    return score
  }
  const weightOf = (name: string) => shift.weights.find((entry) => entry.name === name)?.weight ?? 0
  await ctx.db.insert('journal', {
    accountId: account._id,
    kind: 'community_weights',
    actor: 'analyst',
    text: `${label(up)} gets ${percent(weightOf(up))}% of the posts, and ${label(down)} ${percent(weightOf(down))}%.`,
    reason:
      `Over the last ${PILLAR_WINDOW_DAYS} days ${label(up)} brought ${scoreOf(up).score.toFixed(2)} signups per post over ${scoreOf(up).items} ` +
      `and ${label(down)} ${scoreOf(down).score.toFixed(2)} over ${scoreOf(down).items}, reach per post breaking a tie.`,
    evidence: {
      postIds: [],
      signalIds: [],
      numbers: [
        { label: `${label(up)} signups per post`, value: Math.round(scoreOf(up).score * 100) / 100 },
        { label: `${label(down)} signups per post`, value: Math.round(scoreOf(down).score * 100) / 100 },
        { label: `${label(up)} weight (%)`, value: percent(weightOf(up)) },
        { label: `${label(down)} weight (%)`, value: percent(weightOf(down)) },
      ],
    },
    createdAt: now,
  })
  return { phrase: `sent more posts to ${label(up)} and fewer to ${label(down)}` }
}

/** A default whose numbers since its decision fell to what the variant it beat had then. */
interface Contradiction {
  kind: ExperimentKind
  source: Doc<'experiments'>
  winnerRate: number
  runnerUpRate: number
  since: { rate: number; items: number }
}

/**
 * The contradictions step: every default that came from a decision with the
 * two rates it was decided on, measured since it became the default (core
 * `variantStatsSince`) until it has the review's minimum items (shared
 * `contradictionMinItems`). The operator's own verdict has no rates and is
 * never contradicted by numbers.
 */
async function findContradictions(
  ctx: Reader,
  account: Doc<'accounts'>,
  strategy: Strategy,
  experiments: Doc<'experiments'>[]
): Promise<Contradiction[]> {
  const out: Contradiction[] = []
  for (const entry of strategy.defaults) {
    if (entry.experimentId === undefined) continue
    const source = experiments.find((experiment) => experiment._id === entry.experimentId)
    if (!source) throw new Error(`the ${entry.kind} default came from experiment ${entry.experimentId}, which the account does not have`)
    const decision = source.decision
    if (!decision) throw new Error(`the ${entry.kind} default came from experiment ${source._id}, which has no decision`)
    if (decision.winnerRate === undefined || decision.runnerUpRate === undefined) continue
    const since = await variantStatsSince(ctx, account, entry.kind, entry.key, entry.since, source.metric)
    const rates = { winnerRate: decision.winnerRate, runnerUpRate: decision.runnerUpRate }
    if (!contradicts(rates, since, contradictionMinItems(source.minItems))) continue
    out.push({ kind: entry.kind, source, ...rates, since: { rate: variantRate(since), items: since.items } })
  }
  return out
}

function historyOf(experiments: Doc<'experiments'>[]): ExperimentHistoryRow[] {
  return experiments.flatMap((experiment): ExperimentHistoryRow[] => {
    if (experiment.status === 'running') return []
    const base = { id: experiment._id, kind: experiment.kind, variants: experiment.variants }
    if (experiment.status === 'stopped') return [{ ...base, status: 'stopped' }]
    const decision = experiment.decision
    if (!decision) throw new Error(`experiment ${experiment._id} is decided without a decision`)
    return [
      {
        ...base,
        status: 'decided',
        winnerKey: decision.winnerKey,
        decidedAt: decision.decidedAt,
        // Absent on the operator's verdicts and on decisions from before it was stored (shared `beatenVariant`).
        ...(decision.runnerUpKey === undefined ? {} : { runnerUpKey: decision.runnerUpKey }),
      },
    ]
  })
}

/** How far back the review counts what the account's posts brought, to pick the rung a post experiment aims at. */
const LADDER_DAYS = 28

function hypothesisOf(next: NextExperiment, metric: ExperimentMetric): string {
  const describe = (variant: CatalogVariant) => `"${variant.label}" (${lowerFirst(withoutPeriod(variant.description))})`
  return `${describe(next.challenger)} gets more ${EXPERIMENT_METRIC_LABELS[metric]} than ${describe(next.control)}.`
}

/** Why an experiment aims at its metric (shared `reviewMetric`). */
function goalOf(kind: ExperimentKind, metric: ExperimentMetric): string {
  if (isReplyExperimentKind(kind))
    return 'It aims at reach per reply: a reply carries no link, so reach is the step toward the goal it moves.'
  if (metric === 'reach')
    return `It aims at reach per post: the posts brought too few clicks, signups or paid customers in the last ${LADDER_DAYS} days to test on.`
  return `It aims at ${EXPERIMENT_METRIC_LABELS[metric]}, the step closest to paying customers that the posts brought enough of in the last ${LADDER_DAYS} days.`
}

/** Why the review starts what it starts: the dimension, and the goal metric. */
function startReason(args: {
  next: NextExperiment
  metric: ExperimentMetric
  history: ExperimentHistoryRow[]
  contradiction: Contradiction | undefined
  /** The leak the review aimed the test at, when it did. */
  leak: AccountLeak | null
  timezone: string
  now: number
}): string {
  const { next } = args
  const dimension = EXPERIMENT_KIND_LABELS[next.kind]
  const goal = goalOf(next.kind, args.metric)
  if (args.contradiction) {
    const { source, winnerRate, runnerUpRate, since } = args.contradiction
    return (
      `"${next.control.label}" became the ${dimension.toLowerCase()} default by beating "${next.challenger.label}" ` +
      `${rateText(source.metric, winnerRate)} to ${rateText(source.metric, runnerUpRate)} on ${EXPERIMENT_METRIC_LABELS[source.metric]}. ` +
      `Since then it got ${rateText(source.metric, since.rate)} over ${grouped(since.items)} ${itemsNoun(source.kind)}, ` +
      `no better than "${next.challenger.label}" had, so the two are tested again. ${goal}`
    )
  }
  const decided = args.history.flatMap((row) => (row.kind === next.kind && row.status === 'decided' ? [row] : []))
  const recent = decided.filter((row) => row.decidedAt >= args.now - DECISION_MEMORY_DAYS * DAY_MS)
  const last = decided.reduce<number | null>((latest, row) => (latest === null || row.decidedAt > latest ? row.decidedAt : latest), null)
  const known =
    last === null
      ? `${dimension} was never tested.`
      : recent.length === 0
        ? `${dimension} was last decided on ${dayKey(last, args.timezone)}, more than ${DECISION_MEMORY_DAYS} days ago.`
        : `${dimension} has the fewest decided experiments of the last ${DECISION_MEMORY_DAYS} days, the last on ${dayKey(last, args.timezone)}.`
  // Aimed at a leak (shared `LEAK_DIMENSIONS`), which the journal says in the leak's own words.
  const aimed = args.leak !== null && LEAK_DIMENSIONS[args.leak.step].includes(next.kind) ? ` ${leakReason(args.leak)}` : ''
  return `${known}${aimed} ${goal}`
}

/**
 * The next experiment step: only when none is running. A reply dimension
 * applies to an account that answers anyone (core/formats.ts `listens`), a
 * post dimension to every account, a post kind among the intents its cadence
 * plans (shared `accountCatalog`). A reply experiment aims at reach; a post
 * experiment at the rung of the goal metric ladder the posts brought enough
 * of (shared `reviewMetric`).
 */
async function startNextExperiment(
  ctx: MutationCtx,
  account: Doc<'accounts'>,
  strategy: Strategy,
  experiments: Doc<'experiments'>[],
  contradictions: Contradiction[],
  now: number
): Promise<{ experimentId: Id<'experiments'>; change: Change } | null> {
  if (experiments.some((experiment) => experiment.status === 'running')) return null
  const history = historyOf(experiments)
  const { funnel } = await reportFunnel(ctx, account, LADDER_DAYS, now)
  // A test on a metric nothing reads would run forever and hold the slot: each dimension climbs the ladder over what it can be decided on.
  const measured = await Promise.all(
    EXPERIMENT_KINDS.map(async (kind) => ({ kind, metric: reviewMetric((await measurableMetrics(ctx, account, kind)).metrics, funnel) }))
  )
  const kinds = measured.flatMap(({ kind, metric }) => (metric === null ? [] : [kind]))
  const contradicted = contradictions.map((contradiction) => contradiction.kind)
  const pick = (among: readonly ExperimentKind[]) =>
    pickNextExperiment({
      kinds: among,
      catalog: accountCatalog(account.cadence.intents),
      history,
      defaults: strategy.defaults,
      contradicted,
      now,
    })
  // Where the posts lose people (core/growth.ts `leakOf`), the review first tests a dimension that moves that step and can
  // be decided past reach, a contradicted default still before anything else; with none of those, what it knows least about.
  const leak = await leakOf(ctx, account, now)
  const aimed = leak === null ? [] : LEAK_DIMENSIONS[leak.step].filter((kind) => decidedPastReach(measured, kind))
  const aimedPick = aimed.length === 0 ? null : pick(kinds.filter((kind) => aimed.includes(kind) || contradicted.includes(kind)))
  const next = aimedPick ?? pick(kinds)
  if (!next) return null
  const retest = next.retestOf === undefined ? undefined : experiments.find((experiment) => experiment._id === next.retestOf)
  if (next.retestOf !== undefined && !retest)
    throw new Error(`the re-test points at experiment ${next.retestOf}, which the account does not have`)
  const contradiction = retest ? contradictions.find((candidate) => candidate.source._id === retest._id) : undefined
  const name = `${EXPERIMENT_KIND_LABELS[next.kind]}: ${next.challenger.label} vs ${next.control.label}`
  const metric = measured.find((entry) => entry.kind === next.kind)?.metric
  if (metric === undefined || metric === null) throw new Error(`the review picked ${next.kind}, which it cannot measure`)
  const experimentId = await startExperiment(
    ctx,
    account,
    {
      name,
      hypothesis: hypothesisOf(next, metric),
      kind: next.kind,
      metric,
      variants: [next.control, next.challenger],
      minItems: REVIEW_MIN_ITEMS,
      minConfidence: AUTO_MIN_CONFIDENCE,
      createdBy: 'analyst',
      ...(retest ? { retestOf: retest._id } : {}),
      reason: startReason({ next, metric, history, contradiction, leak, timezone: account.timezone, now }),
    },
    now
  )
  const phrase = retest
    ? `started testing "${next.control.label}" against "${next.challenger.label}" again, because later numbers no longer back it`
    : `started "${name}"`
  return { experimentId, change: { phrase } }
}

/** Whether the review's reading of a dimension climbs past reach: a test on reach alone says nothing of who clicks. */
function decidedPastReach(measured: readonly { kind: ExperimentKind; metric: ExperimentMetric | null }[], kind: ExperimentKind): boolean {
  const metric = measured.find((entry) => entry.kind === kind)?.metric
  return metric !== undefined && metric !== null && metric !== 'reach'
}

/** Where an account stands against the goal: paid conversions of two spans, what one is worth, and what it tries next. */
export interface GoalStanding {
  windowDays: number
  paid: number
  previousPaid: number
  valuePerPaid: number
  currency: string
  /** The experiment that runs after the review, or null. */
  testing: string | null
}

/**
 * The goal note's words: paid customers this span with their value, the
 * trend against the span before, and what the account tries next. The goal
 * itself (shared `workspaceGoal`) is said beside it, never in it.
 */
export function goalNoteText(standing: GoalStanding): string {
  const { windowDays, paid, previousPaid } = standing
  const money = (count: number) => `${grouped(count * standing.valuePerPaid)} ${standing.currency}`
  const customers = (count: number) => `${grouped(count)} paid ${count === 1 ? 'customer' : 'customers'}`
  const span = `in the last ${windowDays} days`
  const before = `in the ${windowDays} days before`
  const now =
    paid === 0
      ? previousPaid === 0
        ? `No paid customers yet ${span}, nor ${before}.`
        : `No paid customers ${span}, down from ${grouped(previousPaid)} (${money(previousPaid)}) ${before}.`
      : paid === previousPaid
        ? `${customers(paid)} ${span}, worth ${money(paid)}, the same as ${before}.`
        : previousPaid === 0
          ? `${customers(paid)} ${span}, worth ${money(paid)}, up from none ${before}.`
          : `${customers(paid)} ${span}, worth ${money(paid)}, ${paid > previousPaid ? 'up' : 'down'} from ${grouped(previousPaid)} (${money(previousPaid)}) ${before}.`
  const next = standing.testing !== null ? `Next: testing "${standing.testing}".` : 'Next: nothing new to test this week.'
  return `${now} ${next}`
}

/**
 * The goal note every review leaves, changes or not: where the account stands
 * against the workspace's goal (paid conversions by link, this
 * span against the one before, at the workspace's value per paid) and the
 * experiment it runs next. It supersedes the note of the review before.
 */
async function writeGoalNote(
  ctx: MutationCtx,
  account: Doc<'accounts'>,
  conversions: Doc<'conversions'>[],
  running: Doc<'experiments'> | null,
  now: number
): Promise<Id<'memories'>> {
  const workspace = await workspaceOf(ctx, account)
  const since = now - STANDING_WINDOW_DAYS * DAY_MS
  const paid = conversions.filter((conversion) => conversion.kind === 'paid' && conversion.at < now)
  const current = paid.filter((conversion) => conversion.at >= since)
  const previous = paid.filter((conversion) => conversion.at >= since - STANDING_WINDOW_DAYS * DAY_MS && conversion.at < since)
  const text = goalNoteText({
    windowDays: STANDING_WINDOW_DAYS,
    paid: current.length,
    previousPaid: previous.length,
    valuePerPaid: workspace.valuePerPaid,
    currency: workspace.currency,
    testing: running === null ? null : running.name,
  })
  const postIds = [...new Set(current.flatMap((conversion) => (conversion.postId === undefined ? [] : [conversion.postId])))]
  const noteId = await ctx.db.insert('memories', {
    accountId: account._id,
    kind: 'goal_note',
    text,
    actor: 'analyst',
    evidence: { ...(running === null ? {} : { experimentId: running._id }), postIds, signalIds: [] },
    status: 'active',
    createdAt: now,
  })
  await supersedeOthers(ctx, { _id: noteId, accountId: account._id, kind: 'goal_note' }, () => true)
  return noteId
}

/**
 * The weekly review, in order: pillar weights, contradicted defaults, the
 * next experiment. Each change writes its journal entry; the review then
 * stamps `strategy.reviewedAt` and, when anything changed, posts one chat
 * message naming the changes. A change that moves the plan (the pillar
 * weights) also leaves a learning, which supersedes
 * the account's older learning on the same subject; a started experiment is a
 * question, not a learning, and the goal note names it as what comes next.
 * Nothing changed: no message and no journal entry, only the stamp and the
 * goal note, which every review leaves.
 */
export async function reviewStrategy(ctx: MutationCtx, account: Doc<'accounts'>, now: number): Promise<ReviewOutcome> {
  const posts = await ctx.db
    .query('posts')
    .withIndex('by_account', (q) => q.eq('accountId', account._id))
    .collect()
  const conversions = await ctx.db
    .query('conversions')
    .withIndex('by_account_time', (q) => q.eq('accountId', account._id))
    .collect()
  const experiments = await ctx.db
    .query('experiments')
    .withIndex('by_account_status', (q) => q.eq('accountId', account._id))
    .collect()
  // No strategy yet: an empty weight list reads as equal shares (shared `pillarWeights`).
  let strategy: Strategy = account.strategy ?? { pillarWeights: [], defaults: [] }
  const changes: Change[] = []

  const pillars = await reviewPillars(ctx, account, strategy, posts, conversions, now)
  if (pillars) {
    strategy = pillars.strategy
    changes.push(pillars.change)
  }
  const communities = await reviewCommunities(ctx, account, conversions, now)
  if (communities) changes.push(communities)
  const contradictions = await findContradictions(ctx, account, strategy, experiments)
  const started = await startNextExperiment(ctx, account, strategy, experiments, contradictions, now)
  if (started) changes.push(started.change)

  const running = started ? await ctx.db.get(started.experimentId) : experiments.find((experiment) => experiment.status === 'running')
  const goalNoteId = await writeGoalNote(ctx, account, conversions, running ?? null, now)

  await ctx.db.patch(account._id, { strategy: { ...strategy, reviewedAt: now } })
  if (changes.length > 0) {
    await ctx.db.insert('messages', {
      accountId: account._id,
      author: 'account',
      text: `I reviewed my strategy: I ${joinAnd(changes.map((change) => change.phrase))}. The Strategy page has the reasons.`,
      createdAt: now,
    })
  }
  return { changes: changes.length, goalNoteId, ...(started ? { startedExperimentId: started.experimentId } : {}) }
}

/**
 * What the strategy page reads: the workspace's goal with the account's
 * newest goal note, its learnings, active and superseded, the newest journal
 * entries with the titles of the signals they name, and its newest strategy
 * review job, read by its own index: the hourly signal polls and the daily
 * pulls bury a weekly review among the account's newest jobs within days.
 */
export async function strategyView(
  ctx: Reader,
  account: Doc<'accounts'>
): Promise<{
  goal: { text: string; note: Doc<'memories'> | null }
  learnings: Doc<'memories'>[]
  journal: Doc<'journal'>[]
  signals: Pick<Doc<'signals'>, '_id' | 'title'>[]
  reviewJob: Doc<'jobs'> | null
}> {
  const memories = await ctx.db
    .query('memories')
    .withIndex('by_account_status', (q) => q.eq('accountId', account._id))
    .collect()
  const journal = await ctx.db
    .query('journal')
    .withIndex('by_account_time', (q) => q.eq('accountId', account._id))
    .order('desc')
    .take(JOURNAL_PAGE)
  const reviewJob = await ctx.db
    .query('jobs')
    .withIndex('by_account_kind', (q) => q.eq('accountId', account._id).eq('kind', 'review_strategy'))
    .order('desc')
    .first()
  // The signals the journal's evidence names (a swapped concept's old and new signal), so the page can say
  // them by title. A used signal never ages out (internal/schedule.ts), so one that is gone was deleted by
  // hand, and its entry names it no more.
  const signals: Pick<Doc<'signals'>, '_id' | 'title'>[] = []
  for (const signalId of new Set(journal.flatMap((entry) => entry.evidence.signalIds))) {
    const signal = await ctx.db.get(signalId)
    if (signal) signals.push({ _id: signal._id, title: signal.title })
  }
  const workspace = await workspaceOf(ctx, account)
  const [note] = await activeEntries(ctx, account._id, 'goal_note')
  return {
    goal: { text: workspaceGoal(workspace.sponsorName), note: note ?? null },
    learnings: memories.filter((memory) => memory.kind === 'learning'),
    journal,
    signals,
    reviewJob,
  }
}
