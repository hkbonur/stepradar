import { catalogControl, type ExperimentKind } from './experiments'
import type { Weekday } from './chat'

/**
 * An account's strategy (docs/plan.md, v0.2 item 8): what it does by default on
 * each experiment dimension, the journal of every change the strategy review
 * or the operator made, and the learnings the writer reads.
 */

/**
 * What the account does on one dimension since an experiment decided it: the
 * winning variant, and the experiment it came from. A dimension with no
 * default does what the catalog's control says.
 */
export interface StrategyDefault {
  kind: ExperimentKind
  key: string
  label: string
  description: string
  experimentId?: string
  /** When it became the default. */
  since: number
}

/**
 * When the weekly strategy review runs, in UTC: Mondays at 06:30, half an
 * hour before the week is planned, so the plan follows the fresh strategy.
 * The cron schedules it from here and the studio's "next review" line reads it.
 */
export const STRATEGY_REVIEW_SLOT = { dayOfWeek: 'monday', hourUTC: 6, minuteUTC: 30 } as const satisfies {
  dayOfWeek: Weekday
  hourUTC: number
  minuteUTC: number
}

export const JOURNAL_KINDS = [
  'pillar_weights',
  'community_weights',
  'experiment_started',
  'experiment_decided',
  'experiment_stopped',
  'concept_swapped',
] as const
export type JournalKind = (typeof JOURNAL_KINDS)[number]

export const JOURNAL_KIND_LABELS: Record<JournalKind, string> = {
  pillar_weights: 'Pillar weights',
  community_weights: 'Community weights',
  experiment_started: 'Experiment started',
  experiment_decided: 'Experiment decided',
  experiment_stopped: 'Experiment stopped',
  concept_swapped: 'Concept swapped',
}

/**
 * Who made a change: the account's analyst on its own, its researcher (a
 * last check that swapped a cold concept), or the operator. Also who set an
 * experiment up, and who wrote a memory entry.
 */
export const JOURNAL_ACTORS = ['analyst', 'researcher', 'operator'] as const
export type JournalActor = (typeof JOURNAL_ACTORS)[number]

/** How long a morning brief stays the one the writer reads: a day, plus slack for the cron. */
export const BRIEF_TTL_MS = 26 * 3_600_000

/** The score a problem's candidate signal carries: above almost anything a source finds, since the account met it itself. */
export const PROBLEM_SCORE = 95

/** How many comments must ask the same question before it is a problem. */
export const PROBLEM_REPEAT_MIN = 3

/** How far back the problem log reads comments. */
export const PROBLEM_WINDOW_DAYS = 14

/** What a reply does on one dimension, and whether that is what the account did before it tested anything. */
export interface EffectiveVariant {
  kind: ExperimentKind
  key: string
  label: string
  description: string
  isControl: boolean
}

/** A reply as the style rules read it: the variant it carries, with the dimension its experiment varies. */
export interface StyledReply {
  variant?: { kind: ExperimentKind; key: string; label: string; description: string }
}

function resolved(kind: ExperimentKind, variant: Omit<EffectiveVariant, 'kind' | 'isControl'>): EffectiveVariant {
  return {
    kind,
    key: variant.key,
    label: variant.label,
    description: variant.description,
    isControl: variant.key === catalogControl(kind).key,
  }
}

/**
 * The one rule for what a reply does on a dimension: its own variant when
 * its experiment varies that dimension, else the account's default for it,
 * else the catalog's control.
 */
export function effectiveVariant(
  kind: ExperimentKind,
  reply: StyledReply,
  defaults: readonly StrategyDefault[] | undefined
): EffectiveVariant {
  if (reply.variant && reply.variant.kind === kind) return resolved(kind, reply.variant)
  const inForce = defaults?.find((entry) => entry.kind === kind)
  if (inForce) return resolved(kind, inForce)
  return resolved(kind, catalogControl(kind))
}
