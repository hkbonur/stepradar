import {
  PLATFORM_DRAFT_SHAPES,
  SELF_PROMOTION_LABELS,
  pointsProblems,
  communityLabel,
  namesSponsor,
  type Platform,
  type SelfPromotion,
} from '@influstep/shared'

/**
 * The ground rules (docs/plan.md) a reply draft is checked against before it
 * waits for the operator; a draft that breaks one is written once more with
 * the problems named, then passed on with the reason. The code checks what
 * it can see: 1, a draft naming the sponsor says the affiliation line as
 * written; 3, never the sponsor in a community whose rules forbid
 * self-promotion; 4, the sponsor dial caps the share of the week's posted
 * replies that name it; 6, the draft has its platform's shape. Rules 2 (no
 * borrowed experience) and 5 (a pain-point post asks openly) are about what
 * a draft means, so the writer's prompt carries them; 5 is about posts
 * (slice 8).
 */

/** How far back the sponsor dial counts the posted replies. */
export const DISCLOSURE_WINDOW_MS = 7 * 24 * 3_600_000

export interface DisclosureContext {
  platform: Platform
  sponsorName: string
  affiliationLine: string
  /** The thread's community, as the listener read its rules; null where it has none, or none was read. */
  community: { name: string; selfPromotion: SelfPromotion } | null
  /**
   * The account's replies posted within DISCLOSURE_WINDOW_MS, and how many of
   * them named the sponsor; a draft counts as posted from the moment it is
   * written, since the operator may post it.
   */
  week: { posted: number; named: number }
  sponsorDial: number
  /** The operator asked for this reply: the dial and the sponsor mention in force leave it to them, the other rules hold. */
  operatorAsked: boolean
  /** The sponsor mention in force for the reply (shared EXPERIMENT_CATALOG.sponsor_mention): `never` names the sponsor in no reply. */
  sponsorMention: string
}

/**
 * Whether a draft may name the sponsor here at all: the community does not
 * forbid it, and the operator asked, or the sponsor mention in force allows
 * it and the dial has room.
 */
export function mayNameSponsor(context: DisclosureContext): boolean {
  if (context.community?.selfPromotion === 'forbidden') return false
  if (context.operatorAsked) return true
  if (context.sponsorMention === 'never') return false
  return dialHasRoom(context)
}

/** One more reply naming the sponsor keeps the week's share within the dial. */
function dialHasRoom(context: DisclosureContext): boolean {
  return (context.week.named + 1) / (context.week.posted + 1) <= context.sponsorDial
}

/** What in a draft breaks the ground rules, in the words the writer is asked again with and the operator reads. */
export function disclosureProblems(text: string, context: DisclosureContext): string[] {
  const problems = shapeProblems(text, context.platform)
  if (!namesSponsor(text, context.sponsorName)) return problems
  problems.push(...affiliationProblems(text, 'reply', context))
  if (context.community?.selfPromotion === 'forbidden') {
    const where = communityLabel(context.platform, context.community.name)
    problems.push(`Leave ${context.sponsorName} out: ${where} says ${SELF_PROMOTION_LABELS.forbidden.toLowerCase()}.`)
  } else if (!context.operatorAsked && !dialHasRoom(context)) {
    problems.push(
      `Leave ${context.sponsorName} out: ${context.week.named} of the ${context.week.posted} replies this week, posted or waiting for you, named it, and the dial allows ${Math.round(context.sponsorDial * 100)}%.`
    )
  }
  return problems
}

/** Rule 6 beyond the length: a Hacker News draft is talking points (shared `pointsProblems`). */
function shapeProblems(text: string, platform: Platform): string[] {
  return PLATFORM_DRAFT_SHAPES[platform] === 'points' ? pointsProblems(text) : []
}

/**
 * The ground rules on a post draft: one planned to carry the sponsor says
 * the affiliation line as written when it names it (rule 1); one planned
 * without it, a question among them (rule 5), leaves the sponsor out.
 */
export function postDisclosureProblems(text: string, post: { sponsorName: string; affiliationLine: string; sponsored: boolean }): string[] {
  if (!namesSponsor(text, post.sponsorName)) return []
  if (!post.sponsored) return [`Leave ${post.sponsorName} out of this post.`]
  return affiliationProblems(text, 'post', post)
}

/**
 * Rule 1: a draft that names the sponsor says the affiliation line as
 * written. Saving an account checks its line (core `assertAffiliation`); an
 * empty one would let every draft through, so it is a bug.
 */
function affiliationProblems(text: string, what: 'reply' | 'post', context: { sponsorName: string; affiliationLine: string }): string[] {
  const line = context.affiliationLine.trim()
  if (line === '') throw new Error('the account has no affiliation line')
  return text.includes(line) ? [] : [`A ${what} that names ${context.sponsorName} says "${line}" as written.`]
}
