import type { AccountReach, CountedPlatform, ItemCounts, Platform, PlatformPlace } from '@influstep/shared'
import type { CommentsQuery, CountedItem, CountsQuery, PlatformComment } from '../types'

const COMMENTS = [
  'Can you show how to retry a failed webhook step?',
  'Which form tool is that? Does it work with Zapier?',
  'This saved my Monday. Subscribed.',
  'What about error handling when the client never answers?',
]

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS

const COMMENTERS = ['dana_ops', 'tomtries', 'priya_builds', 'kai_automates']

/** Where a mock comment is on its platform; a forum's are on the forum. */
const COMMENT_URLS: Record<Exclude<Platform, 'forum'>, (id: string, author: string) => string> = {
  x: (id, author) => `https://x.com/${author}/status/${id}`,
  linkedin: (id) => `https://www.linkedin.com/feed/update/urn:li:comment:${id}`,
  reddit: (id) => `https://www.reddit.com/r/mock/comments/mock/comment/${id}/`,
  hackernews: (id) => `https://news.ycombinator.com/item?id=${id}`,
}

function commentUrl(place: PlatformPlace, id: string, author: string): string {
  return place.platform === 'forum' ? `${place.forum.origin}/t/mock/${id}` : COMMENT_URLS[place.platform](id, author)
}

/** The comments under each mock item: two to four of a fixed set, an hour apart, seeded by the item's id. */
export function mockComments(place: PlatformPlace) {
  return async (query: CommentsQuery): Promise<PlatformComment[]> =>
    query.items.flatMap((parentId) => {
      const seed = hash(parentId)
      return COMMENTS.slice(0, 2 + (seed % 3)).flatMap((text, index) => {
        const at = Date.now() - index * 3_600_000
        if (at < query.since) return []
        const externalId = `${parentId}-c${index}`
        const handle = COMMENTERS[(seed + index) % COMMENTERS.length]
        if (handle === undefined) throw new Error('the mock has no commenters')
        return [
          {
            externalId,
            parentId,
            author: { handle, name: handle },
            text,
            url: commentUrl(place, externalId, handle),
            community: null,
            likes: (seed + index * 7) % 20,
            at,
          },
        ]
      })
    })
}

/** Mock items' numbers, as their platform counts them (shared `ItemCounts`). */
export function mockCounts(platform: CountedPlatform) {
  return async (items: readonly CountsQuery[]): Promise<CountedItem[]> =>
    items.map((item) => ({ externalId: item.externalId, counts: mockItemCounts(platform, item) }))
}

/**
 * A mock item's numbers: they grow with the hours since it went up over its
 * first three days, seeded by its id, so the report shows movement. Most
 * items bring nobody to follow; some bring a few. Each platform shows what
 * its real reader reads: no comment count under a Reddit comment, no score
 * on a Hacker News comment, reads and likes on a forum.
 */
function mockItemCounts(platform: CountedPlatform, item: CountsQuery): ItemCounts {
  const hours = Math.max(0, (Date.now() - item.postedAt) / HOUR_MS)
  const seed = hash(item.externalId)
  const growth = Math.log2(2 + Math.min(hours, 72))
  if (platform === 'x') {
    const impressions = Math.round((400 + (seed % 900)) * growth * 3)
    return {
      platform,
      impressions,
      likes: Math.round(impressions * 0.04),
      replies: Math.round(impressions * 0.004),
      reposts: Math.round(impressions * 0.006),
      profileVisits: Math.round(impressions * 0.02),
      follows: Math.round((impressions * (seed % 5)) / 1000),
    }
  }
  if (platform === 'forum') {
    const reads = Math.round((20 + (seed % 200)) * growth)
    return { platform, reads, likes: Math.round(reads * 0.05), replies: Math.round(reads * 0.03) }
  }
  const score = Math.round((2 + (seed % 40)) * growth)
  const replies = Math.round(score * 0.3)
  if (platform === 'reddit') return { platform, score, replies: item.kind === 'post' ? replies : null }
  return { platform, score: item.kind === 'post' ? score : null, replies }
}

/** A mock account's karma or followers: seeded by its handle, a few more each day, so the reach line climbs. */
export function mockAccount(platform: CountedPlatform) {
  return async (handle: string): Promise<AccountReach> => {
    const seed = hash(handle)
    const days = Math.floor(Date.now() / DAY_MS) - Math.floor(Date.UTC(2026, 0, 1) / DAY_MS)
    const reach = 300 + (seed % 2000) + days * (1 + (seed % 7))
    switch (platform) {
      case 'reddit':
        return { platform, linkKarma: Math.round(reach * 0.4), commentKarma: Math.round(reach * 0.6) }
      case 'hackernews':
        return { platform, karma: reach }
      case 'x':
        return { platform, followers: reach }
      case 'forum':
        return { platform, likesReceived: Math.round(reach * 0.2) }
    }
  }
}

function hash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return Math.abs(h >>> 0)
}
