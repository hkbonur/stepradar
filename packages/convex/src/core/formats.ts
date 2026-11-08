import {
  CADENCE_POSTS_MAX,
  CADENCE_POSTS_MIN,
  POST_KIND_LABELS,
  REPLIES_PER_DAY_MAX,
  REPLIES_PER_DAY_MIN,
  type PlatformFormat,
  type PostKind,
  type XCadence,
  PLATFORM_POST_KINDS,
  PLATFORM_KIND_LABELS,
} from '@influstep/shared'
import type { Doc } from '../_generated/dataModel'
import { refusal } from '../lib/errors'

/**
 * An account takes part on one platform (CONTEXT.md, "Account"), with the
 * hour its posts start at and its cadence on the account itself.
 */

type CadenceOwner = Pick<Doc<'accounts'>, 'cadence'>

/** The account's daily reply budget. */
export function replyBudget(account: CadenceOwner): number {
  return account.cadence.repliesPerDay
}

/** Whether the account listens at all: a reply budget above zero. */
export function listens(account: CadenceOwner): boolean {
  return replyBudget(account) > 0
}

/**
 * What accounts.create and update accept: a posting hour in range, and a
 * cadence with each post kind and each post intent at most once and neither
 * list empty, and a reply budget in range.
 */
export function assertFormat(format: PlatformFormat): void {
  const label = PLATFORM_KIND_LABELS[format.platform]
  if (!Number.isInteger(format.publishHour) || format.publishHour < 0 || format.publishHour > 23) {
    throw refusal(`${label}: the posting hour is 0 to 23.`)
  }
  assertCadence(label, format.cadence)
  const thread = format.cadence.kinds.find((kind) => !PLATFORM_POST_KINDS[format.platform].includes(kind))
  if (thread !== undefined) throw refusal(`${label}: takes no ${POST_KIND_LABELS[thread].toLowerCase()}; a post there is one part.`)
}

function assertCadence(label: string, cadence: XCadence): void {
  const { postsPerDay, kinds, intents, repliesPerDay } = cadence
  if (!Number.isInteger(postsPerDay) || postsPerDay < CADENCE_POSTS_MIN || postsPerDay > CADENCE_POSTS_MAX) {
    throw refusal(`${label}: posts per day is ${CADENCE_POSTS_MIN} to ${CADENCE_POSTS_MAX}.`)
  }
  if (kinds.length === 0) throw refusal(`${label}: pick at least one post kind.`)
  const picked = new Set<PostKind>()
  for (const kind of kinds) {
    if (picked.has(kind)) throw refusal(`${label}: ${POST_KIND_LABELS[kind]} is picked twice.`)
    picked.add(kind)
  }
  // The planner rotates through the intents in order, so a repeated one would only skew the mix.
  if (intents.length === 0) throw refusal(`${label}: pick at least one post intent.`)
  if (new Set(intents).size !== intents.length) throw refusal(`${label}: each post intent once.`)
  if (!Number.isInteger(repliesPerDay) || repliesPerDay < REPLIES_PER_DAY_MIN || repliesPerDay > REPLIES_PER_DAY_MAX) {
    throw refusal(`${label}: replies per day is ${REPLIES_PER_DAY_MIN} to ${REPLIES_PER_DAY_MAX}.`)
  }
}
