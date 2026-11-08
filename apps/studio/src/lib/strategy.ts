import { STRATEGY_REVIEW_SLOT, WEEKDAYS, type JournalActor } from '@influstep/shared'

/** Who made a journal entry or wrote a memory entry, as its meta line says it. */
export const ACTOR_WORDS: Record<JournalActor, string> = {
  analyst: 'by the analyst',
  researcher: 'by the researcher',
  operator: 'by you',
}

/**
 * The review's day as Date#getUTCDay counts it, Sunday first. WEEKDAYS starts
 * on Monday, so its index moves one day on.
 */
const REVIEW_UTC_DAY = (WEEKDAYS.indexOf(STRATEGY_REVIEW_SLOT.dayOfWeek) + 1) % 7

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

/**
 * The next weekly strategy review after `now`, as an instant, from the slot
 * the cron schedules it at (shared STRATEGY_REVIEW_SLOT). A review due at this
 * very moment counts as gone, so the line never promises one that already
 * started.
 */
export function nextReviewAt(now: number): number {
  const today = new Date(now)
  const daysAhead = (REVIEW_UTC_DAY - today.getUTCDay() + 7) % 7
  const slot = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate() + daysAhead,
    STRATEGY_REVIEW_SLOT.hourUTC,
    STRATEGY_REVIEW_SLOT.minuteUTC
  )
  return slot > now ? slot : slot + WEEK_MS
}

/**
 * Shares as whole percents that add up to 100: each rounded down, then the
 * points left over go to the largest remainders, ties to the earlier share.
 * Rounding each share on its own can show three equal pillars as 33% each.
 */
export function wholePercents(shares: readonly number[]): number[] {
  const total = shares.reduce((sum, share) => sum + share, 0)
  if (total === 0) return shares.map(() => 0)
  const exact = shares.map((share) => (share / total) * 100)
  const floors = exact.map(Math.floor)
  let left = 100 - floors.reduce((sum, value) => sum + value, 0)
  const order = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index)
  const out = [...floors]
  for (const { index } of order) {
    if (left <= 0) break
    out[index] = (out[index] ?? 0) + 1
    left -= 1
  }
  return out
}
