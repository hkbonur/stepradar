import type { ExperimentKind } from './experiments'

/**
 * Growth (CONTEXT.md, "Consistency" and "Leak"): whether an account posts as
 * planned, and where its funnel lets fewer through than it did, read so the
 * operator and the strategy review know what moves users next.
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

/** The steps of the funnel a leak is read at: who was reached clicked, who clicked signed up, who signed up paid. */
export const FUNNEL_STEPS = ['click', 'signup', 'paid'] as const
export type FunnelStep = (typeof FUNNEL_STEPS)[number]

/** What came to a step in a window and what went through it; null where the platform does not count it. */
export interface StepFlow {
  from: number
  to: number
}

/** A window's flow through each step. */
export type StepFlows = Record<FunnelStep, StepFlow | null>

/** The least that must come to a step in a window before its rate says anything. */
export const STEP_FLOORS: Record<FunnelStep, number> = { click: 1000, signup: 30, paid: 10 }

/** A step leaks when its rate fell under this share of its rate in the window before. */
export const LEAK_RATIO = 0.6

/** A step that let nothing through though this many times its floor came to it leaks, whatever came before. */
export const DRY_FLOOR_TIMES = 3

/** Where a funnel leaks: the step, its rate now, and its rate in the window before when that one said anything. */
export interface Leak {
  step: FunnelStep
  rate: number
  before: number | null
}

/**
 * The dimensions a test on each step would move, and could be decided on a
 * rung past reach. Only who clicks is the posts' doing, and how a post opens
 * and ends is what moves it; who signs up after a click, and who pays after
 * signing up, is the product's page and the product.
 */
export const LEAK_DIMENSIONS: Record<FunnelStep, readonly ExperimentKind[]> = {
  click: ['hook', 'call_to_action'],
  signup: [],
  paid: [],
}

/**
 * Where a funnel leaks most, comparing the window with the one before: the
 * step whose rate fell furthest, under LEAK_RATIO of what it was, both
 * windows past the step's floor; or a step that let nothing through though
 * DRY_FLOOR_TIMES its floor came to it, which leaks most of all. Null when no
 * step leaks.
 */
export function funnelLeak(current: StepFlows, previous: StepFlows): Leak | null {
  let worst: { leak: Leak; ratio: number } | null = null
  for (const step of FUNNEL_STEPS) {
    const now = current[step]
    if (now === null || now.from < STEP_FLOORS[step]) continue
    const rate = now.to / now.from
    const was = previous[step]
    const before = was !== null && was.from >= STEP_FLOORS[step] ? was.to / was.from : null
    const ratio = leakRatio(rate, before, now.from >= STEP_FLOORS[step] * DRY_FLOOR_TIMES)
    if (ratio === null) continue
    if (worst === null || ratio < worst.ratio) worst = { leak: { step, rate, before }, ratio }
  }
  return worst === null ? null : worst.leak
}

/** How far a step's rate fell: 0 for a dry step, its share of the rate before under LEAK_RATIO, else null. */
function leakRatio(rate: number, before: number | null, dryCounts: boolean): number | null {
  if (rate === 0 && dryCounts) return 0
  if (before === null || before === 0) return null
  const ratio = rate / before
  return ratio < LEAK_RATIO ? ratio : null
}
