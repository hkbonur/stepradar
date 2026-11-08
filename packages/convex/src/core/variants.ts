import { effectiveVariant, postingTimeOffset, type ExperimentKind } from '@influstep/shared'
import type { Doc, Id } from '../_generated/dataModel'
import type { QueryCtx } from '../_generated/server'
import type { BriefVariant } from '../providers/llm/types'
import { hourAt } from './dates'

/**
 * The variants a reply or a post carries (CONTEXT.md, "Variant"): the one an
 * experiment gave it, and what it does on a dimension once the account's
 * defaults are read too.
 */

type Reader = { db: QueryCtx['db'] }

/** A reply or a post that may carry an experiment's variant. */
type Tagged = { _id: Id<'replies'> | Id<'posts'>; experimentId?: Id<'experiments'>; variantKey?: string }

/** Loads experiments by id, each once: the replies and posts of one experiment name it again and again. */
export function experimentLoader(ctx: Reader): (experimentId: Id<'experiments'>) => Promise<Doc<'experiments'> | null> {
  const loaded = new Map<Id<'experiments'>, Doc<'experiments'> | null>()
  return async (experimentId) => {
    const known = loaded.get(experimentId)
    if (known !== undefined) return known
    const experiment = await ctx.db.get(experimentId)
    loaded.set(experimentId, experiment)
    return experiment
  }
}

/** The variant a reply or a post carries, with the dimension its experiment varies, as shared `effectiveVariant` reads it. */
export type TaggedVariant = Doc<'experiments'>['variants'][number] & { kind: ExperimentKind }

/**
 * The variant a reply or a post carries; none when it is in no experiment. A
 * key its experiment does not have is a bug, never a reason to treat it as if
 * it carried no variant.
 */
export function taggedVariant(row: Pick<Tagged, '_id' | 'variantKey'>, experiment: Doc<'experiments'> | null): TaggedVariant | undefined {
  if (row.variantKey === undefined) return undefined
  if (!experiment) throw new Error(`${row._id} carries variant "${row.variantKey}" but no experiment`)
  const variant = experiment.variants.find((candidate) => candidate.key === row.variantKey)
  if (!variant) throw new Error(`${row._id} carries variant "${row.variantKey}", which experiment ${experiment._id} does not have`)
  return { ...variant, kind: experiment.kind }
}

/**
 * What a reply or a post does on each dimension the writer follows: shared
 * `effectiveVariant` over its experiment's variant and the account's
 * defaults, the experiment read once.
 */
export async function variantsOf(
  ctx: Reader,
  row: Tagged,
  account: Pick<Doc<'accounts'>, 'strategy'>
): Promise<(kind: ExperimentKind) => BriefVariant> {
  const experiment = row.experimentId === undefined ? null : await ctx.db.get(row.experimentId)
  const variant = taggedVariant(row, experiment)
  return (kind) => {
    const { key, label, description } = effectiveVariant(kind, { variant }, account.strategy?.defaults)
    return { key, label, description }
  }
}

/** The posting time variant a post carries, or null: a posting time test moved its whole day by the variant's offset (core/planner.ts). */
export async function postingTimeOf(ctx: Reader, post: Doc<'posts'>): Promise<string | null> {
  const experiment = post.experimentId === undefined ? null : await ctx.db.get(post.experimentId)
  const variant = taggedVariant(post, experiment)
  return variant?.kind === 'posting_time' ? variant.key : null
}

/** A planned post's slot hour: its hour less what its posting time variant moved it by. */
export function slotHourOf(post: Pick<Doc<'posts'>, 'scheduledAt'>, postingTime: string | null, timezone: string): number {
  return hourAt(post.scheduledAt, timezone) - (postingTime === null ? 0 : postingTimeOffset(postingTime))
}
