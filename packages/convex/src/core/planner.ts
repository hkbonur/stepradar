import {
  DEFAULT_LENGTH_MIX,
  POST_INTENTS,
  allocatePillars,
  postingTimeOffset,
  leastAssigned,
  hackerNewsCommunity,
  postsToMetCommunity,
  postPlacingOf,
  MET_COMMUNITY_NOUNS,
  MODELED_KEY,
  effectiveVariant,
  PLATFORM_IN_WORDS,
  type MetCommunityPlatform,
  type Platform,
  type PlatformPlace,
  type SelfPromotion,
  pickLengths,
  pillarWeights,
  postSlotHours,
  type LengthMix,
  type PillarWeight,
  type PostExperimentKind,
  type PostIntent,
  type PostKind,
  type PostLength,
  type SponsorSegment,
  type XCadence,
} from '@influstep/shared'
import type { Doc, Id } from '../_generated/dataModel'
import { activeCommunities } from './communities'
import type { BasisThread, PostBasis } from '../lib/validators'
import { addDays, dayKey, instantAt, weekStart } from './dates'
import type { PlannedPostInput } from './posts'

/**
 * The weekly plan (CONTEXT.md, "Plan"): which days get a post at each slot
 * hour, which of those carry the sponsor, and which pillar or signal each
 * draws from. Pure, so the rules are testable without a database; the
 * writer's plan_week job feeds it rows and stores the output.
 */

/** How far back the posts a pillar already had count toward its share (shared `allocatePillars`). */
export const PILLAR_HISTORY_DAYS = 28

export interface PlannerAccount {
  pillars: string[]
}

export interface PlannerSignal {
  id: Id<'signals'>
  title: string
  score: number
  topics: string[]
}

/** One day of one slot hour of the week: what it is about. Where it goes and whether it carries the sponsor come once the week is shaped (`planPostSlots`). */
export interface PlannedDay {
  plannedFor: string
  pillar: string
  signalId?: Id<'signals'>
  concept: string
}

/**
 * The concept a signal becomes: the one rule the planner, the operator's
 * "make a post" on the Signals page and the last check's swap all use.
 */
export function signalConcept(title: string): string {
  return `React to: ${title}`
}

export function planWeek(args: {
  weekStart: string
  account: PlannerAccount
  /** The account's effective pillar weights (shared `pillarWeights`). */
  pillarWeights: PillarWeight[]
  /** The account's posts per pillar of the last PILLAR_HISTORY_DAYS days, so the weights hold across weeks. */
  priorCounts: Record<string, number>
  signals: PlannerSignal[]
  /** Days that already hold a post at this slot for this account. */
  takenDays: string[]
}): PlannedDay[] {
  const { account } = args
  if (account.pillars.length === 0) return []

  // One post a day at the slot: every day of the week that does not hold one yet.
  const days = Array.from({ length: 7 }, (_, offset) => addDays(args.weekStart, offset)).filter((day) => !args.takenDays.includes(day))

  // The caller passes each signal's freshness as its score (shared `signalFreshness`), so the freshest leads.
  const rankedSignals = [...args.signals].sort((a, b) => b.score - a.score)
  // Two of five reactive, the rest evergreen (docs/plan.md, idea 7).
  const reactiveCount = Math.min(rankedSignals.length, Math.max(1, Math.round(days.length * 0.4)))

  // Reactive slots take the pillar their signal is about; the evergreen slots share the rest out by weight,
  // counting this week's reactive slots with the posts the pillars already had.
  const reactivePillars = days.flatMap((_, index) => {
    const signal = index < reactiveCount ? rankedSignals[index] : undefined
    return signal ? [pillarFor(signal.topics, account.pillars)] : []
  })
  const counts = { ...args.priorCounts }
  for (const pillar of reactivePillars) counts[pillar] = (counts[pillar] ?? 0) + 1
  const evergreen = allocatePillars(args.pillarWeights, counts, days.length - reactivePillars.length)

  return days.map((day, index) => {
    const signal = index < reactiveCount ? rankedSignals[index] : undefined
    const pillar = signal ? pillarFor(signal.topics, account.pillars) : evergreen[index - reactivePillars.length]
    if (pillar === undefined) throw new Error(`slot ${index} of the week has no pillar`)
    const concept = signal ? signalConcept(signal.title) : `${pillar}: an evergreen how-to`
    return { plannedFor: day, pillar, signalId: signal?.id, concept }
  })
}

/** A standout thread a post can be modeled on, as the post keeps it, and the pillar it is about (core/niche.ts). */
export interface PlannerStandout {
  thread: BasisThread
  pillar: string
}

/** The questions about one pillar a round-up answers, as the post keeps them (core/niche.ts). */
export type PlannerRoundup = Extract<PostBasis, { kind: 'roundup' }>

/** Another account's post that brought users, to be reworked for this one, as the post keeps it (core/niche.ts). */
export type PlannerRework = Extract<PostBasis, { kind: 'rework' }>

/** What a post slot sets out to do, how long it runs, and the kind of post that length takes. */
export interface PostShape {
  intent: PostIntent
  length: PostLength
  kind: PostKind
}

/**
 * The post slots of an account with an X format: every day of the week at the
 * hours of its cadence (postSlotHours), skipping a day that already holds
 * posts and any hour already gone. The slots are shaped in time order
 * (shapePostSlots), from the voice's length mix once the analyst has learned
 * it, so a new week carries on where the last one stopped.
 *
 * planWeek plans one slot per day, so it runs once per slot hour with every
 * open day free. The pillar weights are the account's, and the posts each
 * pillar had in the last PILLAR_HISTORY_DAYS days, plus the slots of the
 * hours already planned, count toward its share.
 */
export interface PostSlotsInput {
  weekStart: string
  account: Pick<
    Doc<'accounts'>,
    'platform' | 'pillars' | 'sponsorDial' | 'sponsorRampPosts' | 'timezone' | 'voice' | 'strategy' | 'publishHour' | 'cadence'
  >
  /** The account's live posts; their count also moves the sponsor ramp. */
  posts: Pick<Doc<'posts'>, 'plannedFor' | 'kind' | 'pillar' | 'community' | 'basis'>[]
  /** The communities the account has met, with their rules' read and their weight: where a Reddit or forum post goes, which needs one (`noMetCommunity`). */
  communities: PlannerCommunity[]
  signals: PlannerSignal[]
  /** The running post experiment, whose variants the slots take in turn; null when none runs. */
  experiment: PostExperimentPlan | null
  /** The decided post kinds still remembered, each with the kind it beat, whose turns in the rotation it takes. */
  kindSwaps: readonly KindSwap[]
  /** The standouts a post can be modeled on, the most out of line first (core/niche.ts). */
  standouts: readonly PlannerStandout[]
  /** The round-up the account's questions make; null when they make none (core/niche.ts). */
  roundup: PlannerRoundup | null
  /** Another account's post that brought users, to rework this week; null when none did (core/niche.ts). */
  rework: PlannerRework | null
  now: number
}

/** What a week holds one of at most, in the order its evergreen posts take them: its round-up, then its reworked post. */
type WeeklyPost = PlannerRoundup | PlannerRework

export function planPostSlots(args: PostSlotsInput): PlannedPostInput[] {
  // A week that already holds its round-up or its reworked post takes no other.
  const held = (kind: WeeklyPost['kind']) =>
    args.posts.some((post) => post.basis?.kind === kind && weekStart(post.plannedFor) === args.weekStart)
  const weekly = [args.roundup, args.rework].flatMap((post) => (post === null || held(post.kind) ? [] : [post]))
  const planned = planSlots(args, weekly)
  const roundupPlaced = planned.some((post) => post.basis?.kind === 'roundup')
  if (roundupPlaced || !weekly.some((post) => post.kind === 'roundup')) return planned
  // No post of the week could hold the round-up: its questions go back to the reactive slots.
  return planSlots(
    args,
    weekly.filter((post) => post.kind !== 'roundup')
  )
}

function planSlots(args: PostSlotsInput, weekly: readonly WeeklyPost[]): PlannedPostInput[] {
  const { platform, cadence } = args.account
  if (cadence.kinds.length === 0) throw new Error('a cadence without post kinds cannot plan posts')
  const week = Array.from({ length: 7 }, (_, offset) => addDays(args.weekStart, offset))
  const open = (day: string, hour: number) =>
    !args.posts.some((post) => post.plannedFor === day) && instantAt(day, hour, args.account.timezone) > args.now
  const slots: (PlannedDay & { hour: number })[] = []
  // A decided post model, while no post model test runs: every evergreen post takes a standout while one is left.
  const modelsInForce =
    args.experiment?.kind !== 'post_model' && effectiveVariant('post_model', {}, args.account.strategy?.defaults).key === MODELED_KEY
  const modeling = args.experiment?.kind === 'post_model' || modelsInForce
  // A standout a post may be modeled on, or a question a round-up answers, is no reactive signal of the same plan.
  const drawnOn = new Set<Id<'signals'>>([
    ...(modeling ? args.standouts.map((standout) => standout.thread.signalId) : []),
    ...weekly.flatMap((post) => (post.kind === 'roundup' ? post.questions.map((question) => question.signalId) : [])),
  ])
  let signals = args.signals.filter((signal) => !drawnOn.has(signal.id))
  const weights = pillarWeights(args.account.pillars, args.account.strategy?.pillarWeights)
  const since = addDays(dayKey(args.now, args.account.timezone), -PILLAR_HISTORY_DAYS)
  const counts: Record<string, number> = {}
  for (const post of args.posts) {
    if (post.pillar === undefined || post.plannedFor < since) continue
    counts[post.pillar] = (counts[post.pillar] ?? 0) + 1
  }
  for (const hour of postSlotHours(args.account)) {
    const row = planWeek({
      weekStart: args.weekStart,
      account: { pillars: args.account.pillars },
      pillarWeights: weights,
      priorCounts: { ...counts },
      signals,
      takenDays: week.filter((day) => !open(day, hour)),
    })
    for (const planned of row) {
      counts[planned.pillar] = (counts[planned.pillar] ?? 0) + 1
      slots.push({ ...planned, hour })
    }
    const taken = new Set(row.map((planned) => planned.signalId))
    signals = signals.filter((signal) => !taken.has(signal.id))
  }
  slots.sort((a, b) => a.plannedFor.localeCompare(b.plannedFor) || a.hour - b.hour)
  const shapes = shapePostSlots({
    platform,
    cadence,
    // Before the analyst learns the account's voice, the week follows the default mix.
    lengthMix: args.account.voice?.lengthMix ?? DEFAULT_LENGTH_MIX,
    count: slots.length,
    postsSoFar: args.posts.length,
    singlesSoFar: args.posts.filter((post) => post.kind !== 'thread').length,
  })
  const met = postsToMetCommunity(platform) ? communitiesFor(args.communities, args.posts, slots.length, since) : []
  const experiment = args.experiment
  // A post kind is balanced over every post, and set before the post is placed: it decides where the post goes.
  const kindCounts = experiment === null ? {} : sumCounts(experiment.assigned.sponsored, experiment.assigned.plain)
  const placed = slots.map((slot, index) => {
    const rotated = shapes[index]
    if (!rotated) throw new Error(`post slot ${index} has no shape`)
    const kindTag = experiment?.kind === 'post_kind' ? nextVariant(experiment, kindCounts) : null
    const intent = kindTag === null ? kindInForce(rotated.intent, args.kindSwaps) : postIntentOf(kindTag.variantKey)
    const shape = { ...rotated, intent }
    return { slot, shape, kindTag, place: placementOf(platform, intent, met[index] ?? null) }
  })
  const sponsored = sponsoredSlots(
    placed.map(({ shape, place }) => ({ mayCarry: mayCarrySponsor(shape, place), show: shape.intent === 'show' })),
    { dial: args.account.sponsorDial, rampLeft: Math.max(0, args.account.sponsorRampPosts - args.posts.length) }
  )
  // A hook or a call to action is balanced within the posts that carry the sponsor and within the ones that do not, so its link favours neither.
  const groupCounts = { sponsored: { ...experiment?.assigned.sponsored }, plain: { ...experiment?.assigned.plain } }
  const days = experiment?.kind === 'posting_time' ? postingDays(experiment, slots, args.account.timezone, args.now) : null
  const standoutsLeft = [...args.standouts]
  const weeklyLeft = [...weekly]
  return placed.map(({ slot, shape, kindTag, place }, index) => {
    const { signalId, hour, ...day } = slot
    const carries = sponsored.has(index)
    // A show is the operator's own work: one the dial leaves without the sponsor is a share, and on Hacker News goes to the front page.
    const intent = shape.intent === 'show' && !carries ? 'share' : shape.intent
    const community = platform === 'hackernews' ? hackerNewsCommunity(intent) : place.community
    // A post drawn from what worked takes an evergreen slot: a reactive one keeps its signal.
    const evergreen = signalId === undefined
    // The week's round-up first, then its reworked post, each in the first evergreen post that can hold it.
    const weeklyPost = holdsDrawnPost(platform, { ...shape, intent }, evergreen) ? weeklyLeft.shift() : undefined
    const tagOf = () => {
      if (experiment === null) return null
      // A post kind variant that placement changed is no longer the variant: the post leaves the experiment.
      if (experiment.kind === 'post_kind') return intent === shape.intent ? kindTag : null
      if (days !== null) return days.get(day.plannedFor) ?? null
      const counts = groupCounts[carries ? 'sponsored' : 'plain']
      if (experiment.kind !== 'post_model') return nextVariant(experiment, counts)
      // A round-up or a reworked post is drawn from what worked but modeled on nothing: it is neither variant, and leaves the test.
      if (weeklyPost !== undefined) return null
      return modelTag(experiment, counts, evergreen && standoutsLeft.length > 0)
    }
    const tag = tagOf()
    const modeled =
      experiment?.kind === 'post_model' ? tag?.variantKey === MODELED_KEY : modelsInForce && evergreen && weeklyPost === undefined
    const standout = modeled ? standoutsLeft.shift() : undefined
    const drawn = drawnOf({ signalId, standout, weeklyPost })
    return {
      ...day,
      ...shape,
      intent,
      sponsorSegment: carries ? 'mention' : 'none',
      ...(community === null ? {} : { community }),
      ...(tag === null ? {} : { experiment: tag }),
      publishHour: days !== null && tag !== null ? hour + postingTimeOffset(tag.variantKey) : hour,
      ...drawnFields(drawn, day),
    }
  })
}

/** What a post is drawn from: the week's plan (its pillar, or its reactive signal), a standout, or one of the week's own posts. */
type DrawnFrom = { kind: 'plan'; signalId: Id<'signals'> | undefined } | { kind: 'model'; standout: PlannerStandout } | WeeklyPost

/** The one thing a slot is drawn from, of the ones it was given: the week's own post first. */
function drawnOf(slot: {
  signalId: Id<'signals'> | undefined
  standout: PlannerStandout | undefined
  weeklyPost: WeeklyPost | undefined
}): DrawnFrom {
  if (slot.weeklyPost !== undefined) return slot.weeklyPost
  if (slot.standout !== undefined) return { kind: 'model', standout: slot.standout }
  return { kind: 'plan', signalId: slot.signalId }
}

/** The concept, pillar, signals and basis a post takes from what it is drawn from; anything but the plan replaces the slot's own concept. */
function drawnFields(
  drawn: DrawnFrom,
  day: Pick<PlannedDay, 'concept' | 'pillar'>
): Pick<PlannedPostInput, 'concept' | 'pillar' | 'signalIds' | 'basis'> {
  switch (drawn.kind) {
    case 'plan':
      return { concept: day.concept, pillar: day.pillar, signalIds: drawn.signalId === undefined ? [] : [drawn.signalId] }
    case 'model':
      return {
        concept: `Modeled on "${drawn.standout.thread.title}"`,
        pillar: drawn.standout.pillar,
        signalIds: [],
        basis: { kind: 'model', thread: drawn.standout.thread },
      }
    case 'roundup':
      return {
        concept: `Round-up: what people asked about ${drawn.pillar}`,
        pillar: drawn.pillar,
        signalIds: [],
        basis: drawn,
      }
    case 'rework':
      // It keeps the slot's pillar: the week's pillar shares stay as planned, whatever the original was about.
      return {
        concept: `From ${drawn.post.placeName}: ${drawn.post.title}`,
        pillar: day.pillar,
        signalIds: [],
        basis: drawn,
      }
  }
}

/** What a post drawn from what worked sets out to do: answer, tell or share, never ask or show. */
const DRAWN_INTENTS: readonly PostIntent[] = ['teach', 'inform', 'share']

/**
 * Whether a slot can hold the week's round-up or its reworked post: an
 * evergreen slot, room for several questions and answers or a whole point
 * (on X a thread, elsewhere any full post), an intent that answers, and a
 * platform where it fits; Hacker News places a post by what it sets out to
 * do, and has no place for either.
 */
function holdsDrawnPost(platform: Platform, shape: PostShape, evergreen: boolean): boolean {
  if (!evergreen) return false
  if (platform === 'hackernews') return false
  if (!DRAWN_INTENTS.includes(shape.intent)) return false
  if (platform === 'x') return shape.length === 'long'
  return shape.length !== 'short'
}

/**
 * A post model test's variant for one post, in turn (shared
 * `leastAssigned`): modeled only where the post can be (an evergreen slot,
 * with a standout left), else the other variant, so a week without
 * standouts never holds up the control.
 */
function modelTag(
  experiment: PostExperimentPlan,
  counts: Record<string, number>,
  canModel: boolean
): { experimentId: Id<'experiments'>; variantKey: string } {
  const turn = leastAssigned(experiment.keys, counts)
  const other = experiment.keys.find((key) => key !== MODELED_KEY)
  if (other === undefined) throw new Error(`post model experiment ${experiment.experimentId} has no variant besides ${MODELED_KEY}`)
  const variantKey = turn === MODELED_KEY && !canModel ? other : turn
  counts[variantKey] = (counts[variantKey] ?? 0) + 1
  return { experimentId: experiment.experimentId, variantKey }
}

/**
 * A posting time test's variant for each day of the week: a whole day's
 * posts move by one, so they keep their spacing, and the variants take the
 * days in turn, balanced by the posts each has. A day where any variant
 * would move a post into an hour already gone stays out of the test, so no
 * variant is left only the days that suit it. The test starts only where
 * every variant fits the day (shared `postingTimeFits`).
 */
function postingDays(
  experiment: PostExperimentPlan,
  slots: readonly { plannedFor: string; hour: number }[],
  timezone: string,
  now: number
): Map<string, { experimentId: Id<'experiments'>; variantKey: string } | null> {
  const counts = sumCounts(experiment.assigned.sponsored, experiment.assigned.plain)
  const days = new Map<string, { experimentId: Id<'experiments'>; variantKey: string } | null>()
  for (const day of new Set(slots.map((slot) => slot.plannedFor))) {
    const hours = slots.filter((slot) => slot.plannedFor === day).map((slot) => slot.hour)
    const ahead = experiment.keys.every((key) => hours.every((hour) => instantAt(day, hour + postingTimeOffset(key), timezone) > now))
    if (!ahead) {
      days.set(day, null)
      continue
    }
    const variantKey = leastAssigned(experiment.keys, counts)
    counts[variantKey] = (counts[variantKey] ?? 0) + hours.length
    days.set(day, { experimentId: experiment.experimentId, variantKey })
  }
  return days
}

/**
 * The running post experiment as the planner tags slots with it: its
 * dimension, its variants and the posts each already has, apart for the
 * ones that carry the sponsor and the ones that do not.
 */
export interface PostExperimentPlan {
  experimentId: Id<'experiments'>
  kind: PostExperimentKind
  keys: string[]
  assigned: { sponsored: Readonly<Record<string, number>>; plain: Readonly<Record<string, number>> }
}

/** A decided post kind (`to`) and the kind it beat (`from`): the winner takes the loser's turns in the cadence's rotation. */
export interface KindSwap {
  from: PostIntent
  to: PostIntent
}

/**
 * The kind a slot of the rotation is planned as: a decided post kind takes
 * the turns of the kind it beat, and a later decision on the winner passes
 * them on, so the rotation keeps its other kinds. `swaps` come oldest first;
 * a newer decision on the same kind wins.
 */
function kindInForce(intent: PostIntent, swaps: readonly KindSwap[]): PostIntent {
  const next = new Map(swaps.map((swap) => [swap.from, swap.to]))
  const seen = new Set<PostIntent>([intent])
  let current = intent
  for (let to = next.get(current); to !== undefined && !seen.has(to); to = next.get(current)) {
    seen.add(to)
    current = to
  }
  return current
}

/** The next variant in turn (shared `leastAssigned`), counted in `counts`. */
function nextVariant(
  experiment: PostExperimentPlan,
  counts: Record<string, number>
): { experimentId: Id<'experiments'>; variantKey: string } {
  const variantKey = leastAssigned(experiment.keys, counts)
  counts[variantKey] = (counts[variantKey] ?? 0) + 1
  return { experimentId: experiment.experimentId, variantKey }
}

function sumCounts(a: Readonly<Record<string, number>>, b: Readonly<Record<string, number>>): Record<string, number> {
  const sum: Record<string, number> = { ...a }
  for (const [key, count] of Object.entries(b)) sum[key] = (sum[key] ?? 0) + count
  return sum
}

/** A post kind's key as the intent it is; `startExperiment` takes only the cadence's intents, so another is a bug. */
export function postIntentOf(key: string): PostIntent {
  const intent = POST_INTENTS.find((candidate) => candidate === key)
  if (intent === undefined) throw new Error(`"${key}" is no post intent`)
  return intent
}

/** Why a Reddit or forum account plans no post: it posts only where the listener has met a community. */
export function noMetCommunity(platform: MetCommunityPlatform): string {
  const nouns = MET_COMMUNITY_NOUNS[platform]
  return `Influstep posts to ${PLATFORM_IN_WORDS[platform]} only in the ${nouns.many} the listener has met that removed none of your posts or replies, and there is none now. The writer plans two weeks once there is one.`
}

/** Why an account on a forum Influstep cannot read plans no post, ever (shared `postPlacingOf`). */
export function noReadableCommunity(forumName: string): string {
  return `Influstep cannot read the categories of ${forumName} or their rules, so it plans no post there. Post there yourself, and paste a thread to have a reply drafted.`
}

/**
 * Why the account plans no post (shared `postPlacingOf`), or null when it
 * can: the writer's plan, Plan this week and the account page read it, and
 * the account plans two weeks once a community ends the wait.
 */
export function planWaits(place: PlatformPlace, communities: readonly { removedAt?: number }[]): string | null {
  const placing = postPlacingOf(place)
  switch (placing.kind) {
    case 'anywhere':
      return null
    case 'nowhere':
      return noReadableCommunity(placing.forumName)
    case 'met':
      return activeCommunities(communities).length === 0 ? noMetCommunity(placing.platform) : null
  }
}

/** A community the account met, as the planner places posts in it: its rules' read on self-promotion, and its weight in the strategy. */
export interface PlannerCommunity {
  name: string
  selfPromotion: SelfPromotion
  weight: number
}

/**
 * The communities `count` posts go to on a platform that posts where the
 * listener met a community (shared `postsToMetCommunity`), shared out by the
 * communities' weights (each against their sum, as `allocatePillars` reads
 * them) and the posts each had since `since`. The account has met at least
 * one it takes part in (core/communities.ts `activeCommunities`).
 */
export function communitiesFor(
  communities: PlannerCommunity[],
  posts: Pick<Doc<'posts'>, 'community' | 'plannedFor'>[],
  count: number,
  since: string
): PlannerCommunity[] {
  if (communities.length === 0) throw new Error('no community was met to post in')
  const total = communities.reduce((sum, community) => sum + community.weight, 0)
  const counts: Record<string, number> = {}
  for (const post of posts) {
    if (post.community === undefined || post.plannedFor < since) continue
    counts[post.community] = (counts[post.community] ?? 0) + 1
  }
  const weights = communities.map((community) => ({
    pillar: community.name,
    weight: total > 0 ? community.weight / total : 1 / communities.length,
  }))
  return allocatePillars(weights, counts, count).map((name) => {
    const community = communities.find((candidate) => candidate.name === name)
    if (!community) throw new Error(`community ${name} was allocated but not met`)
    return community
  })
}

/** Where a post goes, and whether that place lets it name the sponsor (docs/plan.md, ground rule 3). */
interface Placement {
  community: string | null
  allowsSponsor: boolean
}

/**
 * Where a post of `intent` goes on its platform: on Hacker News by what it
 * sets out to do (shared `hackerNewsCommunity`), where only Show HN lets it
 * show the operator's own work; on Reddit in its subreddit and on a forum
 * in its category, as that community's rules allow; on X and LinkedIn
 * nowhere in particular.
 */
function placementOf(platform: Platform, intent: PostIntent, met: PlannerCommunity | null): Placement {
  if (platform === 'hackernews') {
    const community = hackerNewsCommunity(intent)
    return { community, allowsSponsor: community === 'Show HN' }
  }
  if (postsToMetCommunity(platform)) {
    if (met === null) throw new Error(`a ${platform} post needs a ${MET_COMMUNITY_NOUNS[platform].one}`)
    return { community: met.name, allowsSponsor: met.selfPromotion !== 'forbidden' }
  }
  return { community: null, allowsSponsor: true }
}

/**
 * Whether a slot may carry the sponsor: its place allows it, it is no
 * question (ground rule 5), and it is no one-liner, which has no room for
 * the affiliation line (ground rule 1).
 */
function mayCarrySponsor(shape: PostShape, place: Placement): boolean {
  return place.allowsSponsor && shape.intent !== 'ask' && shape.length !== 'short'
}

/**
 * Whether a post planned with the sponsor may still name it when it is
 * written: where it goes, as the listener last read the place's rules, may
 * have stopped allowing it since the plan (ground rule 3). On Reddit and on
 * a forum a community the account no longer knows allows nothing; elsewhere
 * the community met is not read.
 */
export function sponsorAllowed(platform: Platform, shape: PostShape, met: PlannerCommunity | undefined): boolean {
  if (postsToMetCommunity(platform) && met === undefined) return false
  return mayCarrySponsor(shape, placementOf(platform, shape.intent, met ?? null))
}

/**
 * Which slots carry the sponsor: about the dial's share of the slots past
 * the ramp, among the slots that may carry it. Shows first, since a show is
 * the operator's own work; the rest spread from the end of the week back,
 * away from the ramp, which covers the first slots.
 */
function sponsoredSlots(slots: { mayCarry: boolean; show: boolean }[], args: { dial: number; rampLeft: number }): Set<number> {
  const wanted = Math.round(Math.max(0, slots.length - args.rampLeft) * Math.min(1, Math.max(0, args.dial)))
  const eligible = slots.flatMap((slot, index) => (index >= args.rampLeft && slot.mayCarry ? [index] : []))
  const shows = eligible.filter((index) => slots[index]?.show === true)
  const others = eligible.filter((index) => slots[index]?.show !== true)
  const chosen = shows.slice(0, wanted)
  const left = Math.min(others.length, wanted - chosen.length)
  for (let pick = 0; pick < left; pick += 1) {
    const index = others[others.length - 1 - Math.floor((pick * others.length) / left)]
    if (index !== undefined) chosen.push(index)
  }
  return new Set(chosen)
}

/**
 * One post placed by itself, as "make a post" from a signal places it: where
 * it goes, and whether it carries the sponsor the operator asked for, by the
 * same rules as the week's plan. A show that cannot carry it is a share.
 */
export function placePost(args: {
  platform: Platform
  shape: PostShape
  sponsorWanted: boolean
  /** On Reddit and on a forum, the community it goes to (`communitiesFor`). */
  met: PlannerCommunity | null
}): { intent: PostIntent; community: string | null; sponsorSegment: SponsorSegment } {
  const place = placementOf(args.platform, args.shape.intent, args.met)
  const carries = args.sponsorWanted && mayCarrySponsor(args.shape, place)
  const intent = args.shape.intent === 'show' && !carries ? 'share' : args.shape.intent
  const community = args.platform === 'hackernews' ? hackerNewsCommunity(intent) : place.community
  return { intent, community, sponsorSegment: carries ? 'mention' : 'none' }
}

/**
 * What each new post slot sets out to do and how long it runs, in time
 * order (docs/plan.md, slice 5). Intents rotate through the cadence's and
 * carry on from the posts the account already has, across days and weeks.
 * On X, lengths come from the length mix (shared `pickLengths`) and the kind
 * follows the length: a long slot is a thread when the cadence has threads
 * and a full post when it does not, and one-liners and full posts rotate
 * through the cadence's other kinds; a cadence of threads alone makes every
 * slot a thread. A thread is X's: elsewhere every slot is a text post of a
 * full post's length, whatever an older cadence lists.
 */
function shapePostSlots(args: {
  platform: Platform
  cadence: XCadence
  lengthMix: LengthMix
  count: number
  /** The account's live posts, for the intent rotation. */
  postsSoFar: number
  /** The account's live single posts, for the kind rotation. */
  singlesSoFar: number
}): PostShape[] {
  const { intents, kinds } = args.cadence
  if (intents.length === 0) throw new Error('a cadence without post intents cannot plan posts')
  const intentAt = (index: number) => {
    const intent = intents[(args.postsSoFar + index) % intents.length]
    if (intent === undefined) throw new Error('intent rotation out of range')
    return intent
  }
  if (args.platform !== 'x')
    return Array.from({ length: args.count }, (_, index) => ({ intent: intentAt(index), length: 'medium', kind: 'text' }))
  const singles = kinds.filter((kind) => kind !== 'thread')
  const threads = kinds.includes('thread')
  let single = args.singlesSoFar
  return pickLengths(args.lengthMix, args.count).map((picked, index): PostShape => {
    const intent = intentAt(index)
    if (singles.length === 0 || (picked === 'long' && threads)) return { intent, length: 'long', kind: 'thread' }
    const rotated = singles[single % singles.length]
    if (rotated === undefined) throw new Error('kind rotation out of range')
    single += 1
    return { intent, length: picked === 'long' ? 'medium' : picked, kind: rotated }
  })
}

/** The pillar a signal's topics point at, either way round, else the first pillar. */
export function pillarFor(topics: readonly string[], pillars: readonly string[]): string {
  return matchedPillar(topics, pillars) ?? pillars[0] ?? ''
}

/** The pillar a signal's topics name, or null when they name none (a signal found by the account's niche alone). */
export function matchedPillar(topics: readonly string[], pillars: readonly string[]): string | null {
  const lowerTopics = topics.map((topic) => topic.toLowerCase())
  const match = pillars.find((pillar) =>
    lowerTopics.some((topic) => pillar.toLowerCase().includes(topic) || topic.includes(pillar.toLowerCase()))
  )
  return match ?? null
}
