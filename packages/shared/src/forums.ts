import type { Platform } from './platforms'

/**
 * Forums (CONTEXT.md, "Forum"): a product's community forum, such as the n8n
 * Community, where a forum account is the operator's username. A forum that
 * runs on Discourse is read through its public JSON, with no key; any other
 * forum software runs by hand, like LinkedIn: the operator pastes a thread's
 * link and the link to what they posted.
 */

/** What runs a forum, as the setup finds it: Discourse, which a reader reads, or other software, read by hand. */
export const FORUM_SOFTWARE = ['discourse', 'other'] as const
export type ForumSoftware = (typeof FORUM_SOFTWARE)[number]

/** The forum a forum account takes part on: its https origin, its name as the forum gives it, and what runs it. */
export interface Forum {
  origin: string
  name: string
  software: ForumSoftware
}

/** A forum's address as the operator typed it: its https origin, or why it names none. */
export type ForumAddress = { kind: 'origin'; origin: string } | { kind: 'invalid'; problem: string }

const NO_FORUM = 'Give the forum’s address, such as community.n8n.io.'

/**
 * The forum's origin from any of its addresses the operator types or pastes
 * (community.n8n.io, or a page of it): only its https origin is kept. A
 * forum is read over https, by its name, never on a port or an IP address.
 */
export function forumAddress(typed: string): ForumAddress {
  const text = typed.trim()
  if (text === '') return { kind: 'invalid', problem: NO_FORUM }
  let url: URL
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`)
  } catch {
    return { kind: 'invalid', problem: NO_FORUM }
  }
  if (url.protocol !== 'https:') return { kind: 'invalid', problem: 'Influstep reads a forum over https only.' }
  if (url.port !== '' || url.username !== '' || !/\.[a-z]{2,}$/i.test(url.hostname)) return { kind: 'invalid', problem: NO_FORUM }
  return { kind: 'origin', origin: url.origin }
}

/** A forum's host, as a referring domain and a link's utm_medium name it: community.n8n.io. */
export function forumHost(forum: Pick<Forum, 'origin'>): string {
  return new URL(forum.origin).host
}

/**
 * A Discourse item as Influstep names it, from what its links say: a topic
 * by its id, which is its first post, and a reply by the topic's id and the
 * reply's number in it ("296315/4"). A reply answers the item its number
 * points at, or the topic.
 */
export function discourseItemId(topicId: number, postNumber: number): string {
  return postNumber === 1 ? String(topicId) : `${topicId}/${postNumber}`
}

/** A Discourse item's topic and number in it, from its id (`discourseItemId`); null for an id that is none. */
export function discourseItemOf(externalId: string): { topicId: number; postNumber: number } | null {
  const match = /^(\d+)(?:\/(\d+))?$/.exec(externalId)
  if (!match?.[1]) return null
  return { topicId: Number(match[1]), postNumber: match[2] === undefined ? 1 : Number(match[2]) }
}

/**
 * Whether two items are in one thread on the platform: on a forum, in one
 * topic, since Discourse keeps whichever post the operator clicked Reply
 * under, not what they answer; elsewhere an item is only itself.
 */
export function sameThread(platform: Platform, a: string, b: string): boolean {
  if (a === b) return true
  if (platform !== 'forum') return false
  const topic = discourseItemOf(a)?.topicId
  return topic !== undefined && topic === discourseItemOf(b)?.topicId
}
