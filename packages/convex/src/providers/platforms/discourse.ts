import {
  discourseItemId,
  discourseItemOf,
  forumHost,
  type AccountReach,
  type Forum,
  type ImportedPost,
  type ItemCounts,
} from '@influstep/shared'
import { z } from 'zod'
import { refusal } from '../../lib/errors'
import { rankFound } from './found'
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

/** What any Discourse forum says of itself to a visitor: its title, and whether it asks visitors to sign in. */
const basicInfoSchema = z.object({ title: z.string(), login_required: z.boolean() })

/**
 * The forum at an https origin, as the setup finds it: a Discourse forum
 * answers `/site/basic-info.json` with its title, and one anyone can read is
 * read by the Discourse reader; any other site is other software, run by
 * hand, and named by its host. A private Discourse forum is refused: the
 * reader reads only what anyone can.
 */
export async function discourseForumAt(origin: string): Promise<Forum> {
  const host = forumHost({ origin })
  let response: Response
  try {
    response = await fetch(`${origin}/site/basic-info.json`, { headers: { Accept: 'application/json' } })
  } catch (error) {
    throw refusal(`Influstep could not reach ${host}: ${error instanceof Error ? error.message : String(error)}`)
  }
  const info = response.ok ? basicInfoSchema.safeParse(await response.json().catch(() => null)) : null
  if (!info?.success) return { origin, name: host, software: 'other' }
  if (info.data.login_required)
    throw refusal(`${info.data.title} asks visitors to sign in, and Influstep reads only forums anyone can read.`)
  return { origin, name: info.data.title, software: 'discourse' }
}

const searchSchema = z.object({
  posts: z
    .array(
      z.object({
        username: z.string(),
        name: z.string().nullish(),
        created_at: z.string(),
        like_count: z.number(),
        blurb: z.string(),
        post_number: z.number(),
        topic_id: z.number(),
      })
    )
    .default([]),
  topics: z
    .array(
      z.object({
        id: z.number(),
        title: z.string(),
        slug: z.string(),
        posts_count: z.number(),
        category_id: z.number().nullish(),
      })
    )
    .default([]),
})

const categorySchema = z.object({ id: z.number(), name: z.string(), description_text: z.string().nullish() })
const categoriesSchema = z.object({
  category_list: z.object({
    categories: z.array(categorySchema.extend({ subcategory_list: z.array(categorySchema).nullish() })),
  }),
})
type Category = z.infer<typeof categorySchema>

const userActionsSchema = z.object({
  user_actions: z.array(
    z.object({
      action_type: z.number(),
      created_at: z.string(),
      excerpt: z.string(),
      truncated: z.boolean().nullish(),
      slug: z.string(),
      topic_id: z.number(),
      post_number: z.number(),
      post_id: z.number(),
      reply_to_post_number: z.number().nullable(),
      title: z.string(),
      category_id: z.number().nullish(),
    })
  ),
})

/** A post as a topic, a page of a topic, or the post itself shows it; a removed one says so. */
const postSchema = z.object({
  id: z.number(),
  post_number: z.number(),
  post_type: z.number(),
  username: z.string(),
  name: z.string().nullish(),
  created_at: z.string(),
  cooked: z.string(),
  reads: z.number(),
  reply_count: z.number(),
  actions_summary: z.array(z.object({ id: z.number(), count: z.number().optional() })).optional(),
  hidden: z.boolean().optional(),
  user_deleted: z.boolean().optional(),
})
type Post = z.infer<typeof postSchema>

const topicSchema = z.object({
  id: z.number(),
  slug: z.string(),
  posts_count: z.number(),
  category_id: z.number().nullish(),
  visible: z.boolean().optional(),
  post_stream: z.object({ posts: z.array(postSchema) }),
})
const postsPageSchema = z.object({ post_stream: z.object({ posts: z.array(postSchema) }) })
const repliesSchema = z.array(postSchema)
const summarySchema = z.object({ user_summary: z.object({ likes_received: z.number() }) })

/** Discourse's user actions: a topic the user started, and a reply they posted. */
const NEW_TOPIC = 4
const REPLY = 5

/** A post written by a person, not the forum's own note that a topic was closed or moved. */
const REGULAR_POST = 1

/** The action Discourse counts a like as, in a post's `actions_summary`. */
const LIKE = 2

/** How many of the account's newest topics and replies an import reads: a page of thirty at a time. */
const ACTIVITY_ITEMS = 90

/** How many pages of posts after the last one read a comment poll reads in one topic, twenty a page. */
const COMMENT_PAGES = 3

/** How many items the reader asks the forum for at once: a public forum limits how fast a visitor reads. */
const FETCH_BATCH = 4

/** The longest a read waits when the forum asks it to slow down, before it tries once more; a longer wait fails the read. */
const RATE_LIMIT_WAIT_MAX_S = 15

/**
 * A Discourse forum, read through the public JSON every page of it has, as
 * any visitor reads it: no key, and nothing a visitor cannot see. Threads are
 * topics, searched by their first post; a reply is a post in a topic, named
 * by the topic and its number (shared `discourseItemId`); communities are
 * categories, whose rules are the forum's guidelines and the category's own
 * description. A search shows no views, so a found thread's reach is its
 * first post's likes; a posted item's reach is how many read it. Discourse
 * shows a visitor no one's mentions, so mentions are left out: answers under
 * the account's own posts come with the comments. The categories and the
 * guidelines are read once per reader, which lives for one job.
 */
export function discourseReader(forum: Forum): PlatformReader {
  const read = async (path: string) => {
    const response = await request(forum, path, 'application/json')
    return response === null ? null : response.json()
  }
  let categoriesRead: Promise<Map<number, Category>> | undefined
  const categories = () => (categoriesRead ??= read('/categories.json?include_subcategories=true').then(categoriesOf))
  let guidelinesRead: Promise<string> | undefined
  const guidelines = () => (guidelinesRead ??= guidelinesOf(forum))
  const categoryName = async (id: number | null | undefined) => (id == null ? null : ((await categories()).get(id)?.name ?? null))
  const itemUrl = (slug: string, topicId: number, postNumber: number) =>
    postNumber === 1 ? `${forum.origin}/t/${slug}/${topicId}` : `${forum.origin}/t/${slug}/${topicId}/${postNumber}`

  return {
    platform: 'forum',
    name: 'discourse',

    async search(query: SearchQuery): Promise<FoundThread[]> {
      const after = new Date(query.since).toISOString().slice(0, 10)
      const kept = query.communities === null ? null : new Set(query.communities.map((name) => name.toLowerCase()))
      const found: FoundThread[] = []
      for (const term of query.terms) {
        const parsed = searchSchema.parse(
          await read(`/search.json?q=${encodeURIComponent(`${term} after:${after} in:first order:latest`)}`)
        )
        const topics = new Map(parsed.topics.map((topic) => [topic.id, topic]))
        for (const post of parsed.posts) {
          const topic = topics.get(post.topic_id)
          if (post.post_number !== 1 || topic === undefined) continue
          const community = await categoryName(topic.category_id)
          if (kept !== null && (community === null || !kept.has(community.toLowerCase()))) continue
          found.push({
            externalId: discourseItemId(topic.id, 1),
            url: itemUrl(topic.slug, topic.id, 1),
            title: topic.title,
            text: discourseText(post.blurb),
            postedAt: Date.parse(post.created_at),
            author: { handle: post.username, name: post.name || post.username },
            reach: post.like_count,
            community,
            comments: topic.posts_count - 1,
            topics: [term],
          })
        }
      }
      return rankFound(found, query.limit)
    },

    async activity(query: ActivityQuery): Promise<ImportedPost[]> {
      const items: ImportedPost[] = []
      for (let offset = 0; offset < ACTIVITY_ITEMS; offset += 30) {
        const path = `/user_actions.json?username=${encodeURIComponent(query.handle)}&filter=${NEW_TOPIC},${REPLY}&offset=${offset}`
        const page = await read(path)
        if (page === null) throw refusal(`${forum.name} has no user named ${query.handle}.`)
        const actions = userActionsSchema.parse(page).user_actions
        const fresh = actions.filter((action) => Date.parse(action.created_at) >= query.since)
        // An excerpt cut short is read whole from its post, a batch at a time.
        const whole = await inBatches(
          fresh.filter((action) => action.truncated === true),
          async (action) => [action.post_id, await postBy(read, `/posts/${action.post_id}.json`)] as const
        )
        const texts = new Map(whole.flatMap(([id, post]) => (post === null ? [] : [[id, discourseText(post.cooked)]])))
        for (const action of fresh) {
          const text = texts.get(action.post_id) ?? discourseText(action.excerpt)
          const topic = action.action_type === NEW_TOPIC
          items.push({
            externalId: discourseItemId(action.topic_id, action.post_number),
            parts: [topic ? `${action.title}\n\n${text}`.trim() : text],
            postedAt: Date.parse(action.created_at),
            // A user's actions show no counts: the analyst reads them per item.
            likes: 0,
            reposts: 0,
            replies: 0,
            parentId: topic ? null : discourseItemId(action.topic_id, action.reply_to_post_number ?? 1),
            url: itemUrl(action.slug, action.topic_id, action.post_number),
            community: await categoryName(action.category_id),
            lang: null,
          })
        }
        // A user's actions are listed newest first, so no page is asked for past the first older one.
        if (actions.length < 30 || fresh.length < actions.length) break
      }
      return items
    },

    async comments(query: CommentsQuery): Promise<PlatformComment[]> {
      const comments: PlatformComment[] = []
      // A post that answers the account's reply in the account's own topic is under both; it is read once.
      const seen = new Set(query.known)
      for (const externalId of query.items) {
        const item = discourseItemOf(externalId)
        // A link the operator gave on another forum page names no item; the other items are still read.
        if (item === null) continue
        const posts = item.postNumber === 1 ? await postsAfter(read, item.topicId, query.known) : await repliesTo(read, item)
        for (const post of posts) {
          const id = discourseItemId(item.topicId, post.post_number)
          const at = Date.parse(post.created_at)
          if (post.post_type !== REGULAR_POST || post.hidden === true || seen.has(id) || at < query.since) continue
          seen.add(id)
          comments.push({
            externalId: id,
            parentId: externalId,
            author: { handle: post.username, name: post.name || post.username },
            text: discourseText(post.cooked),
            url: `${forum.origin}/t/${item.topicId}/${post.post_number}`,
            // A post says only the category's id; the account's item it answers knows where it was said.
            community: null,
            likes: likesOf(post),
            at,
          })
        }
      }
      return comments
    },

    async counts(items: readonly CountsQuery[]): Promise<CountedItem[]> {
      const counted = await inBatches(items, async (asked): Promise<CountedItem | null> => {
        const item = discourseItemOf(asked.externalId)
        if (item === null) return null
        if (item.postNumber === 1) {
          const page = await read(`/t/${item.topicId}.json`)
          // A topic gone from the forum, or one its author deleted, is no removal.
          if (page === null) return null
          const topic = topicSchema.parse(page)
          const first = topic.post_stream.posts.find((post) => post.post_number === 1)
          if (first === undefined) return null
          // Hidden by flags or the moderators, or unlisted by them.
          if (first.hidden === true || topic.visible === false) return { externalId: asked.externalId, removed: true }
          return { externalId: asked.externalId, counts: countsOf(first, topic.posts_count - 1) }
        }
        const post = await postBy(read, `/posts/by_number/${item.topicId}/${item.postNumber}.json`)
        if (post === null || post.user_deleted === true) return null
        if (post.hidden === true) return { externalId: asked.externalId, removed: true }
        return { externalId: asked.externalId, counts: countsOf(post, post.reply_count) }
      })
      return counted.flatMap((item) => (item === null ? [] : [item]))
    },

    async account(handle: string): Promise<AccountReach> {
      const summary = await read(`/u/${encodeURIComponent(handle)}/summary.json`)
      if (summary === null) throw refusal(`${forum.name} has no user named ${handle}.`)
      return { platform: 'forum', likesReceived: summarySchema.parse(summary).user_summary.likes_received }
    },

    async rules(community: string): Promise<string> {
      const category = [...(await categories()).values()].find((candidate) => candidate.name.toLowerCase() === community.toLowerCase())
      const own = category?.description_text?.trim()
      return own ? `${await guidelines()}\n\n${category?.name}: ${own}` : guidelines()
    },

    // A link names its topic, never its category: the topic says.
    async community(externalId: string): Promise<string | null> {
      const item = discourseItemOf(externalId)
      if (item === null) return null
      const page = await read(`/t/${item.topicId}.json`)
      if (page === null) throw refusal(`${forum.name} has no topic ${item.topicId}.`)
      return categoryName(topicSchema.parse(page).category_id)
    },
  }
}

/**
 * One page of the forum; null when the forum has no such page (a deleted
 * topic, a wrong username). Asked to slow down, the read waits as long as
 * the forum says, up to RATE_LIMIT_WAIT_MAX_S, and tries once more.
 */
async function request(forum: Forum, path: string, accept: string, retried = false): Promise<Response | null> {
  const response = await fetch(`${forum.origin}${path}`, { headers: { Accept: accept } })
  if (response.status === 404) return null
  if (response.status === 429) {
    const wait = Number(response.headers.get('Retry-After') ?? RATE_LIMIT_WAIT_MAX_S)
    if (retried || !(wait > 0 && wait <= RATE_LIMIT_WAIT_MAX_S))
      throw new Error(`${forum.name} limits how fast a visitor reads it; the next read tries again.`)
    await new Promise((resolve) => setTimeout(resolve, wait * 1000))
    return request(forum, path, accept, true)
  }
  if (!response.ok) throw new Error(`${forum.name} read failed: ${response.status} ${response.statusText}`)
  return response
}

async function postBy(read: (path: string) => Promise<unknown>, path: string): Promise<Post | null> {
  const page = await read(path)
  return page === null ? null : postSchema.parse(page)
}

/** Every category by its id, subcategories too. */
function categoriesOf(page: unknown): Map<number, Category> {
  const byId = new Map<number, Category>()
  for (const category of categoriesSchema.parse(page).category_list.categories) {
    byId.set(category.id, category)
    for (const sub of category.subcategory_list ?? []) byId.set(sub.id, sub)
  }
  return byId
}

/**
 * The posts in a topic after the last one already read there, in order, up
 * to COMMENT_PAGES pages: every post in a topic answers the account that
 * started it.
 */
async function postsAfter(read: (path: string) => Promise<unknown>, topicId: number, known: ReadonlySet<string>): Promise<Post[]> {
  let after = 1
  for (const id of known) {
    const item = discourseItemOf(id)
    if (item?.topicId === topicId) after = Math.max(after, item.postNumber)
  }
  const posts: Post[] = []
  for (let page = 0; page < COMMENT_PAGES; page += 1) {
    const json = await read(`/t/${topicId}/posts.json?post_number=${after}&asc=true`)
    if (json === null) break
    const batch = postsPageSchema.parse(json).post_stream.posts.filter((post) => post.post_number > after)
    posts.push(...batch)
    const last = batch.at(-1)
    if (last === undefined) break
    after = last.post_number
  }
  return posts
}

/** The posts that answer one post of the account's in a topic: the ones Discourse shows as its replies. */
async function repliesTo(read: (path: string) => Promise<unknown>, item: { topicId: number; postNumber: number }): Promise<Post[]> {
  const post = await postBy(read, `/posts/by_number/${item.topicId}/${item.postNumber}.json`)
  if (post === null) return []
  const page = await read(`/posts/${post.id}/replies.json`)
  return page === null ? [] : repliesSchema.parse(page)
}

function likesOf(post: Post): number {
  return post.actions_summary?.find((action) => action.id === LIKE)?.count ?? 0
}

/** A post's numbers: how many read it, its likes, and the posts that answer it. */
function countsOf(post: Post, replies: number): ItemCounts {
  return { platform: 'forum', reads: post.reads, likes: likesOf(post), replies }
}

/** Each item read in order, FETCH_BATCH at a time. */
async function inBatches<T, R>(items: readonly T[], read: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  for (let start = 0; start < items.length; start += FETCH_BATCH)
    out.push(...(await Promise.all(items.slice(start, start + FETCH_BATCH).map(read))))
  return out
}

/**
 * The forum's guidelines as text: Discourse writes them into the page it
 * serves a visitor without JavaScript, between `mainContentOfPage` and the
 * footer. That page is the forum's own template, so a forum that changes it
 * can leave the guidelines unread: the classifier then reads the category's
 * description alone, and says what it found.
 */
async function guidelinesOf(forum: Forum): Promise<string> {
  const response = await request(forum, '/guidelines', 'text/html')
  if (response === null) return ''
  const page = await response.text()
  const start = page.indexOf("itemprop='mainContentOfPage'")
  if (start === -1) return ''
  const end = page.indexOf('<footer', start)
  return discourseText(page.slice(page.indexOf('>', start) + 1, end === -1 ? undefined : end))
}

const ENTITIES: Record<string, string> = {
  '&quot;': '"',
  '&#39;': "'",
  '&#x27;': "'",
  '&lt;': '<',
  '&gt;': '>',
  '&nbsp;': ' ',
  '&hellip;': '…',
  '&amp;': '&',
}

/** Discourse writes a post as HTML: a paragraph, a line break, a list item and a heading end a line; a link keeps its text. Plain text. */
export function discourseText(html: string): string {
  return html
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<\/(?:p|li|h\d|pre|blockquote|aside|div)>/g, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(?:quot|#39|#x27|lt|gt|nbsp|hellip|amp);/g, (entity) => ENTITIES[entity] ?? entity)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
