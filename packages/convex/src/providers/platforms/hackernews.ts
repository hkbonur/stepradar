import { hackerNewsCommunityOfTitle, type AccountReach, type ImportedPost, type ItemCounts } from '@influstep/shared'
import { z } from 'zod'
import { refusal } from '../../lib/errors'
import type {
  ActivityQuery,
  CommentsQuery,
  CountedItem,
  CountsQuery,
  FoundThread,
  PlatformComment,
  PlatformReader,
  SearchQuery,
} from './types'
import { rankFound } from './found'
import { HN_GUIDELINES } from './guidelines'

const hitSchema = z.object({
  objectID: z.string(),
  title: z.string().nullable(),
  url: z.string().nullable(),
  author: z.string(),
  story_text: z.string().nullable().optional(),
  points: z.number().nullable(),
  num_comments: z.number().nullable(),
  created_at_i: z.number(),
})
const responseSchema = z.object({ hits: z.array(hitSchema) })

/** The Firebase API's user: a username that does not exist reads as null. */
const userSchema = z.object({ id: z.string(), karma: z.number(), submitted: z.array(z.number()).optional() }).nullable()

/** The Firebase API's item: a story or a comment the account wrote, or one under it. Removed ones keep their id and say so. */
const itemSchema = z
  .object({
    id: z.number(),
    type: z.enum(['story', 'comment', 'job', 'poll', 'pollopt']),
    time: z.number(),
    title: z.string().optional(),
    text: z.string().optional(),
    url: z.string().optional(),
    score: z.number().optional(),
    descendants: z.number().optional(),
    kids: z.array(z.number()).optional(),
    parent: z.number().optional(),
    by: z.string().optional(),
    deleted: z.boolean().optional(),
    dead: z.boolean().optional(),
  })
  .nullable()

type Item = NonNullable<z.infer<typeof itemSchema>>

const FIREBASE = 'https://hacker-news.firebaseio.com/v0'

/** How many of the account's newest submissions an import reads: about a month for an active account, in a handful of requests. */
const ACTIVITY_ITEMS = 100

/** An item's page on Hacker News, its id appended. */
const HN_ITEM_URL = 'https://news.ycombinator.com/item?id='

/** How many items the reader asks Firebase for at once. */
const FETCH_BATCH = 20

/**
 * Hacker News: search through the Algolia API, the account's own posts and
 * comments, the comments under them, their numbers and the account's karma
 * through the Firebase API. No key needed; an account is its username.
 * Comment scores are not public and stories show no views, so a story counts
 * its points and comments, and a comment only the answers under it.
 */
export const hackerNewsReader: PlatformReader = {
  platform: 'hackernews',
  name: 'algolia and firebase',
  // Hacker News is one community, so a search reads it whatever the account's communities are.
  async search(query: SearchQuery): Promise<FoundThread[]> {
    const found: FoundThread[] = []
    for (const term of query.terms) {
      const url = new URL('https://hn.algolia.com/api/v1/search')
      url.searchParams.set('query', term)
      url.searchParams.set('tags', 'story')
      url.searchParams.set('numericFilters', `created_at_i>${Math.floor(query.since / 1000)}`)
      url.searchParams.set('hitsPerPage', String(query.limit))
      const response = await fetch(url)
      if (!response.ok) throw new Error(`Hacker News search failed: ${response.status} ${response.statusText}`)
      const parsed = responseSchema.parse(await response.json())
      for (const hit of parsed.hits) {
        if (!hit.title) continue
        found.push({
          externalId: hit.objectID,
          url: `${HN_ITEM_URL}${hit.objectID}`,
          title: hit.title,
          text: hit.story_text ? hnText(hit.story_text) : (hit.url ?? ''),
          postedAt: hit.created_at_i * 1000,
          author: { handle: hit.author, name: hit.author },
          reach: hit.points ?? 0,
          community: hackerNewsCommunityOfTitle(hit.title),
          comments: hit.num_comments ?? 0,
          topics: [term],
        })
      }
    }
    return rankFound(found, query.limit)
  },

  async activity(query: ActivityQuery): Promise<ImportedPost[]> {
    const user = await userOf(query.handle)
    const items = await itemsSince((user.submitted ?? []).slice(0, ACTIVITY_ITEMS), query.since)
    return items.flatMap((item) => {
      const post = importedPostOf(item)
      return post === null ? [] : [post]
    })
  },

  // Hacker News has one set of guidelines for all of it.
  rules: async () => HN_GUIDELINES,

  async counts(query: readonly CountsQuery[]): Promise<CountedItem[]> {
    const read: CountedItem[] = []
    for (const item of await itemsRead(query.map((asked) => Number(asked.externalId)))) {
      const externalId = String(item.id)
      // Killed by the moderators or by flags; one its author deleted is gone, and no removal.
      if (item.dead) read.push({ externalId, removed: true })
      else if (item.deleted) continue
      else {
        const counts = countsOf(item)
        if (counts !== null) read.push({ externalId, counts })
      }
    }
    return read
  },

  async account(handle: string): Promise<AccountReach> {
    return { platform: 'hackernews', karma: (await userOf(handle)).karma }
  },

  async comments(query: CommentsQuery): Promise<PlatformComment[]> {
    const comments: PlatformComment[] = []
    for (const externalId of query.items) {
      const item = itemSchema.parse(await firebase(`item/${encodeURIComponent(externalId)}`))
      // A link the operator gave with a wrong id names no item; the other items are still read.
      if (item === null) continue
      const unread = (item.kids ?? []).filter((kid) => !query.known.has(String(kid)))
      for (const kid of await itemsOf(unread)) {
        if (kid.type !== 'comment' || kid.text === undefined || kid.by === undefined || kid.time * 1000 < query.since) continue
        comments.push({
          externalId: String(kid.id),
          parentId: externalId,
          author: { handle: kid.by, name: kid.by },
          text: hnText(kid.text),
          url: `${HN_ITEM_URL}${kid.id}`,
          community: 'Hacker News',
          likes: 0,
          at: kid.time * 1000,
        })
      }
    }
    return comments
  },
}

async function userOf(handle: string): Promise<NonNullable<z.infer<typeof userSchema>>> {
  const user = userSchema.parse(await firebase(`user/${encodeURIComponent(handle)}`))
  if (user === null) throw refusal(`Hacker News has no user named ${handle}.`)
  return user
}

/** A story's points and comments, or the answers under a comment, whose score is not public; a job or a poll is no item of the account's. */
export function countsOf(item: Item): ItemCounts | null {
  if (item.type === 'story') return { platform: 'hackernews', score: item.score ?? 0, replies: item.descendants ?? 0 }
  if (item.type === 'comment') return { platform: 'hackernews', score: null, replies: item.kids?.length ?? 0 }
  return null
}

async function firebase(path: string): Promise<unknown> {
  const response = await fetch(`${FIREBASE}/${path}.json`)
  if (!response.ok) throw new Error(`Hacker News read failed: ${response.status} ${response.statusText}`)
  return response.json()
}

/** The items by id, in the order given, a batch of requests at a time, removed ones too; missing ones are left out. */
async function itemsRead(ids: number[]): Promise<Item[]> {
  const items: Item[] = []
  for (let start = 0; start < ids.length; start += FETCH_BATCH) {
    const batch = await Promise.all(ids.slice(start, start + FETCH_BATCH).map(async (id) => itemSchema.parse(await firebase(`item/${id}`))))
    for (const item of batch) if (item !== null) items.push(item)
  }
  return items
}

/** The items by id, in the order given; removed and missing ones are left out. */
async function itemsOf(ids: number[]): Promise<Item[]> {
  return (await itemsRead(ids)).filter((item) => !item.deleted && !item.dead)
}

/**
 * The items among `ids` posted since `since`. A user's items are listed newest
 * first, so no batch is asked for past the first older one.
 */
async function itemsSince(ids: number[], since: number): Promise<Item[]> {
  const items: Item[] = []
  for (let start = 0; start < ids.length; start += FETCH_BATCH) {
    const batch = await itemsOf(ids.slice(start, start + FETCH_BATCH))
    items.push(...batch.filter((item) => item.time * 1000 >= since))
    if (batch.some((item) => item.time * 1000 < since)) break
  }
  return items
}

/**
 * A story or a comment as the history keeps a post: a story is its title and
 * its text, a comment is a reply. Hacker News shows no comment's score, so a
 * comment's likes are 0, and it names no language. A job or a poll is no
 * post of the account's.
 */
export function importedPostOf(item: Item): ImportedPost | null {
  const base = { externalId: String(item.id), postedAt: item.time * 1000, url: `${HN_ITEM_URL}${item.id}`, reposts: 0, lang: null }
  if (item.type === 'story') {
    const title = item.title ?? ''
    const text = item.text === undefined ? '' : `\n\n${hnText(item.text)}`
    return {
      ...base,
      parts: [`${title}${text}`.trim()],
      likes: item.score ?? 0,
      replies: item.descendants ?? 0,
      parentId: null,
      community: hackerNewsCommunityOfTitle(title),
    }
  }
  if (item.type === 'comment' && item.text !== undefined && item.parent !== undefined) {
    return {
      ...base,
      parts: [hnText(item.text)],
      likes: 0,
      replies: item.kids?.length ?? 0,
      parentId: String(item.parent),
      community: 'Hacker News',
    }
  }
  return null
}

const ENTITIES: Record<string, string> = {
  '&quot;': '"',
  '&#x27;': "'",
  '&#39;': "'",
  '&#x2F;': '/',
  '&lt;': '<',
  '&gt;': '>',
  '&amp;': '&',
}

/** Hacker News writes text as HTML: a paragraph is a <p>, a link an <a>, a quote an entity. Plain text, paragraphs kept. */
export function hnText(html: string): string {
  return html
    .replace(/<p>/g, '\n\n')
    .replace(/<a [^>]*href="([^"]*)"[^>]*>.*?<\/a>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&(?:quot|#x27|#39|#x2F|lt|gt|amp);/g, (entity) => ENTITIES[entity] ?? entity)
    .trim()
}
