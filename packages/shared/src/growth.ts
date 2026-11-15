import type { ExperimentKind } from './experiments'

/**
 * Growth (CONTEXT.md, "Consistency" and "Leak"): whether an account posts as
 * planned, and whether fewer of those its posts reach click through than
 * did, read so the operator and the strategy review know what moves users
 * next.
 */

/** A week asks the operator to post on schedule only once this many of its posts were due. */
export const CONSISTENCY_MIN_DUE = 3

/** The posts of a week due so far, and how many of them went out. */
export interface WeekPosting {
  due: number
  posted: number
}

/** Whether an account posted less than half of the posts due so far this week, once enough were due to say so. */
export function fellBehind(week: WeekPosting): boolean {
  return week.due >= CONSISTENCY_MIN_DUE && week.posted * 2 < week.due
}

/** Who an account's linked posts reached in a window, and how many of them clicked through. */
export interface ClickFlow {
  reached: number
  clicked: number
}

/** The least reach a window needs before its click rate says anything. */
export const CLICK_FLOOR = 1000

/** The clicks leak when their rate fell under this share of their rate in the window before. */
export const LEAK_RATIO = 0.6

/** No click at all though this many times the floor was reached leaks, whatever came before. */
export const DRY_FLOOR_TIMES = 3

/** A leak: the click rate now, and in the window before when that one said anything. */
export interface Leak {
  rate: number
  before: number | null
}

/**
 * The dimensions a test on a leak would move, and could be decided past
 * reach: how a post opens and ends is what moves who clicks.
 */
export const LEAK_DIMENSIONS: readonly ExperimentKind[] = ['hook', 'call_to_action']

/**
 * Whether the clicks leak, comparing the window with the one before: their
 * rate fell under LEAK_RATIO of what it was, both windows past CLICK_FLOOR;
 * or no one clicked though DRY_FLOOR_TIMES the floor was reached. Null when
 * they do not.
 */
export function clickLeak(current: ClickFlow, previous: ClickFlow): Leak | null {
  if (current.reached < CLICK_FLOOR) return null
  const rate = current.clicked / current.reached
  const before = previous.reached >= CLICK_FLOOR ? previous.clicked / previous.reached : null
  if (rate === 0 && current.reached >= CLICK_FLOOR * DRY_FLOOR_TIMES) return { rate, before }
  if (before === null || before === 0) return null
  return rate / before < LEAK_RATIO ? { rate, before } : null
}
