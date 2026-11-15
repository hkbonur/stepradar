import type { PostKind } from './post-kinds'
import { POST_INTENTS, type PostIntent } from './post-mix'
import type { Platform } from './platforms'
import { REPLIES_PER_DAY_DEFAULT } from './replies'

/**
 * How often an X account posts, which kinds of post it writes, which intents
 * the planner rotates through, and how many replies it drafts a day.
 */
export interface XCadence {
  /** The days a week that carry posts, 0 to 7, on the weekdays `POST_WEEKDAYS` names; 0 is an account that only drafts replies. */
  postDays: number
  /** Posts on each of those days, CADENCE_POSTS_MIN to CADENCE_POSTS_MAX, three hours apart from the publish hour. */
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

/**
 * The weekdays (0 is Monday) that carry posts for each number of days a
 * week, spread so no two are next to each other where the count allows, and
 * weekdays first: a product's forum or a subreddit reads a post a few times
 * a week as taking part, and one a day as advertising.
 */
export const POST_WEEKDAYS: readonly (readonly number[])[] = [
  [],
  [1],
  [1, 3],
  [0, 2, 4],
  [0, 1, 3, 4],
  [0, 1, 2, 3, 4],
  [0, 1, 2, 3, 4, 5],
  [0, 1, 2, 3, 4, 5, 6],
]

/** The weekdays that carry posts for a number of days a week, which the cadence's checks hold to 0 to 7. */
export function postWeekdays(postDays: number): readonly number[] {
  const weekdays = POST_WEEKDAYS[postDays]
  if (weekdays === undefined) throw new Error(`${postDays} is no number of days a week`)
  return weekdays
}

const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const

/** When an account posts, in words: "2 posts a day at 15:00", "1 post on Tuesday and Thursday at 15:00", or no posts at all. */
export function cadenceText(format: Pick<PlatformFormat, 'publishHour' | 'cadence'>): string {
  const { postDays, postsPerDay } = format.cadence
  if (postDays === 0) return 'No posts: replies only'
  const posts = `${postsPerDay} ${postsPerDay === 1 ? 'post' : 'posts'}`
  const hour = `${String(format.publishHour).padStart(2, '0')}:00`
  if (postDays === 7) return `${posts} a day at ${hour}`
  const days = postWeekdays(postDays).map((index) => WEEKDAY_NAMES[index])
  const listed = days.length === 1 ? days.join('') : `${days.slice(0, -1).join(', ')} and ${days.at(-1)}`
  return `${posts} on ${listed} at ${hour}`
}

/** How an account takes part on its one platform: the local hour its posts start at, and its cadence. */
export interface PlatformFormat {
  platform: Platform
  /** Local hour (0 to 23) the day's first post is due. */
  publishHour: number
  cadence: XCadence
}

/**
 * What a new account starts from; the operator edits each one. A thread is
 * X's, so the other platforms start with text posts only. X and LinkedIn
 * post every day; a subreddit or a product's forum twice a week.
 */
export const DEFAULT_FORMATS: Record<Platform, PlatformFormat> = {
  // Most subreddits forbid showing your own product, so a Reddit account starts without shows.
  reddit: {
    platform: 'reddit',
    publishHour: 15,
    cadence: {
      postDays: 2,
      postsPerDay: 1,
      kinds: ['text'],
      intents: POST_INTENTS.filter((intent) => intent !== 'show'),
      repliesPerDay: REPLIES_PER_DAY_DEFAULT,
    },
  },
  // Hacker News reads one's own posts as promotion quickly: a new account posts once a week.
  hackernews: {
    platform: 'hackernews',
    publishHour: 15,
    cadence: { postDays: 1, postsPerDay: 1, kinds: ['text'], intents: [...POST_INTENTS], repliesPerDay: REPLIES_PER_DAY_DEFAULT },
  },
  x: {
    platform: 'x',
    publishHour: 15,
    cadence: { postDays: 7, postsPerDay: 2, kinds: ['text', 'thread'], intents: [...POST_INTENTS], repliesPerDay: REPLIES_PER_DAY_DEFAULT },
  },
  linkedin: {
    platform: 'linkedin',
    publishHour: 15,
    cadence: { postDays: 7, postsPerDay: 1, kinds: ['text'], intents: [...POST_INTENTS], repliesPerDay: REPLIES_PER_DAY_DEFAULT },
  },
  // A product's forum is mostly questions and answers, and its moderators remove ads, so a forum account starts without shows.
  forum: {
    platform: 'forum',
    publishHour: 15,
    cadence: {
      postDays: 2,
      postsPerDay: 1,
      kinds: ['text'],
      intents: POST_INTENTS.filter((intent) => intent !== 'show'),
      repliesPerDay: REPLIES_PER_DAY_DEFAULT,
    },
  },
}
