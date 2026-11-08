import { METRIC_KEYS, METRIC_LABELS } from './metrics'
import { PLATFORM_IN_WORDS, type Platform } from './platforms'
import type { PostIntent } from './post-mix'
import type { StrategyDefault } from './strategy'
import type { PlatformFormat } from './formats'
import type { Posted } from './posted'
import { postSlotHours } from './posts'
import { countsClicks } from './utm'

/**
 * The dimensions an experiment can vary (docs/plan.md, "Experiments, strategy
 * and next steps"), each with its catalog of variants below: how a reply is
 * written and what it answers, and how a post is planned, written and timed.
 */
export const REPLY_EXPERIMENT_KINDS = ['reply_style', 'reply_target', 'reply_length', 'sponsor_mention'] as const
export const POST_EXPERIMENT_KINDS = ['post_kind', 'hook', 'call_to_action', 'posting_time', 'post_model'] as const
export const EXPERIMENT_KINDS = [...REPLY_EXPERIMENT_KINDS, ...POST_EXPERIMENT_KINDS] as const
export type ExperimentKind = (typeof EXPERIMENT_KINDS)[number]
export type ReplyExperimentKind = (typeof REPLY_EXPERIMENT_KINDS)[number]
export type PostExperimentKind = (typeof POST_EXPERIMENT_KINDS)[number]

export function isReplyExperimentKind(kind: ExperimentKind): kind is ReplyExperimentKind {
  return REPLY_EXPERIMENT_KINDS.some((entry) => entry === kind)
}

export function isPostExperimentKind(kind: ExperimentKind): kind is PostExperimentKind {
  return POST_EXPERIMENT_KINDS.some((entry) => entry === kind)
}

/** What an experiment's items are: replies, or posts. */
export function itemsNoun(kind: ExperimentKind): 'replies' | 'posts' {
  return isReplyExperimentKind(kind) ? 'replies' : 'posts'
}

export const EXPERIMENT_KIND_LABELS: Record<ExperimentKind, string> = {
  reply_style: 'Reply style',
  reply_target: 'Reply target',
  reply_length: 'Reply length',
  sponsor_mention: 'Sponsor mention',
  post_kind: 'Post kind',
  hook: 'Hook',
  call_to_action: 'Call to action',
  posting_time: 'Posting time',
  post_model: 'Post model',
}

/**
 * The metrics an experiment can be decided on: the goal metric ladder
 * (CONTEXT.md, "Goal metric"), each counted per item. A reply carries no
 * tracked link, so a reply experiment is decided on reach.
 */
export const EXPERIMENT_METRICS = METRIC_KEYS
export type ExperimentMetric = (typeof EXPERIMENT_METRICS)[number]

export const EXPERIMENT_STATUSES = ['running', 'decided', 'stopped'] as const
export type ExperimentStatus = (typeof EXPERIMENT_STATUSES)[number]

/**
 * One arm of an experiment, as the catalog lists it and as an experiment row
 * stores it. `description` is the instruction the writer follows.
 */
export interface CatalogVariant {
  key: string
  label: string
  description: string
  isControl: boolean
}

/**
 * What the account can test on each dimension. The first variant of each is
 * the control, what the account did before it tested anything. Descriptions
 * read after "From now on I", so the chat can say what a decided winner
 * changes in the account's own words.
 */
export const EXPERIMENT_CATALOG: Record<ExperimentKind, readonly CatalogVariant[]> = {
  reply_style: [
    { key: 'tip', label: 'Tip', description: 'Answer with one concrete tip from my own work.', isControl: true },
    {
      key: 'question',
      label: 'Question back',
      description: 'Answer with a short question back that keeps the conversation going.',
      isControl: false,
    },
    { key: 'story', label: 'Story', description: 'Answer with what happened when I hit the same thing.', isControl: false },
  ],
  // The listener reads the key (core/replies.ts `targeted`): every found thread, the most reach first, or only where a reply stands out.
  reply_target: [
    {
      key: 'reach',
      label: 'Most reach',
      description:
        'Answer the threads that reach the most first: on X the authors with the most followers, on Reddit and Hacker News the threads with the highest score.',
      isControl: true,
    },
    {
      key: 'standout',
      label: 'Where a reply stands out',
      description:
        'Answer only where a reply stands out: on X authors under 10,000 followers, on Reddit and Hacker News threads under two hours old with few comments.',
      isControl: false,
    },
  ],
  reply_length: [
    { key: 'short', label: 'Short', description: 'Answer in one or two sentences.', isControl: true },
    { key: 'long', label: 'Long', description: 'Answer in a paragraph or more, with the detail that helps.', isControl: false },
  ],
  // The ground rules read the key (core/disclosure.ts `mayNameSponsor`): never takes the sponsor out of every reply.
  sponsor_mention: [
    {
      key: 'mention',
      label: 'Mention',
      description: 'Name my product where it helps, with my affiliation line, where the community allows it.',
      isControl: true,
    },
    { key: 'never', label: 'Never', description: 'Never name my product in a reply.', isControl: false },
  ],
  // The planner reads the key as the slot's intent (core/planner.ts), before it places the post.
  post_kind: [
    { key: 'teach', label: 'How-to', description: 'Post a how-to from my own work.', isControl: true },
    { key: 'ask', label: 'Question', description: 'Post a question about a problem readers have, asked openly.', isControl: false },
    { key: 'share', label: 'Story', description: 'Post a story of something that happened in my work.', isControl: false },
    { key: 'show', label: 'Show', description: 'Post something I built, shown plainly.', isControl: false },
  ],
  hook: [
    { key: 'statement', label: 'Plain statement', description: 'Open with a plain statement of what the post gives.', isControl: true },
    { key: 'question', label: 'Question', description: 'Open with a question the reader has asked themselves.', isControl: false },
    { key: 'number', label: 'Number', description: 'Open with a number from my own work.', isControl: false },
  ],
  call_to_action: [
    { key: 'none', label: 'No question', description: 'End without asking the reader anything.', isControl: true },
    {
      key: 'question',
      label: 'Ends with a question',
      description: 'End with a question the reader can answer in a comment.',
      isControl: false,
    },
  ],
  // The planner reads the key (core/planner.ts): how far it moves each post from the account's hours (POSTING_TIME_OFFSETS).
  posting_time: [
    { key: 'usual', label: 'Usual hours', description: 'Post at my usual hours.', isControl: true },
    { key: 'earlier', label: 'Two hours earlier', description: 'Post two hours before my usual hours.', isControl: false },
    { key: 'later', label: 'Two hours later', description: 'Post two hours after my usual hours.', isControl: false },
  ],
  // The planner reads the key (core/planner.ts): whether a post takes a standout to be modeled on (shared what-worked.ts).
  post_model: [
    { key: 'planned', label: 'As planned', description: 'Post from my pillars and the news, as planned.', isControl: true },
    {
      key: 'modeled',
      label: 'Modeled on what worked',
      description: 'Post on what people answered most in my niche lately, in my own words.',
      isControl: false,
    },
  ],
}

/** The post models the planner knows: as planned, or modeled on a standout; a post model test takes only these keys. */
export const POST_MODEL_KEYS = ['planned', 'modeled'] as const
export type PostModelKey = (typeof POST_MODEL_KEYS)[number]

/** The post model whose posts each take a standout to be modeled on (core/planner.ts). */
export const MODELED_KEY = 'modeled' satisfies PostModelKey

export function isPostModelKey(key: string): key is PostModelKey {
  return POST_MODEL_KEYS.some((entry) => entry === key)
}

/** The reply targets the listener knows; a reply target experiment takes only these keys. */
export const REPLY_TARGET_KEYS = ['reach', 'standout'] as const
export type ReplyTargetKey = (typeof REPLY_TARGET_KEYS)[number]

export function isReplyTargetKey(key: string): key is ReplyTargetKey {
  return REPLY_TARGET_KEYS.some((entry) => entry === key)
}

/**
 * The posting times the planner knows, each the hours it moves a post from
 * the account's own; a posting time experiment takes only these keys. A
 * day's slots are three hours apart (shared `postSlotHours`), so two hours
 * either way never puts two of its posts at one hour.
 */
export const POSTING_TIME_OFFSETS = { usual: 0, earlier: -2, later: 2 } as const
export const POSTING_TIME_KEYS = ['usual', 'earlier', 'later'] as const satisfies readonly (keyof typeof POSTING_TIME_OFFSETS)[]
export type PostingTimeKey = (typeof POSTING_TIME_KEYS)[number]

export function isPostingTimeKey(key: string): key is PostingTimeKey {
  return POSTING_TIME_KEYS.some((entry) => entry === key)
}

/** How many hours a posting time moves a post; a posting time experiment takes only the known keys, so another is a bug. */
export function postingTimeOffset(key: string): number {
  if (!isPostingTimeKey(key)) throw new Error(`"${key}" is no posting time`)
  return POSTING_TIME_OFFSETS[key]
}

/**
 * Whether a posting time test fits the account's day: every variant moves
 * each of its post hours (`postSlotHours`) by its offset and keeps them all
 * within the day, so a decided winner moves the account's hour by its offset
 * and no post slides back.
 */
export function postingTimeFits(format: Pick<PlatformFormat, 'publishHour' | 'cadence'>): boolean {
  const hours = postSlotHours(format)
  return POSTING_TIME_KEYS.every((key) => {
    const offset = POSTING_TIME_OFFSETS[key]
    const moved = postSlotHours({ ...format, publishHour: format.publishHour + offset })
    return format.publishHour + offset >= 0 && moved.every((hour, index) => hour === (hours[index] ?? Number.NaN) + offset)
  })
}

/**
 * How far from its planned hour a post may go out and still count for its
 * posting time: under half the hours between two variants, so a post counts
 * for one at most. The operator posts by hand, so one posted at another
 * hour tested nothing and is left out of the test.
 */
export const POSTING_TIME_TOLERANCE_MS = 45 * 60_000

/**
 * Whether a post went out near the hour it was planned for, at the time its
 * platform says: only a post the match found has one (shared `Posted`). One
 * the operator marked posted went out whenever they said so, so its hour is
 * not known.
 */
export function postedHourOf(post: { scheduledAt: number; posted?: Posted }): 'on' | 'off' | 'unknown' {
  if (post.posted?.kind !== 'found') return 'unknown'
  return Math.abs(post.posted.at - post.scheduledAt) <= POSTING_TIME_TOLERANCE_MS ? 'on' : 'off'
}

/**
 * The variant with the fewest assigned so far, the first listed on a tie: how
 * the planner and the listener keep an experiment's variants balanced. An
 * experiment has at least two variants, so none is a bug.
 */
export function leastAssigned<K extends string>(keys: readonly K[], assigned: Readonly<Record<string, number>>): K {
  let best: K | undefined
  let bestCount = Number.POSITIVE_INFINITY
  for (const key of keys) {
    const count = assigned[key] ?? 0
    if (count < bestCount) {
      best = key
      bestCount = count
    }
  }
  if (best === undefined) throw new Error('an experiment without variants has none to assign')
  return best
}

/** What an account can test on each dimension, keyed like the catalog. */
export type AccountCatalog = Record<ExperimentKind, readonly CatalogVariant[]>

/**
 * What an account can test: the catalog, with a post kind only among the
 * intents its cadence plans, since the planner plans no other. The first
 * left is the control.
 */
export function accountCatalog(intents: readonly PostIntent[]): AccountCatalog {
  const kinds = EXPERIMENT_CATALOG.post_kind.filter((variant) => intents.some((intent) => intent === variant.key))
  return { ...EXPERIMENT_CATALOG, post_kind: kinds.map((variant, index) => ({ ...variant, isControl: index === 0 })) }
}

/** The catalog's control of a dimension: its first variant. */
export function catalogControl(kind: ExperimentKind): CatalogVariant {
  const [control] = EXPERIMENT_CATALOG[kind]
  if (!control) throw new Error(`the experiment catalog has no variants for ${kind}`)
  return control
}

/**
 * What a variant's items brought, by the experiment's metric: how many items
 * it has, and the sum and the sum of squares of their values, enough for its
 * mean and its spread.
 */
export interface VariantStats {
  key: string
  /** Items measured under this variant that count the metric: replies or posts. */
  items: number
  sum: number
  sumSquares: number
}

export interface ExperimentDecision {
  winnerKey: string
  /** Relative lift of the winner over the runner-up, 0.25 = 25% better. */
  lift: number
  /** One-sided confidence that the winner's mean is higher, 0..1. */
  confidence: number
}

/** What each rung of the ladder is called per item, for learnings, the journal and the studio. */
export const EXPERIMENT_METRIC_LABELS: Record<ExperimentMetric, string> = {
  paid: 'paid customers per post',
  signups: 'signups per post',
  clicks: 'clicks per post',
  reach: 'reach per item',
}

/** The items each variant needs before the strategy review's experiment is decided, and before later data can contradict a decision. */
export const REVIEW_MIN_ITEMS = 15

/**
 * How many of each rung the account's posts brought in the review's window
 * before that rung can be an experiment's metric: enough that a variant can
 * win on it within a few weeks.
 */
const LADDER_FLOORS = { paid: 5, signups: 10, clicks: 30 } as const satisfies Partial<Record<ExperimentMetric, number>>

/** The metrics a dimension can be decided on, and why not every rung of the ladder when it cannot. */
export type DimensionMetrics = { metrics: typeof EXPERIMENT_METRICS; why: null } | { metrics: readonly ExperimentMetric[]; why: string }

/**
 * The metrics a dimension can be decided on, on one platform. A reply
 * carries no tracked link, and a post's kind decides whether it may carry
 * the sponsor's link at all (a question never does): a test on drafts whose
 * link is not the variant's doing aims at reach (CONTEXT.md, "Goal metric").
 * A post on Reddit or Hacker News links to the sponsor directly, so no click
 * is counted there (shared `countsClicks`). Otherwise the hook and the call
 * to action climb the whole ladder. The form offers these, and a start on
 * any other is refused with `why`.
 */
export function metricsFor(kind: ExperimentKind, platform: Platform): DimensionMetrics {
  if (isReplyExperimentKind(kind)) return { metrics: ['reach'], why: 'A reply carries no link.' }
  if (kind === 'post_kind') return { metrics: ['reach'], why: "A post's kind decides whether it may carry the sponsor's link at all." }
  if (!countsClicks(platform)) {
    const why = `A post on ${PLATFORM_IN_WORDS[platform]} links to the sponsor directly, so no click is counted.`
    return { metrics: EXPERIMENT_METRICS.filter((metric) => metric !== 'clicks'), why }
  }
  return { metrics: EXPERIMENT_METRICS, why: null }
}

/** Metrics as a sentence names them: "paid, signups or reach". */
export function metricsText(metrics: readonly ExperimentMetric[]): string {
  return new Intl.ListFormat('en-GB', { type: 'disjunction' }).format(metrics.map((metric) => METRIC_LABELS[metric].toLowerCase()))
}

/**
 * The metric the strategy review gives a new experiment (CONTEXT.md, "Goal
 * metric"): among the ones its dimension can be decided on for the account
 * (core `measurableMetrics`), the rung closest to paying customers that the
 * account's posts brought enough of, down to reach; none when reach cannot
 * be read either, so the dimension cannot be tested.
 */
export function reviewMetric(
  allowed: readonly ExperimentMetric[],
  brought: Readonly<{ paid: number; signups: number; clicks: number | null }>
): ExperimentMetric | null {
  for (const metric of ['paid', 'signups', 'clicks'] as const) {
    const count = brought[metric]
    if (allowed.includes(metric) && count !== null && count >= LADDER_FLOORS[metric]) return metric
  }
  return allowed.includes('reach') ? 'reach' : null
}

/**
 * A rate as people read it: reach per item as a whole number, and what posts
 * bring the sponsor per post with two decimals (0.14 clicks per post).
 */
export function rateText(metric: ExperimentMetric, rate: number): string {
  if (metric === 'reach') return grouped(rate)
  return rate.toFixed(2)
}

/** A rate as a journal number: reach per item rounded, the rest to 0.01. */
export function rateNumber(metric: ExperimentMetric, rate: number): number {
  if (metric === 'reach') return Math.round(rate)
  return Math.round(rate * 100) / 100
}

/** A whole number with thousands separators, written out here so the text never depends on the runtime's locale. */
export function grouped(value: number): string {
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** The confidence an experiment the account picks needs before its leader becomes the default. */
export const AUTO_MIN_CONFIDENCE = 0.9

/**
 * A confidence as a whole percentage, rounded down and at most 99: a test is
 * never certain, so 0.9996 reads 99%, and so does a test whose p-value
 * underflows to a confidence of exactly 1.
 */
export function confidencePercent(confidence: number): number {
  return Math.min(99, Math.floor(confidence * 100))
}

/** A variant's mean value per item; 0 before it has any. */
export function variantRate(stats: VariantStats): number {
  if (stats.items === 0) return 0
  return stats.sum / stats.items
}

/** A variant's sample variance (n − 1); it needs at least two items. */
function variance(stats: VariantStats): number {
  const mean = variantRate(stats)
  return Math.max(0, (stats.sumSquares - stats.items * mean * mean) / (stats.items - 1))
}

/** ln Γ(x), Lanczos' approximation: enough digits for a verdict. */
function logGamma(x: number): number {
  const coefficients = [
    76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.001208650973866179, -0.000005395239384953,
  ]
  let y = x
  const base = x + 5.5 - (x + 0.5) * Math.log(x + 5.5)
  let series = 1.000000000190015
  for (const coefficient of coefficients) {
    y += 1
    series += coefficient / y
  }
  return -base + Math.log((2.5066282746310007 * series) / x)
}

/** The continued fraction of the regularized incomplete beta function (Numerical Recipes, betacf). */
function betaFraction(a: number, b: number, x: number): number {
  const tiny = 1e-30
  let c = 1
  let d = 1 - ((a + b) * x) / (a + 1)
  if (Math.abs(d) < tiny) d = tiny
  d = 1 / d
  let h = d
  for (let m = 1; m <= 200; m += 1) {
    const even = (m * (b - m) * x) / ((a + 2 * m - 1) * (a + 2 * m))
    d = 1 + even * d
    if (Math.abs(d) < tiny) d = tiny
    c = 1 + even / c
    if (Math.abs(c) < tiny) c = tiny
    d = 1 / d
    h *= d * c
    const odd = (-(a + m) * (a + b + m) * x) / ((a + 2 * m) * (a + 2 * m + 1))
    d = 1 + odd * d
    if (Math.abs(d) < tiny) d = tiny
    c = 1 + odd / c
    if (Math.abs(c) < tiny) c = tiny
    d = 1 / d
    const step = d * c
    h *= step
    if (Math.abs(step - 1) < 1e-12) break
  }
  return h
}

/** The regularized incomplete beta function I_x(a, b). */
function incompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x))
  if (x < (a + 1) / (a + b + 2)) return (front * betaFraction(a, b, x)) / a
  return 1 - (front * betaFraction(b, a, 1 - x)) / b
}

/** The two-sided confidence that a t statistic with `df` degrees of freedom is no chance: 1 − p. */
function twoSidedConfidence(t: number, df: number): number {
  return 1 - incompleteBeta(df / (df + t * t), df / 2, 0.5)
}

/**
 * The fewest events the winner must have brought on a rung of rare events
 * before a verdict on it counts: two paid customers against none is luck.
 */
export const METRIC_MIN_EVENTS: Record<ExperimentMetric, number> = { paid: 5, signups: 5, clicks: 5, reach: 0 }

/**
 * Where an experiment stands: still waiting for items, decided, or done
 * without a winner. The analyst asks once every variant has `minItems` (at
 * least two, for a spread) and acts on the answer: a winner becomes the
 * default, an inconclusive test stops and frees the account's one slot.
 */
export type ExperimentVerdict = { kind: 'waiting' } | { kind: 'decided'; decision: ExperimentDecision } | { kind: 'inconclusive' }

/**
 * Welch's two-sided t test between the best and the second-best variant's
 * mean per item, with Welch's degrees of freedom. Every rung of the ladder is
 * a count per item, and reach varies far more from item to item than a
 * count of events would, so the test reads each variant's own spread; the
 * leader is picked after looking, so the test asks of either side.
 * Decided only on a finite confidence that clears `minConfidence` and a
 * winner with at least `minEvents` events; two variants with no spread and
 * the same mean decide nothing.
 */
export function experimentVerdict(
  variants: VariantStats[],
  options: { minItems: number; minConfidence: number; minEvents: number }
): ExperimentVerdict {
  const floor = Math.max(2, options.minItems)
  if (variants.length < 2 || variants.some((variant) => variant.items < floor)) return { kind: 'waiting' }
  const ranked = [...variants].sort((a, b) => variantRate(b) - variantRate(a))
  const [best, second] = ranked
  if (!best || !second) return { kind: 'waiting' }
  const difference = variantRate(best) - variantRate(second)
  if (difference <= 0 || best.sum < options.minEvents) return { kind: 'inconclusive' }
  const spreadBest = variance(best) / best.items
  const spreadSecond = variance(second) / second.items
  const standardError = Math.sqrt(spreadBest + spreadSecond)
  const freedom = spreadBest ** 2 / (best.items - 1) + spreadSecond ** 2 / (second.items - 1)
  const df = freedom === 0 ? best.items + second.items - 2 : (spreadBest + spreadSecond) ** 2 / freedom
  // No spread at all: the means differ every time, which is all a test could say.
  const confidence = standardError === 0 ? 1 : twoSidedConfidence(difference / standardError, df)
  if (!Number.isFinite(confidence) || confidence < options.minConfidence) return { kind: 'inconclusive' }
  const secondRate = variantRate(second)
  const lift = secondRate === 0 ? 1 : variantRate(best) / secondRate - 1
  return { kind: 'decided', decision: { winnerKey: best.key, lift, confidence } }
}

/**
 * A finished experiment of the account, as the next pick reads it: which
 * variants it ran and, once decided, which won and when. A stopped one taught
 * nothing, so it has neither.
 */
export type ExperimentHistoryRow = {
  id: string
  kind: ExperimentKind
  variants: readonly CatalogVariant[]
} & (
  | {
      status: 'decided'
      winnerKey: string
      decidedAt: number
      /**
       * The variant that came second, whose rate a contradiction compares
       * against. The analyst's decisions store it; the operator's verdict has
       * no ranking, and decisions from before it was stored lack it.
       */
      runnerUpKey?: string
    }
  | { status: 'stopped' }
)

/** The account's next experiment: the dimension, what it does now (the control), and what it tries instead. */
export interface NextExperiment {
  kind: ExperimentKind
  control: CatalogVariant
  challenger: CatalogVariant
  /** The decided experiment whose winner later data contradicted, when this tests it again. */
  retestOf?: string
}

/** How far back a decision or a loss counts as knowledge: older ones are tried again. */
export const EXPERIMENT_MEMORY_MS = 180 * 24 * 60 * 60 * 1000

export type DecidedRow = Extract<ExperimentHistoryRow, { status: 'decided' }>

function decidedRows(history: readonly ExperimentHistoryRow[], kind: ExperimentKind): DecidedRow[] {
  return history.flatMap((row) => (row.kind === kind && row.status === 'decided' ? [row] : []))
}

/** A default as the control of a new experiment: what the account did before. */
function asControl(variant: { key: string; label: string; description: string }): CatalogVariant {
  return { key: variant.key, label: variant.label, description: variant.description, isControl: true }
}

function asChallenger(variant: CatalogVariant): CatalogVariant {
  return { ...variant, isControl: false }
}

/**
 * The variant a decided experiment's winner beat: the runner-up, whose rate a
 * contradiction compares against, so a re-test runs against the variant whose
 * number triggered it.
 */
export function beatenVariant(row: DecidedRow): CatalogVariant {
  if (row.runnerUpKey !== undefined) {
    const runnerUp = row.runnerUpKey
    const beaten = row.variants.find((variant) => variant.key === runnerUp && variant.key !== row.winnerKey)
    if (!beaten) throw new Error(`experiment ${row.id} names runner-up "${runnerUp}", which is not one of its losing variants`)
    return beaten
  }
  // Decisions from before the runner-up's key was stored. An experiment the
  // account picks has two variants, so the other one is the runner-up; with
  // more, the control when it lost, else the first variant that lost.
  const losers = row.variants.filter((variant) => variant.key !== row.winnerKey)
  const beaten = losers.find((variant) => variant.isControl) ?? losers[0]
  if (!beaten) throw new Error(`experiment ${row.id} was decided with no variant beside its winner`)
  return beaten
}

/**
 * The challenger on a dimension: a catalog variant other than what the
 * account does now that has not lost there in the last 180 days, in catalog
 * order; when every one has, the one that lost longest ago.
 */
function pickChallenger(
  variants: readonly CatalogVariant[],
  currentKey: string,
  decided: DecidedRow[],
  now: number
): CatalogVariant | null {
  const candidates = variants.filter((variant) => variant.key !== currentKey)
  const lostAt = (key: string): number | null => {
    const losses = decided.filter((row) => row.winnerKey !== key && row.variants.some((variant) => variant.key === key))
    if (losses.length === 0) return null
    return Math.max(...losses.map((row) => row.decidedAt))
  }
  const fresh = candidates.find((variant) => {
    const lost = lostAt(variant.key)
    if (lost === null) return true
    return lost < now - EXPERIMENT_MEMORY_MS
  })
  if (fresh) return fresh
  let oldest: { variant: CatalogVariant; lostAt: number } | null = null
  for (const variant of candidates) {
    const lost = lostAt(variant.key)
    if (lost === null) continue
    if (oldest === null || lost < oldest.lostAt) oldest = { variant, lostAt: lost }
  }
  return oldest === null ? null : oldest.variant
}

/**
 * Which experiment the account runs next (docs/plan.md, v0.2 item 8). A
 * dimension whose default later data contradicted comes first, tested again
 * against the variant it beat. Otherwise the dimension the account knows least
 * about: the fewest decided experiments in the last 180 days, then the one
 * decided longest ago (never decided first), then catalog order. A posting
 * time decided within those days is not tested again: its variants move from
 * the account's hour, which the decision moved, so an untried key there can
 * be the hour that just lost. Null when no dimension applies to the account.
 */
export function pickNextExperiment(args: {
  /** The dimensions that apply to the account now. */
  kinds: readonly ExperimentKind[]
  /** What the account can test on each (`accountCatalog`). */
  catalog: AccountCatalog
  /** The account's decided and stopped experiments, of any age. */
  history: readonly ExperimentHistoryRow[]
  defaults: readonly StrategyDefault[]
  /** Dimensions whose default later data contradicted. */
  contradicted: readonly ExperimentKind[]
  now: number
}): NextExperiment | null {
  const applicable = EXPERIMENT_KINDS.filter((kind) => args.kinds.includes(kind))
  for (const kind of applicable) {
    if (!args.contradicted.includes(kind)) continue
    const current = args.defaults.find((entry) => entry.kind === kind)
    // A default the account can no longer test (a post kind its cadence dropped) is not tested again.
    if (current !== undefined && !args.catalog[kind].some((variant) => variant.key === current.key)) continue
    if (current?.experimentId === undefined) throw new Error(`the ${kind} default is contradicted but came from no experiment`)
    const source = decidedRows(args.history, kind).find((row) => row.id === current.experimentId)
    if (!source)
      throw new Error(`the ${kind} default came from experiment ${current.experimentId}, which is not a decided ${kind} experiment`)
    return { kind, control: asControl(current), challenger: asChallenger(beatenVariant(source)), retestOf: source.id }
  }

  const ranked = applicable
    .map((kind, order) => {
      const decided = decidedRows(args.history, kind)
      const recent = decided.filter((row) => row.decidedAt >= args.now - EXPERIMENT_MEMORY_MS).length
      const lastDecidedAt = decided.length === 0 ? null : Math.max(...decided.map((row) => row.decidedAt))
      return { kind, order, recent, lastDecidedAt, decided }
    })
    .sort((a, b) => {
      if (a.recent !== b.recent) return a.recent - b.recent
      if (a.lastDecidedAt !== b.lastDecidedAt) {
        if (a.lastDecidedAt === null) return -1
        if (b.lastDecidedAt === null) return 1
        return a.lastDecidedAt - b.lastDecidedAt
      }
      return a.order - b.order
    })
  for (const candidate of ranked) {
    if (candidate.kind === 'posting_time' && candidate.recent > 0) continue
    const variants = args.catalog[candidate.kind]
    // A default the account can no longer test, a post kind its cadence dropped, gives way to the catalog's first.
    const current =
      args.defaults.find((entry) => entry.kind === candidate.kind && variants.some((variant) => variant.key === entry.key)) ?? variants[0]
    // A dimension with one variant left for the account has nothing to test.
    if (current === undefined) continue
    const challenger = pickChallenger(variants, current.key, candidate.decided, args.now)
    if (!challenger) continue
    return { kind: candidate.kind, control: asControl(current), challenger: asChallenger(challenger) }
  }
  return null
}

/**
 * The items a default needs since its decision before later data can
 * contradict it: the review's own floor at the least, whatever the
 * experiment asked for, so an operator's quick experiment is not re-tested
 * on noise.
 */
export function contradictionMinItems(experimentMinItems: number): number {
  return Math.max(REVIEW_MIN_ITEMS, experimentMinItems)
}

/**
 * Whether later data contradicts a decided winner: once the default has
 * `minItems` since the decision (`contradictionMinItems`), its mean since
 * then is at or below what the runner-up had at the decision. A runner-up
 * that brought nothing makes nothing since no contradiction: on a rung of
 * rare events, none in a few weeks is luck.
 */
export function contradicts(decision: { winnerRate: number; runnerUpRate: number }, since: VariantStats, minItems: number): boolean {
  if (since.items < minItems) return false
  if (decision.runnerUpRate === 0) return false
  return variantRate(since) <= decision.runnerUpRate
}

export interface PillarWeight {
  pillar: string
  weight: number
}

/**
 * The weights the planner shares the evergreen slots out by, one per current
 * pillar in pillar order, summing to 1. A stored weight of a current pillar is
 * kept, a pillar without one gets the mean of the others (equal shares when
 * none is stored), and a removed pillar's weight is dropped. The one reading
 * of the stored list: nothing reads it raw.
 */
export function pillarWeights(pillars: readonly string[], stored: readonly PillarWeight[] | undefined): PillarWeight[] {
  if (pillars.length === 0) return []
  const kept = pillars.map((pillar) => ({ pillar, weight: stored?.find((entry) => entry.pillar === pillar)?.weight }))
  const known = kept.flatMap((entry) => (entry.weight === undefined ? [] : [entry.weight]))
  const fill = known.length === 0 ? 1 : known.reduce((sum, weight) => sum + weight, 0) / known.length
  const filled = kept.map((entry) => ({ pillar: entry.pillar, weight: entry.weight ?? fill }))
  const total = filled.reduce((sum, entry) => sum + entry.weight, 0)
  if (total <= 0) throw new Error('stored pillar weights sum to zero; the review never stores a weight under the floor')
  return filled.map((entry) => ({ pillar: entry.pillar, weight: entry.weight / total }))
}

/** What one review moves from the weakest to the strongest, and the least each keeps. */
const WEIGHT_STEP = 0.1
const WEIGHT_FLOOR = 0.1
/** How far ahead the strongest must be, on its score or on the tiebreak, before weight moves. */
const WEIGHT_LEAD = 1.2
/** A pillar or a community needs this many measured items before its score counts. */
const MIN_SCORED_ITEMS = 2

/** A share of the plan the review can move: a pillar's, or a community's. */
export interface NamedWeight {
  name: string
  weight: number
}

/** What a pillar or a community earned over the review's window. */
export interface WeightScore {
  name: string
  /** What it is ranked on: value per post for a pillar, clicks per item for a community. */
  score: number
  /** What breaks a tie on the score: clicks per reach for a pillar, reach per item for a community. */
  tiebreak: number
  /** The measured items the score is over. */
  items: number
}

export interface PillarScore {
  pillar: string
  /** Value per post. */
  score: number
  /** Clicks per reach, for pillars that tie on value. */
  tiebreak: number
  posts: number
}

/** True when `best` is at least WEIGHT_LEAD times `worst` and strictly above it. */
function leads(best: number, worst: number): boolean {
  if (best <= worst) return false
  return best >= worst * WEIGHT_LEAD
}

/**
 * One review's change to a set of weights: among those with at least two
 * measured items, when the best scores at least 20% above the worst (or ties
 * on score and wins the tiebreak by 20%), 0.1 moves from the worst to the
 * best, never taking one under 0.1. Null when nothing moves.
 */
export function shiftWeights(
  weights: readonly NamedWeight[],
  scores: readonly WeightScore[]
): { weights: NamedWeight[]; change: { up: string; down: string } } | null {
  const order = (name: string) => weights.findIndex((entry) => entry.name === name)
  const measured = scores
    .filter((score) => {
      if (score.items < MIN_SCORED_ITEMS) return false
      return order(score.name) !== -1
    })
    .sort((a, b) => b.score - a.score || b.tiebreak - a.tiebreak || order(a.name) - order(b.name))
  const best = measured[0]
  const worst = measured[measured.length - 1]
  if (!best || !worst || best.name === worst.name) return null
  const ahead = best.score === worst.score ? leads(best.tiebreak, worst.tiebreak) : leads(best.score, worst.score)
  if (!ahead) return null
  const worstEntry = weights.find((entry) => entry.name === worst.name)
  if (!worstEntry) throw new Error(`"${worst.name}" was scored but has no weight`)
  const moved = Math.min(WEIGHT_STEP, worstEntry.weight - WEIGHT_FLOOR)
  // Floating point leaves one at the floor a hair above it; that is no room to move.
  if (moved < 1e-9) return null
  const shifted = weights.map((entry) => {
    if (entry.name === best.name) return { name: entry.name, weight: entry.weight + moved }
    if (entry.name === worst.name) return { name: entry.name, weight: entry.weight - moved }
    return { name: entry.name, weight: entry.weight }
  })
  const total = shifted.reduce((sum, entry) => sum + entry.weight, 0)
  return {
    weights: shifted.map((entry) => ({ name: entry.name, weight: entry.weight / total })),
    change: { up: best.name, down: worst.name },
  }
}

/** `shiftWeights` over the account's pillars (shared `pillarWeights`). */
export function shiftPillarWeights(
  weights: readonly PillarWeight[],
  scores: readonly PillarScore[]
): { weights: PillarWeight[]; change: { up: string; down: string } } | null {
  const shift = shiftWeights(
    weights.map((entry) => ({ name: entry.pillar, weight: entry.weight })),
    scores.map((score) => ({ name: score.pillar, score: score.score, tiebreak: score.tiebreak, items: score.posts }))
  )
  if (!shift) return null
  return { weights: shift.weights.map((entry) => ({ pillar: entry.name, weight: entry.weight })), change: shift.change }
}

/**
 * The pillars of a week's evergreen slots, in slot order: each slot goes to
 * the pillar with the largest `weight * (total + 1) - count`, where total is
 * every prior post plus the slots assigned so far and count is the
 * pillar's. Prior posts count, so the weights hold across weeks. Ties go
 * to the pillar listed first. Only the weighted pillars' counts make the
 * total: a post of a removed pillar says nothing about the current ones.
 */
export function allocatePillars(weights: readonly PillarWeight[], priorCounts: Readonly<Record<string, number>>, slots: number): string[] {
  if (slots <= 0) return []
  if (weights.length === 0) throw new Error('allocating pillars needs at least one weighted pillar')
  const rows = weights.map((entry) => ({ pillar: entry.pillar, weight: entry.weight, count: priorCounts[entry.pillar] ?? 0 }))
  let total = rows.reduce((sum, row) => sum + row.count, 0)
  const out: string[] = []
  for (let slot = 0; slot < slots; slot += 1) {
    let pick: { row: (typeof rows)[number]; need: number } | null = null
    for (const row of rows) {
      const need = row.weight * (total + 1) - row.count
      // Weights that are equal on paper differ in the last bits; treat them as tied, so the first listed wins.
      if (pick === null || need > pick.need + 1e-9) pick = { row, need }
    }
    if (pick === null) throw new Error('pillar allocation picked no pillar')
    out.push(pick.row.pillar)
    pick.row.count += 1
    total += 1
  }
  return out
}
