import { z } from 'zod'
import { needsConnection, type Platform } from './platforms'

/**
 * Taking over an X account (docs/plan.md, slice 5): the account's history,
 * brought in from the X data archive, pasted by hand, or read through the X
 * API. The studio parses an archive or a paste in the browser with the
 * functions here and sends the posts in batches; the backend stores them as
 * they come. Import only reads: nothing is posted, liked or followed.
 */

/** Where an imported post came from. `mock` is the history the mock X provider serves until the X API keys exist. */
export const ACCOUNT_POST_SOURCES = ['archive', 'paste', 'api', 'mock'] as const
export type AccountPostSource = (typeof ACCOUNT_POST_SOURCES)[number]

export const ACCOUNT_POST_SOURCE_LABELS: Record<AccountPostSource, string> = {
  archive: 'Archive',
  paste: 'Pasted',
  api: 'X API',
  mock: 'Mock',
}

/** The most posts one import call takes; the studio sends a bigger archive in batches of this size. */
export const IMPORT_BATCH_MAX = 500

/** The platform whose archive and paste the history import reads: X's tweets.js and X's own copy-paste. */
export const ARCHIVE_PLATFORM = 'x' satisfies Platform

/**
 * Whether an account's own posts can come in: from an archive or pasted on
 * X, else through its platform reader, which on a platform that needs a
 * connection reads them once connected.
 */
export function historyCanComeIn(platform: Platform, readsActivity: boolean): boolean {
  return platform === ARCHIVE_PLATFORM || readsActivity || needsConnection(platform)
}

export interface ImportedPost {
  /** The X id of the post (the root's, for a self-thread), or `paste-<hash>` for a pasted post. */
  externalId: string
  /** One entry for a single post, several for a self-thread, root first. */
  parts: string[]
  postedAt: number
  likes: number
  reposts: number
  replies: number
  /**
   * The id of the post or comment it answers, as its platform writes it (a
   * Reddit fullname, a Hacker News item id, an X post id); null for an
   * original. A reply to the account's own X post is part of a thread instead.
   */
  parentId: string | null
  /** Where it is on its platform; null for an archived or pasted post, whose link the import does not know. */
  url: string | null
  /** Where it was said: a subreddit, or Hacker News's Ask, Show or front page; null on X and LinkedIn. */
  community: string | null
  /** The language X detected, as a BCP 47 tag; null when X could not tell (`und`) or did not say. */
  lang: string | null
}

/** What an item says, its parts in one text. */
export function itemTextOf(item: Pick<ImportedPost, 'parts'>): string {
  return item.parts.join('\n\n')
}

/** X archives write counts as strings ("12"); the API writes numbers. */
const countSchema = z.union([z.number().int().nonnegative(), z.string().regex(/^\d+$/).transform(Number)])

/** The fields of one archived post the import reads; X writes many more, and they are ignored. */
const archivedPostSchema = z.object({
  id_str: z.string().min(1),
  full_text: z.string(),
  created_at: z.string(),
  favorite_count: countSchema,
  retweet_count: countSchema,
  reply_count: countSchema.optional(),
  in_reply_to_status_id_str: z.string().nullish(),
  lang: z.string().nullish(),
})
type ArchivedPost = z.infer<typeof archivedPostSchema>

/** tweets.js wraps each post as `{ "tweet": {...} }`; a plain JSON export may not. */
const archiveItemSchema = z.union([z.object({ tweet: archivedPostSchema }), archivedPostSchema])

const NOT_AN_ARCHIVE = 'This is not an X archive tweets.js file.'

/**
 * The posts in an X archive's `tweets.js` (or a plain JSON array of the same
 * items), newest first. Retweets are left out: they are someone else's words.
 * A reply to another post in the file is the account continuing its own
 * thread, so it joins that thread's root as a part, in the order it was
 * posted, and the counts stay the root's. A reply to a post outside the file
 * is a reply to someone else.
 */
export function parseXArchive(fileText: string): ImportedPost[] {
  const archived = readArchive(fileText)
  const kept = archived.filter((post) => !post.full_text.startsWith('RT @'))

  const byId = new Map<string, ArchivedPost>()
  const postedAt = new Map<string, number>()
  for (const post of kept) {
    if (byId.has(post.id_str)) throw new Error(`Post ${post.id_str} appears twice in the file.`)
    byId.set(post.id_str, post)
    const at = Date.parse(post.created_at)
    if (Number.isNaN(at)) throw new Error(`Post ${post.id_str} has a date X archives do not use: ${post.created_at}`)
    postedAt.set(post.id_str, at)
  }
  const timeOf = (post: ArchivedPost): number => {
    const at = postedAt.get(post.id_str)
    if (at === undefined) throw new Error(`post ${post.id_str} has no parsed date`)
    return at
  }

  const continuations = new Map<string, ArchivedPost[]>()
  const roots: ArchivedPost[] = []
  for (const post of kept) {
    const root = threadRootOf(post, byId)
    if (root === post) {
      roots.push(post)
      continue
    }
    const parts = continuations.get(root.id_str) ?? []
    parts.push(post)
    continuations.set(root.id_str, parts)
  }

  const byPostTime = (a: ArchivedPost, b: ArchivedPost) => timeOf(a) - timeOf(b) || compareIds(a.id_str, b.id_str)
  return roots
    .sort((a, b) => byPostTime(b, a))
    .map((root) => {
      const thread = [root, ...(continuations.get(root.id_str) ?? []).sort(byPostTime)]
      return {
        externalId: root.id_str,
        parts: thread.map((post) => decodeEntities(post.full_text)),
        postedAt: timeOf(root),
        likes: root.favorite_count,
        reposts: root.retweet_count,
        // The archive has no reply count; the API does.
        replies: root.reply_count ?? 0,
        parentId: root.in_reply_to_status_id_str ?? null,
        url: null,
        community: null,
        lang: root.lang && root.lang !== 'und' ? root.lang : null,
      }
    })
}

/** The archived posts in the file, every item checked. A file with no post in it is not an archive. */
function readArchive(fileText: string): ArchivedPost[] {
  const start = fileText.indexOf('[')
  if (start === -1) throw new Error(NOT_AN_ARCHIVE)
  // tweets.js is `window.YTD.tweets.part0 = [...]`, sometimes with a closing semicolon.
  const json = fileText.slice(start).trim().replace(/;$/, '')
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    throw new Error(NOT_AN_ARCHIVE)
  }
  if (!Array.isArray(data)) throw new Error(NOT_AN_ARCHIVE)
  const posts: ArchivedPost[] = []
  const unreadable: number[] = []
  for (const [index, item] of data.entries()) {
    const parsed = archiveItemSchema.safeParse(item)
    if (!parsed.success) {
      unreadable.push(index + 1)
      continue
    }
    posts.push('tweet' in parsed.data ? parsed.data.tweet : parsed.data)
  }
  if (posts.length === 0) throw new Error(NOT_AN_ARCHIVE)
  const [first] = unreadable
  if (first !== undefined) throw new Error(`Item ${first} of the file is not an X post (${unreadable.length} items in all).`)
  return posts
}

/** The topmost post in the file this post replies to, through any number of replies; the post itself when it starts a thread. */
function threadRootOf(post: ArchivedPost, byId: Map<string, ArchivedPost>): ArchivedPost {
  const seen = new Set<string>()
  let current = post
  for (;;) {
    seen.add(current.id_str)
    const parentId = current.in_reply_to_status_id_str
    const parent = parentId ? byId.get(parentId) : undefined
    if (!parent) return current
    if (seen.has(parent.id_str)) throw new Error(`Post ${post.id_str} replies in a loop.`)
    current = parent
  }
}

/** X ids are numbers too long for a double; a longer id is a later one, and equal lengths compare as text. */
function compareIds(a: string, b: string): number {
  if (a.length !== b.length) return a.length - b.length
  if (a === b) return 0
  return a < b ? -1 : 1
}

const ENTITIES = new Map([
  ['&amp;', '&'],
  ['&lt;', '<'],
  ['&gt;', '>'],
])

/** X escapes these three in post text. One pass, so `&amp;lt;` stays the literal text `&lt;`. */
function decodeEntities(text: string): string {
  return text.replace(/&(?:amp|lt|gt);/g, (entity) => {
    const char = ENTITIES.get(entity)
    if (char === undefined) throw new Error(`no character for ${entity}`)
    return char
  })
}

/** A line holding only three dashes separates pasted posts. */
const PASTE_SEPARATOR = /^[ \t]*---[ \t]*$/m

/**
 * Posts the operator pasted, separated by a line holding only `---`, in the
 * order pasted; the first is taken as the newest, one minute apart. Pasted
 * posts carry no counts and no language, and each id is a hash of its text,
 * so pasting the same post twice imports it once.
 */
export function parsePastedPosts(text: string, now: number = Date.now()): ImportedPost[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split(PASTE_SEPARATOR)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0)
    .map((post, index) => ({
      externalId: `paste-${stableHash(post)}`,
      parts: [post],
      postedAt: now - index * 60_000,
      likes: 0,
      reposts: 0,
      replies: 0,
      parentId: null,
      url: null,
      community: null,
      lang: null,
    }))
}

/** 32-bit FNV-1a as eight hex digits: stable across runs and browsers, no crypto needed. */
function stableHash(text: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
