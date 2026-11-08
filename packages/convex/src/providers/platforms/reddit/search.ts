import { z } from 'zod'
import { rankFound } from '../found'
import type { FoundThread, SearchQuery } from '../types'
import type { RedditSession } from './oauth'

const childSchema = z.object({
  data: z.object({
    name: z.string(),
    title: z.string(),
    permalink: z.string(),
    author: z.string(),
    score: z.number(),
    num_comments: z.number(),
    created_utc: z.number(),
    subreddit: z.string(),
    selftext: z.string(),
  }),
})
const listingSchema = z.object({ data: z.object({ children: z.array(childSchema) }) })

/**
 * Reddit's search, through the OAuth API (its public JSON refuses most
 * servers): the newest threads of the week for each term, in the account's
 * communities when it has any, else everywhere. A fullname is the id, as the
 * account's own posts have it.
 */
export async function redditSearch(session: RedditSession, query: SearchQuery): Promise<FoundThread[]> {
  const found: FoundThread[] = []
  const where = query.communities === null || query.communities.length === 0 ? '' : `/r/${query.communities.join('+')}`
  for (const term of query.terms) {
    const params = new URLSearchParams({ q: term, sort: 'new', t: 'week', limit: String(query.limit), raw_json: '1' })
    if (where !== '') params.set('restrict_sr', '1')
    const listing = listingSchema.parse(await session.get(`${where}/search?${params}`))
    for (const { data: post } of listing.data.children) {
      if (post.created_utc * 1000 < query.since) continue
      found.push({
        externalId: post.name,
        url: `https://www.reddit.com${post.permalink}`,
        title: post.title,
        text: post.selftext,
        postedAt: post.created_utc * 1000,
        author: { handle: post.author, name: post.author },
        reach: post.score,
        community: post.subreddit,
        comments: post.num_comments,
        topics: [term],
      })
    }
  }
  return rankFound(found, query.limit)
}

const rulesSchema = z.object({ rules: z.array(z.object({ short_name: z.string(), description: z.string() })) })

/** A subreddit's rules, one per line, its name and then what it says. */
export async function redditRules(session: RedditSession, community: string): Promise<string> {
  const parsed = rulesSchema.parse(await session.get(`/r/${encodeURIComponent(community)}/about/rules?raw_json=1`))
  return parsed.rules.map((rule) => `${rule.short_name}: ${rule.description}`.trim()).join('\n')
}
