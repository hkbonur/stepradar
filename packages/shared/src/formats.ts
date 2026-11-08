import type { PostKind } from './post-kinds'
import { POST_INTENTS, type PostIntent } from './post-mix'
import type { Platform } from './platforms'
import { REPLIES_PER_DAY_DEFAULT } from './replies'

/**
 * How often an X account posts, which kinds of post it writes, which intents
 * the planner rotates through, and how many replies it drafts a day.
 */
export interface XCadence {
  /** Posts a day, CADENCE_POSTS_MIN to CADENCE_POSTS_MAX, three hours apart from the publish hour. */
  postsPerDay: number
  /** Each kind at most once, never empty. */
  kinds: PostKind[]
  /** Each intent at most once, never empty. */
  intents: PostIntent[]
  /** The daily reply budget, REPLIES_PER_DAY_MIN to REPLIES_PER_DAY_MAX (shared replies.ts); zero turns listening off. */
  repliesPerDay: number
}

export const CADENCE_POSTS_MIN = 1
export const CADENCE_POSTS_MAX = 4

/** How an account takes part on its one platform: the local hour its posts start at, and its cadence. */
export interface PlatformFormat {
  platform: Platform
  /** Local hour (0 to 23) the day's first post is due. */
  publishHour: number
  cadence: XCadence
}

/**
 * What a new account starts from; the operator edits each one. A thread is
 * X's, so the other platforms start with text posts only, one a day.
 */
export const DEFAULT_FORMATS: Record<Platform, PlatformFormat> = {
  // Most subreddits forbid showing your own product, so a Reddit account starts without shows.
  reddit: {
    platform: 'reddit',
    publishHour: 15,
    cadence: {
      postsPerDay: 1,
      kinds: ['text'],
      intents: POST_INTENTS.filter((intent) => intent !== 'show'),
      repliesPerDay: REPLIES_PER_DAY_DEFAULT,
    },
  },
  hackernews: {
    platform: 'hackernews',
    publishHour: 15,
    cadence: { postsPerDay: 1, kinds: ['text'], intents: [...POST_INTENTS], repliesPerDay: REPLIES_PER_DAY_DEFAULT },
  },
  x: {
    platform: 'x',
    publishHour: 15,
    cadence: { postsPerDay: 2, kinds: ['text', 'thread'], intents: [...POST_INTENTS], repliesPerDay: REPLIES_PER_DAY_DEFAULT },
  },
  linkedin: {
    platform: 'linkedin',
    publishHour: 15,
    cadence: { postsPerDay: 1, kinds: ['text'], intents: [...POST_INTENTS], repliesPerDay: REPLIES_PER_DAY_DEFAULT },
  },
  // A product's forum is mostly questions and answers, and its moderators remove ads, so a forum account starts without shows.
  forum: {
    platform: 'forum',
    publishHour: 15,
    cadence: {
      postsPerDay: 1,
      kinds: ['text'],
      intents: POST_INTENTS.filter((intent) => intent !== 'show'),
      repliesPerDay: REPLIES_PER_DAY_DEFAULT,
    },
  },
}
