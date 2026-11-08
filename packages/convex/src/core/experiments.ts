import {
  EXPERIMENT_KIND_LABELS,
  EXPERIMENT_METRIC_LABELS,
  MEASUREMENT_WINDOW_MS,
  REPLIES_SHOW_REACH,
  POSTING_TIME_KEYS,
  REPLY_TARGET_KEYS,
  metricsFor,
  metricsText,
  accountCatalog,
  confidencePercent,
  grouped,
  rateNumber,
  rateText,
  effectiveVariant,
  isReplyExperimentKind,
  isPostingTimeKey,
  postedHourOf,
  postingTimeFits,
  postingTimeOffset,
  postSlotHours,
  wentOutAt,
  isReplyTargetKey,
  itemsNoun,
  reachOf,
  variantRate,
  type DimensionMetrics,
  type ExperimentKind,
  type ExperimentMetric,
  type JournalActor,
  type VariantStats,
  PLATFORM_IN_WORDS,
  STANDOUT_RATIO,
  MODELED_KEY,
  POST_MODEL_KEYS,
  catalogControl,
  isPostModelKey,
  placeOf,
} from '@influstep/shared'
import type { Infer } from 'convex/values'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { refusal } from '../lib/errors'
import type { journalNumberValidator, strategyDefaultValidator, variantValidator } from '../lib/validators'
import { cannotRead } from '../providers/platforms'
import { accountReader } from './connections'
import { hourText, instantAt } from './dates'
import { listens } from './formats'
import { postClicksUntil } from './posted'
import { repliesWithStatus } from './replies'
import { experimentLoader, slotHourOf, taggedVariant } from './variants'
import { whatWorked } from './niche'

/**
 * Experiments (CONTEXT.md, "Experiment"): the one place one starts, stops and
 * is decided, for the analyst's strategy review and the operator alike, and
 * how a variant's items are counted.
 */

type Reader = { db: QueryCtx['db'] }
type Variant = Infer<typeof variantValidator>
type StoredDefault = Infer<typeof strategyDefaultValidator>
type JournalNumber = Infer<typeof journalNumberValidator>

/** A variant's label. The key always comes from the experiment's own variants, so a missing one is a bug. */
function variantLabel(experiment: Pick<Doc<'experiments'>, 'variants'>, key: string): string {
  const variant = experiment.variants.find((candidate) => candidate.key === key)
  if (!variant) throw new Error(`no variant "${key}" in the experiment`)
  return variant.label
}

/** A measured reply or post, as an experiment counts it. */
type MeasuredItem = { kind: 'reply'; row: Doc<'replies'> } | { kind: 'post'; row: Doc<'posts'> }

/**
 * What one measured item adds to its variant on the metric: its reach as its
 * platform counts it, or what a post did for the sponsor within its
 * measurement window, its clicks and the signups or paid customers it
 * brought, so an older post is no ahead for having had longer. Null where it
 * says nothing: a reach its platform does not show (a Hacker News comment),
 * or numbers never read.
 */
async function valueOf(ctx: Reader, metric: ExperimentMetric, item: MeasuredItem, conversions: readonly Doc<'conversions'>[]) {
  if (metric === 'reach') return item.row.numbers === undefined ? null : reachOf(item.row.numbers.counts)
  // `startExperiment` refuses a reply experiment on anything but reach: a reply carries no tracked link.
  if (item.kind === 'reply') throw new Error(`reply ${item.row._id} was counted on ${metric}, which no reply brings`)
  const closes = wentOutAt(item.row) + MEASUREMENT_WINDOW_MS
  if (metric === 'clicks') return postClicksUntil(ctx, item.row._id, closes)
  const kind = metric === 'signups' ? 'signup' : 'paid'
  return conversions.filter((conversion) => conversion.postId === item.row._id && conversion.kind === kind && conversion.at <= closes)
    .length
}

/** The account's conversions since the first item went out, read only for a metric that counts them. */
async function conversionsFor(
  ctx: Reader,
  accountId: Id<'accounts'>,
  metric: ExperimentMetric,
  items: readonly { item: MeasuredItem }[]
): Promise<Doc<'conversions'>[]> {
  if (metric !== 'signups' && metric !== 'paid') return []
  const since = Math.min(...items.map(({ item }) => wentOutAt(item.row)))
  if (!Number.isFinite(since)) return []
  return ctx.db
    .query('conversions')
    .withIndex('by_account_time', (q) => q.eq('accountId', accountId).gte('at', since))
    .collect()
}

/** Each variant's items and their values on the metric; an item that says nothing on it is left out. */
async function statsOf(
  ctx: Reader,
  accountId: Id<'accounts'>,
  metric: ExperimentMetric,
  keys: readonly string[],
  items: readonly { key: string; item: MeasuredItem }[]
): Promise<VariantStats[]> {
  const conversions = await conversionsFor(ctx, accountId, metric, items)
  const stats = new Map<string, VariantStats>(keys.map((key) => [key, { key, items: 0, sum: 0, sumSquares: 0 }]))
  for (const { key, item } of items) {
    const entry = stats.get(key)
    if (!entry) continue
    const value = await valueOf(ctx, metric, item, conversions)
    if (value === null) continue
    entry.items += 1
    entry.sum += value
    entry.sumSquares += value * value
  }
  return [...stats.values()]
}

/**
 * Whether an item counts toward its experiment: past its measurement window
 * (CONTEXT.md, "Experiment"), so every item had the same week to bring its
 * clicks and conversions, and not removed by its community, which cut its
 * reach short whatever its variant.
 */
function counts(row: Doc<'posts'> | Doc<'replies'>): boolean {
  return row.status === 'measured' && row.removedAt === undefined
}

/**
 * The posts a posting time test leaves out though measured: the ones that
 * went out off their planned hour, and the ones whose hour is not known
 * because the operator marked them posted (shared `postedHourOf`).
 */
export type LeftOutPosts = { offHour: number; unknownHour: number }

/**
 * An experiment's items that count (`counts`), each by the variant it
 * carries. On the posting time a measured post counts only if it went out
 * near the hour it was planned for: the operator posts by hand, and one
 * posted at another hour, or at an hour not known, tested nothing, so it is
 * counted apart; null on any other dimension, where every measured item
 * counts.
 */
async function experimentItems(
  ctx: Reader,
  experiment: Doc<'experiments'>
): Promise<{ counted: { key: string; item: MeasuredItem }[]; leftOut: LeftOutPosts | null }> {
  if (isReplyExperimentKind(experiment.kind)) {
    const replies = await ctx.db
      .query('replies')
      .withIndex('by_experiment', (q) => q.eq('experimentId', experiment._id))
      .collect()
    const counted = replies.flatMap((row) =>
      counts(row) && row.variantKey !== undefined ? [{ key: row.variantKey, item: { kind: 'reply' as const, row } }] : []
    )
    return { counted, leftOut: null }
  }
  const posts = await ctx.db
    .query('posts')
    .withIndex('by_experiment', (q) => q.eq('experimentId', experiment._id))
    .collect()
  const measured = posts.flatMap((row) => (counts(row) && row.variantKey !== undefined ? [{ key: row.variantKey, row }] : []))
  const item = ({ key, row }: (typeof measured)[number]) => ({ key, item: { kind: 'post' as const, row } })
  if (experiment.kind !== 'posting_time') return { counted: measured.map(item), leftOut: null }
  const hours = measured.map((entry) => ({ entry, hour: postedHourOf(entry.row) }))
  const left = (hour: 'off' | 'unknown') => hours.filter((entry) => entry.hour === hour).length
  return {
    counted: hours.flatMap(({ entry, hour }) => (hour === 'on' ? [item(entry)] : [])),
    leftOut: { offHour: left('off'), unknownHour: left('unknown') },
  }
}

/** What the experiments page shows of one: each variant's stats from the items that count, and what a posting time test left out. */
export async function experimentStats(
  ctx: Reader,
  experiment: Doc<'experiments'>
): Promise<{ stats: VariantStats[]; leftOut: LeftOutPosts | null }> {
  const { counted, leftOut } = await experimentItems(ctx, experiment)
  const keys = experiment.variants.map((variant) => variant.key)
  return { stats: await statsOf(ctx, experiment.accountId, experiment.metric, keys, counted), leftOut }
}

/** Each variant's stats from the experiment's replies or posts that count (`experimentItems`). */
export async function variantStatsFor(ctx: Reader, experiment: Doc<'experiments'>): Promise<VariantStats[]> {
  return (await experimentStats(ctx, experiment)).stats
}

/**
 * How a default has done since it became one: the measured replies heard, or
 * the measured posts planned, after `since`, whose effective variant on
 * `kind` (shared `effectiveVariant`) is `key`, by `metric`. One in an
 * experiment of that dimension counts by its own variant; any other by the
 * default in force. On the reply target dimension only replies to found
 * posts count, since a mention or a reply under the account's post has no
 * target to pick; on the post kind a post's kind is its intent.
 */
export async function variantStatsSince(
  ctx: Reader,
  account: Doc<'accounts'>,
  kind: ExperimentKind,
  key: string,
  since: number,
  metric: ExperimentMetric
): Promise<VariantStats> {
  const experimentOf = experimentLoader(ctx)
  const effectiveKey = async (row: Doc<'replies'> | Doc<'posts'>) => {
    const experiment = row.experimentId === undefined ? null : await experimentOf(row.experimentId)
    return effectiveVariant(kind, { variant: taggedVariant(row, experiment) }, account.strategy?.defaults).key
  }
  // A post kind or a post model is what the post is, not the default it was planned under: a decided "modeled" still plans
  // posts on no standout once none is left, and a post kind changes with the placement.
  const postKeyOf = async (row: Doc<'posts'>) => {
    if (kind === 'post_kind') return row.intent
    if (kind === 'post_model') return row.basis?.kind === 'model' ? MODELED_KEY : catalogControl('post_model').key
    return effectiveKey(row)
  }
  const items: { key: string; item: MeasuredItem }[] = []
  if (isReplyExperimentKind(kind)) {
    for (const row of await repliesWithStatus(ctx, account._id, 'measured')) {
      if (row.heardAt <= since || !counts(row)) continue
      if (kind === 'reply_target' && row.origin !== 'search') continue
      if ((await effectiveKey(row)) === key) items.push({ key, item: { kind: 'reply', row } })
    }
  } else {
    const posts = await ctx.db
      .query('posts')
      .withIndex('by_account_status', (q) => q.eq('accountId', account._id).eq('status', 'measured'))
      .collect()
    for (const row of posts) {
      if (row.createdAt <= since || !counts(row)) continue
      const rowKey = await postKeyOf(row)
      if (rowKey === key) items.push({ key, item: { kind: 'post', row } })
    }
  }
  const [only] = await statsOf(ctx, account._id, metric, [key], items)
  if (!only) throw new Error(`no stats for ${kind} "${key}"`)
  return only
}

/** A proportion as a percentage with two decimals: "0.26%". */
export function percentText(rate: number): string {
  return `${(rate * 100).toFixed(2)}%`
}

/** A proportion as a journal number: a percentage rounded to 0.01. */
export function percentNumber(rate: number): number {
  return Math.round(rate * 10000) / 100
}

/** A sentence the operator typed, ended with a period when it has no end of its own. */
function sentence(text: string): string {
  const trimmed = text.trim()
  if (/[.!?]$/.test(trimmed)) return trimmed
  return `${trimmed}.`
}

function upperFirst(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1)
}

async function journal(
  ctx: MutationCtx,
  entry: {
    accountId: Id<'accounts'>
    kind: Doc<'journal'>['kind']
    actor: JournalActor
    text: string
    reason: string
    experimentId?: Id<'experiments'>
    numbers: JournalNumber[]
    at: number
  }
): Promise<Id<'journal'>> {
  return ctx.db.insert('journal', {
    accountId: entry.accountId,
    kind: entry.kind,
    actor: entry.actor,
    text: entry.text,
    reason: entry.reason,
    evidence: {
      ...(entry.experimentId === undefined ? {} : { experimentId: entry.experimentId }),
      // An experiment varies replies, so it names no post; only a last check's swap names signals (core/research.ts).
      postIds: [],
      signalIds: [],
      numbers: entry.numbers,
    },
    createdAt: entry.at,
  })
}

export interface StartExperimentInput {
  name: string
  hypothesis: string
  kind: ExperimentKind
  metric: ExperimentMetric
  variants: Variant[]
  minItems: number
  minConfidence: number
  createdBy: JournalActor
  /** The default this experiment tests again, when later data contradicted it. */
  retestOf?: Id<'experiments'>
  /** Why it starts, for the journal: the review's reasoning, or the operator's hypothesis. */
  reason: string
}

/**
 * The one place an experiment starts. One runs at a time per account, so
 * every reply carries one variant. `now` is the moment it starts; only the
 * seed passes one from the past.
 */
export async function startExperiment(
  ctx: MutationCtx,
  account: Doc<'accounts'>,
  input: StartExperimentInput,
  now = Date.now()
): Promise<Id<'experiments'>> {
  if (input.variants.length < 2) throw refusal('An experiment needs at least two variants.')
  const keys = new Set(input.variants.map((variant) => variant.key))
  if (keys.size !== input.variants.length) throw refusal('Variant keys must be unique.')
  // The listener acts on these keys (core/replies.ts); one it does not know would hear nothing different.
  if (input.kind === 'reply_target') {
    for (const variant of input.variants) {
      if (isReplyTargetKey(variant.key)) continue
      throw refusal(`"${variant.label}" is no reply target the listener knows; the keys are ${REPLY_TARGET_KEYS.join(', ')}.`)
    }
  }
  if (input.kind === 'posting_time') {
    for (const variant of input.variants) {
      if (isPostingTimeKey(variant.key)) continue
      throw refusal(`"${variant.label}" is no posting time the planner knows; the keys are ${POSTING_TIME_KEYS.join(', ')}.`)
    }
  }
  if (input.kind === 'post_model') {
    for (const variant of input.variants) {
      if (isPostModelKey(variant.key)) continue
      throw refusal(`"${variant.label}" is no post model the planner knows; the keys are ${POST_MODEL_KEYS.join(', ')}.`)
    }
  }
  await assertMeasurable(ctx, account, input)
  const running = await ctx.db
    .query('experiments')
    .withIndex('by_account_status', (q) => q.eq('accountId', account._id).eq('status', 'running'))
    .first()
  if (running) throw refusal(`"${running.name}" is still running; stop it first so replies and posts carry one variant.`)
  const experimentId = await ctx.db.insert('experiments', {
    accountId: account._id,
    name: input.name,
    hypothesis: input.hypothesis,
    kind: input.kind,
    metric: input.metric,
    variants: input.variants,
    status: 'running',
    minItems: input.minItems,
    minConfidence: input.minConfidence,
    createdBy: input.createdBy,
    ...(input.retestOf === undefined ? {} : { retestOf: input.retestOf }),
    createdAt: now,
  })
  await journal(ctx, {
    accountId: account._id,
    kind: 'experiment_started',
    actor: input.createdBy,
    text: `Started "${input.name}".`,
    reason: input.reason,
    experimentId,
    numbers: [
      { label: `${upperFirst(itemsNoun(input.kind))} needed per variant`, value: input.minItems },
      { label: 'Confidence needed (%)', value: Math.round(input.minConfidence * 100) },
    ],
    at: now,
  })
  return experimentId
}

/**
 * The metrics a dimension can be decided on for the account, and why not
 * every one when it cannot (shared `DimensionMetrics`): its platform's rule
 * (shared `metricsFor`); a reply dimension needs an account that answers
 * someone (core/formats.ts `listens`) on a platform whose replies show
 * reach; and reach needs a reader that reads numbers. The form offers these,
 * the strategy review picks from them, and a start on another is refused.
 */
export async function measurableMetrics(ctx: Reader, account: Doc<'accounts'>, kind: ExperimentKind): Promise<DimensionMetrics> {
  // A post model test with nothing to model its posts on would give the modeled variant no post at all.
  if (kind === 'post_model' && (await whatWorked(ctx, account)).standouts.length === 0) return noStandout(account)
  return readableMetrics(ctx, account, kind)
}

/** A post model test whose modeled variant got no post for this long, with nothing standing out now, stops (`postModelStall`). */
const MODEL_STALL_DAYS = 14

/**
 * Why a running post model test can never be decided, or null: its modeled
 * variant got no post for MODEL_STALL_DAYS, since it started or since its
 * last one, and nothing stands out now, so the turns all go to the control
 * and the test would hold the account's one slot for good.
 */
export async function postModelStall(ctx: Reader, experiment: Doc<'experiments'>, now: number): Promise<string | null> {
  if (experiment.kind !== 'post_model') return null
  const posts = await ctx.db
    .query('posts')
    .withIndex('by_experiment', (q) => q.eq('experimentId', experiment._id))
    .collect()
  const lastModeled = Math.max(
    experiment.createdAt,
    ...posts.filter((post) => post.variantKey === MODELED_KEY).map((post) => post.createdAt)
  )
  if (now - lastModeled < MODEL_STALL_DAYS * 24 * 3_600_000) return null
  const account = await ctx.db.get(experiment.accountId)
  if (!account) throw new Error(`account ${experiment.accountId} of experiment ${experiment._id} not found`)
  if ((await whatWorked(ctx, account)).standouts.length > 0) return null
  return `Nothing in ${account.name}'s niche stood out for ${MODEL_STALL_DAYS} days, so no post could be modeled and the test could never be decided.`
}

/** Why a post model test cannot start yet: nothing in the niche stood out. */
function noStandout(account: Doc<'accounts'>): DimensionMetrics {
  return {
    metrics: [],
    why: `No thread found in ${account.name}'s niche lately drew at least ${STANDOUT_RATIO} times what the others did, so there is nothing to model posts on yet.`,
  }
}

/**
 * What a dimension can be decided on for the account, whatever its niche
 * holds: what its replies show, what its reader reads, and what its
 * platform counts (`measurableMetrics` adds the niche's standouts).
 */
export async function readableMetrics(ctx: Reader, account: Doc<'accounts'>, kind: ExperimentKind): Promise<DimensionMetrics> {
  const dimension = EXPERIMENT_KIND_LABELS[kind].toLowerCase()
  if (isReplyExperimentKind(kind)) {
    if (!listens(account))
      return {
        metrics: [],
        why: `${account.name} answers nobody, so a ${dimension} test would compare nothing. Give it a reply budget above 0 first.`,
      }
    if (!REPLIES_SHOW_REACH[account.platform])
      return {
        metrics: [],
        why: `A reply on ${PLATFORM_IN_WORDS[account.platform]} shows no reach, so a ${dimension} test would never be decided.`,
      }
  }
  const reader = await accountReader(ctx, account)
  if (kind === 'posting_time') {
    // Only a post the match found went out at a time its platform says (shared `postedOnItsHour`).
    if (reader.activity === undefined)
      return { metrics: [], why: `${cannotRead(placeOf(account), 'activity')} A ${dimension} test could not tell when a post went out.` }
    if (!postingTimeFits(account)) {
      const hours = postSlotHours(account)
      const [first = account.publishHour] = hours
      const last = hours.at(-1) ?? first
      return {
        metrics: [],
        why: `${account.name}'s posts run from ${hourText(first)} to ${hourText(last)}, so two hours either way would leave the day. Move its posting hour first.`,
      }
    }
  }
  const onPlatform = metricsFor(kind, account.platform)
  if (reader.counts !== undefined) return onPlatform
  const unread = `${cannotRead(placeOf(account), 'counts')} A ${dimension} test on reach would never be decided.`
  return {
    metrics: onPlatform.metrics.filter((metric) => metric !== 'reach'),
    why: onPlatform.why === null ? unread : `${onPlatform.why} ${unread}`,
  }
}

/**
 * An experiment that can be decided on the account: its metric is one the
 * dimension can be decided on there (`measurableMetrics`), and a post kind's
 * variants are intents the account's cadence plans, since the planner plans
 * no other.
 */
async function assertMeasurable(
  ctx: Reader,
  account: Doc<'accounts'>,
  input: Pick<StartExperimentInput, 'kind' | 'metric' | 'variants'>
): Promise<void> {
  const measurable = await measurableMetrics(ctx, account, input.kind)
  if (!measurable.metrics.includes(input.metric)) {
    const dimension = EXPERIMENT_KIND_LABELS[input.kind].toLowerCase()
    const instead = measurable.metrics.length === 0 ? '' : ` Test the ${dimension} on ${metricsText(measurable.metrics)}.`
    throw refusal(`${measurable.why}${instead}`)
  }
  if (input.kind !== 'post_kind') return
  const planned = accountCatalog(account.cadence.intents).post_kind
  for (const variant of input.variants) {
    if (planned.some((kind) => kind.key === variant.key)) continue
    throw refusal(
      `"${variant.label}" is no post kind ${account.name} plans; its cadence plans ${planned.map((kind) => kind.label).join(', ')}.`
    )
  }
}

/**
 * A running posting time test moves posts from the account's hours, and a
 * decision moves them by the winner, so the hours, how many posts a day
 * spreads over them and the timezone stay as they are until it ends.
 */
export async function assertHoursKept(
  ctx: Reader,
  account: Doc<'accounts'>,
  next: Pick<Doc<'accounts'>, 'publishHour' | 'cadence' | 'timezone'>
): Promise<void> {
  const same =
    next.publishHour === account.publishHour &&
    next.cadence.postsPerDay === account.cadence.postsPerDay &&
    next.timezone === account.timezone
  if (same) return
  const running = await ctx.db
    .query('experiments')
    .withIndex('by_account_status', (q) => q.eq('accountId', account._id).eq('status', 'running'))
    .first()
  if (running?.kind === 'posting_time')
    throw refusal(`"${running.name}" tests ${account.name}'s posting time from its hours; stop it before you change them.`)
}

/**
 * The analyst's note on a decision it reached on the numbers, the lead of the
 * chat message `applyExperimentDecision` posts: the winner, how far it leads
 * on the experiment's rate, and the confidence, written as the learning
 * writes it (`confidencePercent`, so it never reads 100%).
 */
export function analystDecisionNote(
  experiment: Pick<Doc<'experiments'>, 'metric' | 'variants'>,
  decision: Pick<DecisionInput, 'winnerKey' | 'lift' | 'confidence'>
): string {
  const winner = variantLabel(experiment, decision.winnerKey)
  return `"${winner}" leads on ${EXPERIMENT_METRIC_LABELS[experiment.metric]} by ${Math.round(decision.lift * 100)}% at ${confidencePercent(decision.confidence)}% confidence.`
}

/**
 * A decision as it reaches `applyExperimentDecision`. The analyst's carries
 * the two rates it was decided on and the variant that came second; the
 * operator's verdict carries none of them.
 */
export interface DecisionInput {
  winnerKey: string
  lift: number
  confidence: number
  winnerRate?: number
  runnerUpRate?: number
  runnerUpKey?: string
}

/** The numbers an analyst's decision was reached on: the winner's rate, the runner-up's, and which variant came second. */
interface DecisionRates {
  winnerRate: number
  runnerUpRate: number
  runnerUpKey: string
}

/**
 * The rates of a decision, all three or none: a decision with only some of
 * them is a bug in its caller, never a decision without rates.
 */
function decisionRates(experiment: Doc<'experiments'>, decision: DecisionInput): DecisionRates | undefined {
  const { winnerRate, runnerUpRate, runnerUpKey } = decision
  if (winnerRate === undefined && runnerUpRate === undefined && runnerUpKey === undefined) return undefined
  if (winnerRate === undefined || runnerUpRate === undefined || runnerUpKey === undefined)
    throw new Error(`a decision on experiment ${experiment._id} needs the winner's rate, the runner-up's rate and its key together`)
  if (runnerUpKey === decision.winnerKey) throw new Error(`experiment ${experiment._id} names its winner "${runnerUpKey}" as the runner-up`)
  if (!experiment.variants.some((variant) => variant.key === runnerUpKey))
    throw new Error(`experiment ${experiment._id} has no runner-up "${runnerUpKey}"`)
  return { winnerRate, runnerUpRate, runnerUpKey }
}

/** The learning a decision writes, from its numbers, or the operator's note for the operator's own verdict. */
function decisionLearningText(args: {
  experiment: Pick<Doc<'experiments'>, 'kind' | 'metric' | 'variants'>
  winnerKey: string
  actor: JournalActor
  note: string
  stats: readonly VariantStats[]
  rates?: DecisionRates
  confidence: number
}): string {
  const { experiment } = args
  const label = (key: string) => variantLabel(experiment, key)
  const winner = `"${label(args.winnerKey)}"`
  const dimension = EXPERIMENT_KIND_LABELS[experiment.kind]
  const others = experiment.variants.filter((variant) => variant.key !== args.winnerKey).map((variant) => `"${variant.label}"`)
  if (args.actor === 'operator') {
    const reason = args.note.trim() === '' ? '.' : `: ${sentence(args.note)}`
    return `${dimension}: ${winner} over ${others.join(' and ')}, chosen by the operator${reason}`
  }
  if (!args.rates) throw new Error('an analyst decision needs the winner and runner-up rates it was decided on')
  const items = args.stats.reduce((sum, stat) => sum + stat.items, 0)
  return (
    `${dimension}: ${winner} beat "${label(args.rates.runnerUpKey)}" on ${EXPERIMENT_METRIC_LABELS[experiment.metric]}, ` +
    `${rateText(experiment.metric, args.rates.winnerRate)} against ${rateText(experiment.metric, args.rates.runnerUpRate)} ` +
    `over ${grouped(items)} ${itemsNoun(experiment.kind)}, ${confidencePercent(args.confidence)}% confidence.`
  )
}

/**
 * The one place a decision lands, for the daily evaluation and the
 * operator's override alike. The winner becomes the account's default on the
 * experiment's dimension, a learning the writer reads (the older learning on
 * that dimension is superseded), a journal entry with the numbers, and one
 * chat message that says what changes. Only a running experiment is decided,
 * so a decision lands once: the operator's form can still be open when the
 * daily evaluation decides, and a second click sends a second override.
 * `now` is the moment of the decision; only the seed passes one from the past.
 */
export async function applyExperimentDecision(
  ctx: MutationCtx,
  experiment: Doc<'experiments'>,
  decision: DecisionInput,
  actor: JournalActor,
  note: string,
  now = Date.now()
): Promise<void> {
  if (experiment.status === 'stopped') throw refusal(`"${experiment.name}" was stopped, so it cannot be decided.`)
  if (experiment.status === 'decided') throw refusal(`"${experiment.name}" is already decided.`)
  const winner = experiment.variants.find((variant) => variant.key === decision.winnerKey)
  if (!winner) throw refusal(`There is no variant "${decision.winnerKey}".`)
  const account = await ctx.db.get(experiment.accountId)
  if (!account) throw new Error(`account ${experiment.accountId} not found`)
  const rates = decisionRates(experiment, decision)

  await releasePlannedPosts(ctx, experiment, decision.winnerKey)
  await ctx.db.patch(experiment._id, {
    status: 'decided',
    decision: {
      winnerKey: decision.winnerKey,
      lift: decision.lift,
      confidence: decision.confidence,
      note,
      decidedAt: now,
      byOperator: actor === 'operator',
      ...rates,
    },
  })

  const adopted = await adoptWinner(ctx, account, experiment, winner, now)

  const stats = await variantStatsFor(ctx, experiment)
  const confidence = actor === 'operator' ? 1 : decision.confidence
  const text = decisionLearningText({ experiment, winnerKey: winner.key, actor, note, stats, rates, confidence })
  const learningId = await ctx.db.insert('memories', {
    accountId: account._id,
    kind: 'learning',
    text,
    actor,
    dimension: experiment.kind,
    evidence: { experimentId: experiment._id, postIds: [], signalIds: [] },
    confidence,
    status: 'active',
    createdAt: now,
  })
  const earlier = await ctx.db
    .query('memories')
    .withIndex('by_account_status', (q) => q.eq('accountId', account._id).eq('status', 'active'))
    .collect()
  for (const memory of earlier) {
    // Only an older learning on the same dimension gives way; a brief or a problem is no learning.
    if (memory.kind !== 'learning') continue
    if (memory._id === learningId || memory.dimension !== experiment.kind) continue
    await ctx.db.patch(memory._id, { status: 'superseded', supersededBy: learningId })
  }

  const numbers: JournalNumber[] = stats.flatMap((stat) => {
    const label = variantLabel(experiment, stat.key)
    return [
      { label: `"${label}" ${EXPERIMENT_METRIC_LABELS[experiment.metric]}`, value: rateNumber(experiment.metric, variantRate(stat)) },
      { label: `"${label}" ${itemsNoun(experiment.kind)}`, value: stat.items },
    ]
  })
  if (actor === 'analyst') numbers.push({ label: 'Confidence (%)', value: Math.floor(decision.confidence * 1000) / 10 })
  await journal(ctx, {
    accountId: account._id,
    kind: 'experiment_decided',
    actor,
    text: adopted.changed,
    reason: `"${experiment.name}" is decided. ${text}`,
    experimentId: experiment._id,
    numbers,
    at: now,
  })

  const lead = actor === 'operator' ? `you picked "${winner.label}".${note.trim() === '' ? '' : ` ${sentence(note)}`}` : sentence(note)
  await ctx.db.insert('messages', {
    accountId: account._id,
    author: 'account',
    text: `Experiment "${experiment.name}" is decided: ${lead} From now on I ${adopted.from}`,
    createdAt: now,
  })
}

/**
 * What a decided winner changes, and how the journal and the chat say it.
 * On the posting time it is the account's hour itself (CONTEXT.md, "Posting
 * time"): no default is kept, so posts go out at the one hour the account
 * shows, and the next test moves from there. On any other dimension the
 * winner becomes the account's default.
 */
async function adoptWinner(
  ctx: MutationCtx,
  account: Doc<'accounts'>,
  experiment: Doc<'experiments'>,
  winner: Doc<'experiments'>['variants'][number],
  now: number
): Promise<{ changed: string; from: string }> {
  if (experiment.kind === 'posting_time') {
    // A test starts only where every variant fits the day (shared `postingTimeFits`), and the hour stays put while it runs.
    const publishHour = account.publishHour + postingTimeOffset(winner.key)
    if (publishHour < 0 || publishHour > 23) throw new Error(`posting time "${winner.key}" moves ${account.name} out of the day`)
    await ctx.db.patch(account._id, { publishHour })
    return {
      changed: `${account.name}'s posts start at ${hourText(publishHour)} now.`,
      from: `start my posts at ${hourText(publishHour)}.`,
    }
  }
  const inForce: StoredDefault = {
    kind: experiment.kind,
    key: winner.key,
    label: winner.label,
    description: winner.description,
    experimentId: experiment._id,
    since: now,
  }
  // No strategy yet: an empty weight list reads as equal shares (shared `pillarWeights`).
  const strategy = account.strategy ?? { pillarWeights: [], defaults: [] }
  await ctx.db.patch(account._id, {
    strategy: { ...strategy, defaults: [...strategy.defaults.filter((entry) => entry.kind !== experiment.kind), inForce] },
  })
  return {
    changed: `"${winner.label}" is the default for ${EXPERIMENT_KIND_LABELS[experiment.kind].toLowerCase()} now.`,
    from: winner.description.trim() === '' ? `follow "${winner.label}".` : sentence(lowerFirst(winner.description.trim())),
  }
}

/**
 * The posts still ideas under an experiment that ends leave it: written after
 * a decision they follow the new default, after a stop what the account did
 * before. A post kind keeps the intent it was planned with, and a modeled
 * post the standout it was planned on: each was planned as what it is. A posting time
 * moved them, so they go back to their slot's hour, moved by the winner's
 * offset after a decision, as the account's new hour moves every slot.
 */
async function releasePlannedPosts(ctx: MutationCtx, experiment: Doc<'experiments'>, winnerKey: string | null): Promise<void> {
  const account = await ctx.db.get(experiment.accountId)
  if (!account) throw new Error(`account ${experiment.accountId} not found`)
  const posts = await ctx.db
    .query('posts')
    .withIndex('by_experiment', (q) => q.eq('experimentId', experiment._id))
    .collect()
  for (const post of posts) {
    if (post.status !== 'idea') continue
    const retimed =
      experiment.kind === 'posting_time' && post.variantKey !== undefined
        ? retimedAt(post, post.variantKey, winnerKey, account.timezone)
        : {}
    await ctx.db.patch(post._id, { experimentId: undefined, variantKey: undefined, ...retimed })
  }
}

/** A posting time's planned post at its slot's hour (core/variants.ts `slotHourOf`), moved by the winner's offset when there is one. */
function retimedAt(post: Doc<'posts'>, variantKey: string, winnerKey: string | null, timezone: string): { scheduledAt: number } {
  const hour = slotHourOf(post, variantKey, timezone) + (winnerKey === null ? 0 : postingTimeOffset(winnerKey))
  return { scheduledAt: instantAt(post.plannedFor, hour, timezone) }
}

/** Who stops an experiment: the operator, or the analyst with why. */
export type ExperimentStop = { actor: 'operator' } | { actor: 'analyst'; why: string }

/**
 * The one place an experiment stops: only a running one. What went out keeps
 * the variant it carries; the posts still planned under it leave it
 * (`releasePlannedPosts`).
 */
export async function stopExperiment(
  ctx: MutationCtx,
  experimentId: Id<'experiments'>,
  stop: ExperimentStop,
  now = Date.now()
): Promise<void> {
  const experiment = await ctx.db.get(experimentId)
  if (!experiment) throw new Error(`experiment ${experimentId} not found`)
  if (experiment.status !== 'running') throw refusal(`"${experiment.name}" is not running.`)
  await ctx.db.patch(experiment._id, { status: 'stopped' })
  await releasePlannedPosts(ctx, experiment, null)
  const stats = await variantStatsFor(ctx, experiment)
  const nothing = 'nothing changes: the account keeps doing what it did, and what went out keeps its variant.'
  await journal(ctx, {
    accountId: experiment.accountId,
    kind: 'experiment_stopped',
    actor: stop.actor,
    text: `Stopped "${experiment.name}" before it was decided.`,
    reason: stop.actor === 'operator' ? `You stopped it, so ${nothing}` : `${stop.why} So ${nothing}`,
    experimentId: experiment._id,
    numbers: stats.map((stat) => ({
      label: `"${variantLabel(experiment, stat.key)}" ${itemsNoun(experiment.kind)}`,
      value: stat.items,
    })),
    at: now,
  })
}
