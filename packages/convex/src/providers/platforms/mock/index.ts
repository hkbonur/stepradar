import type { PlatformPlace } from '@influstep/shared'
import { mockXHistory } from './history'
import { mockAccount, mockComments, mockCounts } from './items'
import { mockMentions, mockXSearch } from './listen'
import { mockSearch } from './search'
import type { ActivityQuery, HeardMention, MentionsQuery, PlatformReader, ReaderConnection } from '../types'
import { HN_GUIDELINES } from '../guidelines'

/** A mock mention on Reddit: one an hour ago in r/n8n, asking the account by name. */
async function mockRedditMentions(query: MentionsQuery): Promise<HeardMention[]> {
  const postedAt = Date.now() - 3_600_000
  return [
    {
      origin: 'mention',
      externalId: `t1_mock${Math.floor(postedAt / 3_600_000)}`,
      url: 'https://www.reddit.com/r/n8n/comments/mock/retries/',
      title: 'Webhook retries run twice',
      text: `u/${query.handle} you wrote about this last week, what fixed it for you?`,
      postedAt,
      author: { handle: 'ops_dana', name: 'ops_dana' },
      reach: null,
      community: 'n8n',
      pillar: null,
      comments: null,
    },
  ]
}

/** A mock subreddit's rules: kind words, and no self-promotion outside the weekly thread. */
async function mockRedditRules(community: string): Promise<string> {
  return [`Be kind in r/${community}.`, 'Search before you post.', 'No self-promotion or advertising outside the weekly thread.'].join('\n')
}

/** A mock forum's guidelines and a category's description, as a Discourse forum shows them. */
async function mockForumRules(community: string): Promise<string> {
  return [
    'Be civil, and criticize ideas, not people.',
    'No spam and no advertising: share your own product only where it answers the question.',
    `${community}: ask one question per topic, with what you tried, and mark the reply that solved it.`,
  ].join('\n')
}

/** A mock history: the X-shaped posts the history keeps, made from the account's niche and pillars, since the time asked. */
const activity = async (query: ActivityQuery) => mockXHistory(query).filter((post) => post.postedAt >= query.since)

/**
 * Each platform's mock reader, deterministic from its inputs. A mock reads
 * what its platform's real reader reads: Hacker News searches and reads the
 * account's posts, their comments, their numbers and its karma; Reddit
 * searches, and reads the account, its mentions and its karma among them,
 * once it is connected (in mock mode Connect needs no keys); X searches,
 * hears its mentions, reads its history, its numbers and its followers as
 * its API reader will once its tier is chosen; a Discourse forum searches,
 * and reads the account, its comments, its numbers and its likes; LinkedIn,
 * which has no read API, and a forum on other software read nothing, so
 * their steps are manual in mock mode too.
 */
export function mockReader(place: PlatformPlace, connection: ReaderConnection | null): PlatformReader {
  switch (place.platform) {
    case 'reddit':
      return connection === null
        ? { platform: place.platform, name: 'mock', search: mockSearch('reddit'), rules: mockRedditRules }
        : {
            platform: place.platform,
            name: 'mock',
            search: mockSearch('reddit'),
            mentions: mockRedditMentions,
            activity,
            comments: mockComments(place),
            counts: mockCounts(place.platform),
            account: mockAccount(place.platform),
            rules: mockRedditRules,
          }
    case 'hackernews':
      return {
        platform: place.platform,
        name: 'mock',
        search: mockSearch('hackernews'),
        activity,
        comments: mockComments(place),
        counts: mockCounts(place.platform),
        account: mockAccount(place.platform),
        rules: async () => HN_GUIDELINES,
      }
    case 'x':
      return {
        platform: place.platform,
        name: 'mock',
        search: mockXSearch,
        mentions: mockMentions,
        activity,
        comments: mockComments(place),
        counts: mockCounts(place.platform),
        account: mockAccount(place.platform),
      }
    case 'linkedin':
      return { platform: place.platform, name: 'mock' }
    case 'forum':
      if (place.forum.software === 'other') return { platform: place.platform, name: 'mock' }
      return {
        platform: place.platform,
        name: 'mock',
        search: mockSearch('forum'),
        activity,
        comments: mockComments(place),
        counts: mockCounts(place.platform),
        account: mockAccount(place.platform),
        rules: mockForumRules,
        // A mock topic is in the forum's first category.
        community: async () => 'Questions',
      }
  }
}
