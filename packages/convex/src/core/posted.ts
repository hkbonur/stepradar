import { countsClicks, itemTextOf, postedItemOf, type ConversionKind, type ItemRead, type Platform, type Posted } from '@influstep/shared'
import type { Doc, Id } from '../_generated/dataModel'
import type { QueryCtx } from '../_generated/server'

/**
 * What went out: the account's posts and replies posted since a time, as the
 * match looks at them, the analyst measures them and the report and the
 * Posted page list them, with what each post did for the sponsor.
 */

type Reader = { db: QueryCtx['db'] }

/** The account's posts and replies posted since a time. */
export interface PostedRows {
  posts: Doc<'posts'>[]
  replies: Doc<'replies'>[]
}

export async function postedSince(ctx: Reader, accountId: Id<'accounts'>, since: number): Promise<PostedRows> {
  const posts = await ctx.db
    .query('posts')
    .withIndex('by_account_posted', (q) => q.eq('accountId', accountId).gte('posted.at', since))
    .collect()
  const replies = await ctx.db
    .query('replies')
    .withIndex('by_account_posted', (q) => q.eq('accountId', accountId).gte('posted.at', since))
    .collect()
  return { posts, replies }
}

/** Whether any of the account's drafts went out yet, a post or a reply: what it posted without a draft is not counted. */
export async function wentOutYet(ctx: Reader, accountId: Id<'accounts'>): Promise<boolean> {
  const post = await ctx.db
    .query('posts')
    .withIndex('by_account_posted', (q) => q.eq('accountId', accountId).gte('posted.at', 0))
    .first()
  if (post !== null) return true
  const reply = await ctx.db
    .query('replies')
    .withIndex('by_account_posted', (q) => q.eq('accountId', accountId).gte('posted.at', 0))
    .first()
  return reply !== null
}

/** The clicks on every tracked link of one post up to `until`: what it brought within its measurement window. */
export async function postClicksUntil(ctx: Reader, postId: Id<'posts'>, until: number): Promise<number> {
  let clicks = 0
  for (const link of await ctx.db
    .query('links')
    .withIndex('by_post', (q) => q.eq('postId', postId))
    .collect()) {
    const reads = await ctx.db
      .query('linkClicks')
      .withIndex('by_link', (q) => q.eq('linkId', link._id))
      .collect()
    clicks += reads.filter((click) => click.at <= until).length
  }
  return clicks
}

/** The clicks on every tracked link of one post. */
export async function postClicks(ctx: Reader, postId: Id<'posts'>): Promise<number> {
  const links = await ctx.db
    .query('links')
    .withIndex('by_post', (q) => q.eq('postId', postId))
    .collect()
  return links.reduce((sum, link) => sum + link.clicks, 0)
}

/** A post's clicks as the report shows them: null on a platform whose posts link to the sponsor directly (shared `countsClicks`). */
export async function shownClicks(ctx: Reader, platform: Platform, postId: Id<'posts'>): Promise<number | null> {
  return countsClicks(platform) ? postClicks(ctx, postId) : null
}

export type ConversionLike = { kind: ConversionKind; mock: boolean }

/** The conversions of each kind, and what the paid ones are worth. */
export function countConversions(conversions: readonly ConversionLike[], valuePerPaid: number) {
  const count = (kind: ConversionKind) => conversions.filter((conversion) => conversion.kind === kind).length
  const paid = count('paid')
  return {
    demos: count('demo_started'),
    signups: count('signup'),
    trials: count('trial_started'),
    paid,
    value: paid * valuePerPaid,
  }
}

/** What an item that went out says, where and when, and what it brought back: the analyst's last read, or none yet. */
interface PostedBase {
  postedAt: number
  url: string | null
  community: string | null
  numbers: ItemRead | null
  editShare: number | null
  /** The id the platform knows it by; the comments under it name it. Null for one marked posted without a link and not found yet. */
  externalId: string | null
}

/**
 * Something that went out, as the report and the Posted page list it: a post,
 * which brings clicks and conversions too, a reply, or, on the Posted page,
 * an item the operator posted without a draft, which the analyst does not
 * measure.
 */
export type PostedItem =
  | (PostedBase & {
      kind: 'post'
      _id: Id<'posts'>
      title: string
      status: Doc<'posts'>['status']
      sponsorSegment: Doc<'posts'>['sponsorSegment']
      /** Null where the post links to the sponsor directly (shared `countsClicks`). */
      clicks: number | null
      signups: number
      paid: number
      value: number
    })
  | (PostedBase & {
      kind: 'reply'
      _id: Id<'replies'>
      text: string
      /** What it answers: the thread's title, or its text where it has none. */
      answers: string
      status: Doc<'replies'>['status']
    })
  | (PostedBase & { kind: 'item'; _id: Id<'accountPosts'>; text: string })

/**
 * The posts and replies read for a window, newest first, with their numbers
 * and, for a post, its clicks and the conversions it brought, from the
 * window's conversions: one that a post brought came after it went out.
 */
export async function postedItems(
  ctx: Reader,
  account: Doc<'accounts'>,
  rows: PostedRows,
  conversions: readonly Doc<'conversions'>[],
  valuePerPaid: number
): Promise<PostedItem[]> {
  const items: PostedItem[] = []
  for (const post of rows.posts) {
    if (post.posted === undefined) continue
    const { signups, paid, value } = countConversions(
      conversions.filter((conversion) => conversion.postId === post._id),
      valuePerPaid
    )
    items.push({
      ...baseOf(post, post.posted, post.community ?? null),
      kind: 'post',
      _id: post._id,
      title: post.title,
      status: post.status,
      sponsorSegment: post.sponsorSegment,
      clicks: await shownClicks(ctx, account.platform, post._id),
      signups,
      paid,
      value,
    })
  }
  for (const reply of rows.replies) {
    if (reply.posted === undefined) continue
    items.push({
      ...baseOf(reply, reply.posted, reply.thread.community),
      kind: 'reply',
      _id: reply._id,
      text: reply.text,
      answers: reply.thread.title ?? reply.thread.text,
      status: reply.status,
    })
  }
  return items.sort((a, b) => b.postedAt - a.postedAt)
}

function baseOf(row: Doc<'posts'> | Doc<'replies'>, posted: Posted, community: string | null): PostedBase {
  const item = postedItemOf(posted)
  return {
    postedAt: posted.at,
    url: item?.url ?? null,
    community,
    numbers: row.numbers ?? null,
    editShare: posted.editShare ?? null,
    externalId: item?.externalId ?? null,
  }
}

/**
 * The account's own items posted since `since` that no post or reply points
 * at: what the operator posted without a draft (CONTEXT.md, "Match"), as the
 * reader listed it. The analyst does not measure them, so they carry no
 * numbers.
 */
export async function itemsWithoutDraft(ctx: Reader, accountId: Id<'accounts'>, since: number, rows: PostedRows): Promise<PostedItem[]> {
  const drafted = new Set([...rows.posts, ...rows.replies].flatMap((row) => postedItemOf(row.posted)?.externalId ?? []))
  const items = await ctx.db
    .query('accountPosts')
    .withIndex('by_account_posted', (q) => q.eq('accountId', accountId).gte('postedAt', since))
    .collect()
  return items.flatMap((item): PostedItem[] => {
    if (drafted.has(item.externalId)) return []
    return [
      {
        kind: 'item',
        _id: item._id,
        text: itemTextOf(item),
        postedAt: item.postedAt,
        url: item.url ?? null,
        community: item.community ?? null,
        numbers: null,
        editShare: null,
        externalId: item.externalId,
      },
    ]
  })
}
