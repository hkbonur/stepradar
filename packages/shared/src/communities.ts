/**
 * Communities (CONTEXT.md, "Community"): where an account takes part, a
 * subreddit, Hacker News, or a forum's category. The listener meets one when it hears a thread in
 * it, reads its rules, and the classifier says whether they let an account
 * name its own product (docs/plan.md, ground rule 3).
 */

import type { Platform, PlatformPlace } from './platforms'
import type { PostIntent } from './post-mix'

export const SELF_PROMOTION = ['allowed', 'forbidden', 'unknown'] as const
export type SelfPromotion = (typeof SELF_PROMOTION)[number]

export const SELF_PROMOTION_LABELS: Record<SelfPromotion, string> = {
  allowed: 'Self-promotion allowed',
  forbidden: 'No self-promotion',
  unknown: 'Self-promotion unclear',
}

/** Where a Hacker News post goes: Show HN, Ask HN, or the front page. */
export const HACKER_NEWS_COMMUNITIES = ['Show HN', 'Ask HN', 'Hacker News'] as const
export type HackerNewsCommunity = (typeof HACKER_NEWS_COMMUNITIES)[number]

/** What a Hacker News title starts with in each place. */
const HACKER_NEWS_PREFIXES: Record<HackerNewsCommunity, string> = {
  'Show HN': 'Show HN: ',
  'Ask HN': 'Ask HN: ',
  'Hacker News': '',
}

function isHackerNewsCommunity(name: string): name is HackerNewsCommunity {
  return (HACKER_NEWS_COMMUNITIES as readonly string[]).includes(name)
}

/**
 * Where a Hacker News post goes, by what it sets out to do: a show to Show HN,
 * the one place Hacker News lets an account show its own work; a question to
 * Ask HN; the rest to the front page.
 */
export function hackerNewsCommunity(intent: PostIntent): HackerNewsCommunity {
  if (intent === 'show') return 'Show HN'
  if (intent === 'ask') return 'Ask HN'
  return 'Hacker News'
}

/** What a Hacker News post's title starts with where it goes: "Show HN: ", "Ask HN: ", or nothing on the front page. */
export function hackerNewsTitlePrefix(community: string | null): string {
  return community !== null && isHackerNewsCommunity(community) ? HACKER_NEWS_PREFIXES[community] : ''
}

/** Where a Hacker News story was said, read from its title: the place whose prefix it starts with, else the front page. */
export function hackerNewsCommunityOfTitle(title: string): HackerNewsCommunity {
  return (
    HACKER_NEWS_COMMUNITIES.find(
      (community) => HACKER_NEWS_PREFIXES[community] !== '' && title.startsWith(HACKER_NEWS_PREFIXES[community])
    ) ?? 'Hacker News'
  )
}

/**
 * The platforms where a post goes to one of the account's communities that
 * the listener has met, as that community's rules allow: a subreddit, a
 * forum's category. So the strategy weighs those communities, and half a
 * sweep keeps to them. Hacker News places a post by what it sets out to do,
 * and X and LinkedIn nowhere in particular.
 */
export const MET_COMMUNITY_PLATFORMS = ['reddit', 'forum'] as const satisfies readonly Platform[]
export type MetCommunityPlatform = (typeof MET_COMMUNITY_PLATFORMS)[number]

export function postsToMetCommunity(platform: Platform): platform is MetCommunityPlatform {
  return MET_COMMUNITY_PLATFORMS.some((met) => met === platform)
}

/**
 * Where an account's posts can go (docs/plan.md, ground rule 3): on X,
 * LinkedIn and Hacker News, anywhere from the start; on Reddit and a
 * Discourse forum, only in a community the listener has met; on a forum on
 * other software, nowhere, since Influstep cannot read its categories or
 * their rules.
 */
export type PostPlacing = { kind: 'anywhere' } | { kind: 'met'; platform: MetCommunityPlatform } | { kind: 'nowhere'; forumName: string }

export function postPlacingOf(place: PlatformPlace): PostPlacing {
  if (place.platform === 'forum' && place.forum.software === 'other') return { kind: 'nowhere', forumName: place.forum.name }
  if (postsToMetCommunity(place.platform)) return { kind: 'met', platform: place.platform }
  return { kind: 'anywhere' }
}

/** What a community a post goes to is called on its platform, one and many. */
export const MET_COMMUNITY_NOUNS: Record<MetCommunityPlatform, { one: string; many: string }> = {
  reddit: { one: 'subreddit', many: 'subreddits' },
  forum: { one: 'category', many: 'categories' },
}

/** A community's rules are read again once they are this old. */
export const COMMUNITY_RULES_TTL_MS = 7 * 24 * 3_600_000
