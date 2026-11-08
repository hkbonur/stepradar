import { placeLabel, type Platform, type PlatformPlace } from './platforms'

/**
 * What a platform shows of one of the account's posted items, as its reader
 * reads it (docs/plan.md, "Platform readers"). Reddit and Hacker News show a
 * score and the comments under it: Reddit fuzzes its scores and counts no
 * comments under a comment; Hacker News shows a story's points but no
 * comment's. X shows a post's impressions, likes, replies, reposts, profile
 * visits and the follows it brought. A Discourse forum shows how many read
 * a post (the topic's first post, or a reply), its likes and the posts that
 * answer it. LinkedIn shows nothing a reader can read.
 */
export type ItemCounts =
  | { platform: 'reddit'; score: number; replies: number | null }
  | { platform: 'hackernews'; score: number | null; replies: number }
  | { platform: 'x'; impressions: number; likes: number; replies: number; reposts: number; profileVisits: number; follows: number }
  | { platform: 'forum'; reads: number; likes: number; replies: number }

/** A post's or a reply's numbers at the analyst's last read: when, whether a mock reader read them, and the counts at the read before. */
export interface ItemRead {
  counts: ItemCounts
  readAt: number
  mock: boolean
  before?: ItemCounts
}

/** The platforms whose readers read numbers. */
export type CountedPlatform = ItemCounts['platform']

/**
 * An item's reach (CONTEXT.md, "Reach"): how far it went before anyone
 * clicked. Impressions on X, the score on Reddit and Hacker News, reads on a
 * forum; null where the platform shows none (a Hacker News comment).
 */
export function reachOf(counts: ItemCounts): number | null {
  switch (counts.platform) {
    case 'x':
      return counts.impressions
    case 'forum':
      return counts.reads
    case 'reddit':
    case 'hackernews':
      return counts.score
  }
}

/**
 * Whether a reply shows its reach on each platform: a Hacker News comment's
 * score is not public, and LinkedIn reads nothing. A reply experiment, which
 * is decided on reach, needs it.
 */
export const REPLIES_SHOW_REACH: Record<Platform, boolean> = { reddit: true, hackernews: false, x: true, linkedin: false, forum: true }

/** What an item's reach is called on each platform. */
export const ITEM_REACH_LABELS: Record<Platform, string> = {
  reddit: 'Points',
  hackernews: 'Points',
  x: 'Impressions',
  linkedin: 'Impressions',
  forum: 'Reads',
}

/** Where an item's numbers come from on a platform that is one site; a forum's come from the forum, by its name. */
const ITEM_COUNT_SOURCES: Record<Exclude<CountedPlatform, 'forum'>, string> = {
  reddit: 'Read from Reddit, which fuzzes scores',
  hackernews: 'Read from Hacker News',
  x: 'Read from X',
}

/** Where an account's numbers come from, as the post page and the report say it: its place, when its reader reads them; else that nothing does yet. */
export function countsSource(place: PlatformPlace, readerReads: boolean): string {
  if (!readerReads || place.platform === 'linkedin') return `Not read on ${placeLabel(place)} yet`
  return place.platform === 'forum' ? `Read from ${place.forum.name}` : ITEM_COUNT_SOURCES[place.platform]
}

/**
 * An account's reach over time (CONTEXT.md, "Reach"), as its reader reads it:
 * Reddit's link and comment karma, Hacker News's karma, X's followers, the
 * likes a forum account received.
 */
export type AccountReach =
  | { platform: 'reddit'; linkKarma: number; commentKarma: number }
  | { platform: 'hackernews'; karma: number }
  | { platform: 'x'; followers: number }
  | { platform: 'forum'; likesReceived: number }

/** The one number of an account's reach line: its karma, or its followers. */
export function accountReachOf(reach: AccountReach): number {
  switch (reach.platform) {
    case 'reddit':
      return reach.linkKarma + reach.commentKarma
    case 'hackernews':
      return reach.karma
    case 'x':
      return reach.followers
    case 'forum':
      return reach.likesReceived
  }
}

/** What an account's reach line counts on each platform. */
export const ACCOUNT_REACH_LABELS: Record<Platform, string> = {
  reddit: 'Karma',
  hackernews: 'Karma',
  x: 'Followers',
  linkedin: 'Followers',
  forum: 'Likes',
}
