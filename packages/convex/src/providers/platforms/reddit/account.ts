import type { AccountReach, ImportedPost } from '@influstep/shared'
import { z } from 'zod'
import type { ActivityQuery, CommentsQuery, CountedItem, CountsQuery, HeardMention, MentionsQuery, PlatformComment } from '../types'
import type { RedditSession } from './oauth'

/** A post (t3) or a comment (t1) as Reddit lists them; `raw_json=1` keeps the text unescaped. A fullname is kind and id, t3_abc. */
const postSchema = z.object({
  kind: z.literal('t3'),
  data: z.object({
    name: z.string(),
    title: z.string(),
    selftext: z.string(),
    score: z.number(),
    num_comments: z.number(),
    created_utc: z.number(),
    subreddit: z.string(),
    permalink: z.string(),
    // Who removed it: its subreddit's moderators, Reddit, or its author ("deleted"); null while it stands.
    removed_by_category: z.string().nullable().optional(),
  }),
})
const commentSchema = z.object({
  kind: z.literal('t1'),
  data: z.object({
    name: z.string(),
    body: z.string(),
    score: z.number(),
    created_utc: z.number(),
    parent_id: z.string(),
    subreddit: z.string(),
    permalink: z.string(),
  }),
})
/** A "load more" stub in a comment tree: no comment of its own. */
const moreSchema = z.object({ kind: z.literal('more') })

const thingSchema = z.discriminatedUnion('kind', [postSchema, commentSchema, moreSchema])
const listingSchema = z.object({ data: z.object({ children: z.array(thingSchema) }) })

/** How many of the account's newest posts and comments an import reads: Reddit's largest page. */
const ACTIVITY_ITEMS = 100

/**
 * The account's newest posts and comments as its history. A post keeps its
 * title and text; a comment is a reply. Reddit lists no reply count beside a
 * comment and names no language. Fullnames are the ids, so the match can
 * tell a post from a comment (docs/plan.md, slice 5).
 */
export async function redditActivity(session: RedditSession, query: ActivityQuery): Promise<ImportedPost[]> {
  const listing = listingSchema.parse(
    await session.get(`/user/${encodeURIComponent(query.handle)}/overview?limit=${ACTIVITY_ITEMS}&raw_json=1`)
  )
  return listing.data.children.flatMap((thing): ImportedPost[] => {
    if (thing.kind === 'more' || thing.data.created_utc * 1000 < query.since) return []
    const base = {
      externalId: thing.data.name,
      postedAt: thing.data.created_utc * 1000,
      likes: thing.data.score,
      reposts: 0,
      url: `https://www.reddit.com${thing.data.permalink}`,
      community: thing.data.subreddit,
      lang: null,
    }
    if (thing.kind === 't3') {
      const text = thing.data.selftext === '' ? thing.data.title : `${thing.data.title}\n\n${thing.data.selftext}`
      return [{ ...base, parts: [text], replies: thing.data.num_comments, parentId: null }]
    }
    return [{ ...base, parts: [thing.data.body], replies: 0, parentId: thing.data.parent_id }]
  })
}

/** How many fullnames Reddit's info endpoint takes at once. */
const INFO_BATCH = 100

/**
 * The account's items' numbers by their fullnames, a hundred at a time: a
 * post's score and comment count, a comment's score; Reddit counts no
 * comments under a comment. Reddit fuzzes every score. A post its
 * subreddit's moderators or Reddit removed, or a comment whose text reads
 * "[removed]", is removed; one its author deleted, or Reddit no longer
 * shows, is left out. Not yet checked against a live removed post.
 */
export async function redditCounts(session: RedditSession, items: readonly CountsQuery[]): Promise<CountedItem[]> {
  const counted: CountedItem[] = []
  for (let start = 0; start < items.length; start += INFO_BATCH) {
    const ids = items.slice(start, start + INFO_BATCH).map((item) => item.externalId)
    const listing = listingSchema.parse(await session.get(`/api/info?id=${ids.map(encodeURIComponent).join(',')}&raw_json=1`))
    for (const thing of listing.data.children) {
      if (thing.kind === 'more') continue
      const externalId = thing.data.name
      if (thing.kind === 't3') {
        const removedBy = thing.data.removed_by_category ?? null
        if (removedBy === 'deleted' || removedBy === 'author') continue
        if (removedBy !== null) counted.push({ externalId, removed: true })
        else counted.push({ externalId, counts: { platform: 'reddit', score: thing.data.score, replies: thing.data.num_comments } })
        continue
      }
      if (thing.data.body === '[removed]') counted.push({ externalId, removed: true })
      else if (thing.data.body !== '[deleted]')
        counted.push({ externalId, counts: { platform: 'reddit', score: thing.data.score, replies: null } })
    }
  }
  return counted
}

const aboutSchema = z.object({ data: z.object({ link_karma: z.number(), comment_karma: z.number() }) })

/** The account's link and comment karma. */
export async function redditAccount(session: RedditSession, handle: string): Promise<AccountReach> {
  const about = aboutSchema.parse(await session.get(`/user/${encodeURIComponent(handle)}/about?raw_json=1`))
  return { platform: 'reddit', linkKarma: about.data.link_karma, commentKarma: about.data.comment_karma }
}

/** A message in the account's inbox: a comment (t1) answering it or naming it, or a private message (t4), which it skips. */
const answersSchema = z.object({
  data: z.object({
    children: z.array(
      z.discriminatedUnion('kind', [
        z.object({
          kind: z.literal('t1'),
          data: z.object({
            name: z.string(),
            author: z.string(),
            body: z.string(),
            created_utc: z.number(),
            context: z.string(),
            parent_id: z.string(),
            subreddit: z.string(),
            type: z.string(),
          }),
        }),
        z.object({ kind: z.literal('t4') }),
      ])
    ),
  }),
})

/** The inbox types that answer one of the account's comments or posts; a username mention is heard as a mention. */
const ANSWER_TYPES = new Set(['comment_reply', 'post_reply'])

/**
 * The comments answering the account since a time, from its inbox, one call
 * whatever the items: Reddit puts every answer there with what it answers.
 * The inbox shows no score.
 */
export async function redditComments(session: RedditSession, query: CommentsQuery): Promise<PlatformComment[]> {
  const inbox = answersSchema.parse(await session.get('/message/inbox?limit=100&raw_json=1'))
  return inbox.data.children.flatMap((thing): PlatformComment[] => {
    if (thing.kind !== 't1' || !ANSWER_TYPES.has(thing.data.type) || thing.data.created_utc * 1000 < query.since) return []
    const { data } = thing
    return [
      {
        externalId: data.name,
        parentId: data.parent_id,
        author: { handle: data.author, name: data.author },
        text: data.body,
        url: `https://www.reddit.com${data.context}`,
        community: data.subreddit,
        likes: 0,
        at: data.created_utc * 1000,
      },
    ]
  })
}

/** A message in the account's inbox: a mention is a comment that names the account. */
const messageSchema = z.object({
  kind: z.literal('t1'),
  data: z.object({
    name: z.string(),
    author: z.string(),
    body: z.string(),
    created_utc: z.number(),
    subreddit: z.string(),
    context: z.string(),
    link_title: z.string(),
  }),
})
const mentionsSchema = z.object({ data: z.object({ children: z.array(messageSchema) }) })

/**
 * The comments that mention the account since a time, from its inbox, as
 * threads the reply answers by the comment's fullname. Answers under the
 * account's own posts are the comment poll's (docs/plan.md, slice 6), so
 * only mentions are read here. Reddit lists no score beside a message.
 */
export async function redditMentions(session: RedditSession, query: MentionsQuery): Promise<HeardMention[]> {
  const inbox = mentionsSchema.parse(await session.get('/message/mentions?limit=100&raw_json=1'))
  return inbox.data.children
    .filter(({ data }) => data.created_utc * 1000 >= query.since)
    .map(({ data }) => ({
      origin: 'mention',
      externalId: data.name,
      url: `https://www.reddit.com${data.context}`,
      title: data.link_title,
      text: data.body,
      postedAt: data.created_utc * 1000,
      author: { handle: data.author, name: data.author },
      reach: null,
      community: data.subreddit,
      pillar: null,
      comments: null,
    }))
}
