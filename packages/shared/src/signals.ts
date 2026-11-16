import { PLATFORM_KIND_LABELS, type Platform } from './platforms'

/** Where a signal comes from: a platform's search, the search suggestions, the comments under the account's posts, or its problem log. */
export const SIGNAL_SOURCES = [
  'hackernews',
  'reddit',
  'x',
  'linkedin',
  'forum',
  'search',
  'comments',
  'problems',
] as const satisfies readonly (Platform | 'search' | 'comments' | 'problems')[]
export type SignalSource = (typeof SIGNAL_SOURCES)[number]

export const SIGNAL_SOURCE_LABELS: Record<SignalSource, string> = {
  ...PLATFORM_KIND_LABELS,
  search: 'Search suggestions',
  comments: 'Comments',
  problems: 'Problem log',
}

export const SIGNAL_STATUSES = ['new', 'used', 'dismissed'] as const
export type SignalStatus = (typeof SIGNAL_STATUSES)[number]

/** Signals nobody used age out after this long. */
export const SIGNAL_TTL_MS = 14 * 24 * 60 * 60 * 1000

/** A signal's freshness halves every this many days. */
export const FRESHNESS_HALF_LIFE_DAYS = 2

/** Below this freshness a signal is cold: a post built on it gets swapped before it is written. */
export const COLD_FRESHNESS = 25

/** A cold post is swapped only for a signal at least this fresh; anything weaker is not worth the change. */
export const SWAP_MIN_FRESHNESS = 60

const DAY_MS = 86_400_000

/**
 * What a thread usually scores where it was posted (its reach plus twice its
 * comments, core research `signalOf`): a forum topic draws a few likes, a
 * Reddit thread dozens of upvotes. A thread that scores this counts 50 of
 * 100 (`signalWeight`). Read from the live forums: their topics' median is 6.
 * A search suggestion, a comment and a problem are scored from 0 to 100
 * already (null).
 */
const USUAL_SCORE: Record<SignalSource, number | null> = {
  forum: 6,
  hackernews: 30,
  linkedin: 30,
  reddit: 50,
  x: 50,
  search: null,
  comments: null,
  problems: null,
}

/**
 * A signal's score from 0 to 100 on every source, so that signals from
 * different places rank against each other: a thread's score against what
 * is usual where it was posted, rising toward 100 however far it moved.
 */
function signalWeight(signal: { source: SignalSource; score: number }): number {
  const usual = USUAL_SCORE[signal.source]
  if (usual === null) return signal.score
  return (100 * signal.score) / (signal.score + usual)
}

/**
 * How much a signal still matters at `now`: its weight (`signalWeight`),
 * halved for every FRESHNESS_HALF_LIFE_DAYS since it was published. A source
 * that does not say when an item was published is dated by when the
 * researcher found it. A problem from the problem log does not go cold:
 * readers keep asking it until the operator marks it resolved, so it waits
 * for its post however long that takes.
 */
export function signalFreshness(
  signal: { source: SignalSource; status: SignalStatus; score: number; publishedAt?: number; foundAt: number },
  now: number
): number {
  if (isOpenProblem(signal)) return signal.score
  const publishedAt = signal.publishedAt === undefined ? signal.foundAt : signal.publishedAt
  const ageDays = Math.max(0, now - publishedAt) / DAY_MS
  return Math.round(signalWeight(signal) * 0.5 ** (ageDays / FRESHNESS_HALF_LIFE_DAYS))
}

/** A problem from the problem log no post drew on yet and the operator did not resolve, which dismisses it (core/memory.ts). */
export function isOpenProblem(signal: { source: SignalSource; status: SignalStatus }): boolean {
  return signal.source === 'problems' && signal.status === 'new'
}

/** Whether a signal older than SIGNAL_TTL_MS goes: one no post used, unless it is an open problem, which waits for its post. */
export function signalAgesOut(signal: { source: SignalSource; status: SignalStatus }): boolean {
  return signal.status !== 'used' && !isOpenProblem(signal)
}

export function isCold(freshness: number): boolean {
  return freshness < COLD_FRESHNESS
}
