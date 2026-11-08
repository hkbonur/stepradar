import type { PostKind } from './post-kinds'
import { xLength } from './posts'

/**
 * Posts vary on purpose (docs/plan.md, slice 5): every post has an intent and
 * a length, and the planner mixes both across the week so an X feed reads
 * like a person and not a schedule. The planner, the writer and the studio
 * read the lists and the length rule from here.
 */

export const POST_INTENTS = ['ask', 'inform', 'share', 'teach', 'show'] as const
export type PostIntent = (typeof POST_INTENTS)[number]

export const POST_INTENT_LABELS: Record<PostIntent, string> = {
  ask: 'Ask',
  inform: 'Inform',
  share: 'Share',
  teach: 'Teach',
  show: 'Show',
}

/** One line per intent, put in front of the writer. */
export const POST_INTENT_BRIEFS: Record<PostIntent, string> = {
  // Ground rule 5 (docs/plan.md): a question about a problem is asked openly, never a planted pitch.
  ask: 'Ask readers, openly, how they handle a problem they have: a real question that invites replies, never a quiz, and never a pitch for the sponsor.',
  inform: 'Tell the reader a fact or a change in the niche and why it matters.',
  share: 'Share something you found (a tool, a post, a number) and what you think of it.',
  teach: 'Teach a how-to the reader can do today, in steps.',
  show: 'Show something you built, the sponsor among it: what it does, why you built it, and what you want to hear back.',
}

export const POST_LENGTHS = ['short', 'medium', 'long'] as const
export type PostLength = (typeof POST_LENGTHS)[number]

export const POST_LENGTH_LABELS: Record<PostLength, string> = {
  short: 'One-liner',
  medium: 'Post',
  long: 'Thread',
}

/** The longest one-liner, counted the way X counts (xLength). */
export const SHORT_POST_MAX = 100

/** The share of each length in a feed, as numbers that sum to 1. */
export type LengthMix = Record<PostLength, number>

/** The mix an account without a learned voice plans from. */
export const DEFAULT_LENGTH_MIX: LengthMix = { short: 0.3, medium: 0.5, long: 0.2 }

/**
 * How long a written post is: more than one part is a thread, one part of at
 * most SHORT_POST_MAX is a one-liner, anything else is a full post. A post
 * always has a part, so an empty list is a bug.
 */
export function postLengthOf(parts: string[]): PostLength {
  const [first, ...rest] = parts
  if (first === undefined) throw new Error('a post has at least one part')
  if (rest.length > 0) return 'long'
  return xLength(first) <= SHORT_POST_MAX ? 'short' : 'medium'
}

/**
 * Whether a post of this kind can have this length: a thread is always long,
 * a text post never is. Null when it fits.
 */
export function lengthKindProblem(kind: PostKind, length: PostLength): string | null {
  if (kind === 'thread') return length === 'long' ? null : 'A thread is always long.'
  return length === 'long' ? 'A text post is short or medium, never long.' : null
}

/**
 * The lengths of `count` post slots, drawn from `mix`. Deterministic: each
 * length gets the whole part of its share of the slots, the slots left go to
 * the largest remainders (ties in POST_LENGTHS order), and the slots are then
 * ordered so two equal lengths never sit side by side when another length is
 * left to put between them.
 */
export function pickLengths(mix: LengthMix, count: number): PostLength[] {
  if (!Number.isInteger(count) || count < 0) throw new Error(`cannot pick lengths for ${count} slots`)
  for (const length of POST_LENGTHS) {
    const share = mix[length]
    if (!Number.isFinite(share) || share < 0) throw new Error(`the ${length} share of a length mix is ${share}`)
  }
  const total = mix.short + mix.medium + mix.long
  if (total <= 0) throw new Error('a length mix needs at least one share above zero')

  const quota = (length: PostLength) => (mix[length] / total) * count
  const counts: Record<PostLength, number> = {
    short: Math.floor(quota('short')),
    medium: Math.floor(quota('medium')),
    long: Math.floor(quota('long')),
  }
  let left = count - counts.short - counts.medium - counts.long
  // Array.prototype.sort is stable, so equal remainders keep POST_LENGTHS order.
  const byRemainder = [...POST_LENGTHS].sort((a, b) => quota(b) - counts[b] - (quota(a) - counts[a]))
  for (const length of byRemainder) {
    if (left === 0) break
    counts[length] += 1
    left -= 1
  }

  // Greedy: the length with the most slots left that differs from the last one placed. Only when the last
  // length is all that is left does it repeat.
  const out: PostLength[] = []
  for (let slot = 0; slot < count; slot += 1) {
    const previous = out.at(-1)
    const ranked = POST_LENGTHS.filter((length) => counts[length] > 0).sort((a, b) => counts[b] - counts[a])
    const pick = ranked.find((length) => length !== previous) ?? ranked[0]
    if (pick === undefined) throw new Error('pickLengths ran out of slots to place')
    out.push(pick)
    counts[pick] -= 1
  }
  return out
}
