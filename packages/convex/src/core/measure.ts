import { MEASUREMENT_WINDOW_MS, postedItemOf, type AccountReach, type ItemCounts } from '@influstep/shared'
import type { Infer } from 'convex/values'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import type { itemRefValidator } from '../lib/validators'
import { recordRemoval } from './communities'
import { postedSince } from './posted'
import { closeMeasuredPosts } from './posts'
import { closeMeasuredReplies } from './replies'

/**
 * Measuring (CONTEXT.md, "Measurement window"): the analyst reads the numbers
 * of every post and reply in its measurement window that has the id its
 * platform knows it by, keeps the latest on the row and each read as a
 * snapshot, reads the account's karma or followers, and marks what is past
 * the window measured.
 */

type Reader = { db: QueryCtx['db'] }

/** The post or the reply a read of numbers is of. */
export type ItemRef = Infer<typeof itemRefValidator>

/** A posted post or reply whose numbers the analyst reads: its id on the platform, and when it went out. */
export interface ToMeasure {
  item: ItemRef
  externalId: string
  postedAt: number
}

/**
 * The account's posts and replies posted within MEASUREMENT_WINDOW_MS with
 * the id their platform knows them by: found by the match, or given by the
 * operator's link. One marked posted without a link has no numbers to read.
 */
export async function itemsToMeasure(ctx: Reader, accountId: Id<'accounts'>, now: number): Promise<ToMeasure[]> {
  const { posts, replies } = await postedSince(ctx, accountId, now - MEASUREMENT_WINDOW_MS)
  return [
    ...posts.flatMap((post) => readable(post, { kind: 'post', postId: post._id })),
    ...replies.flatMap((reply) => readable(reply, { kind: 'reply', replyId: reply._id })),
  ]
}

/** A post or a reply, as a removal is recorded on it. */
async function rowOf(ctx: Reader, item: ItemRef) {
  if (item.kind === 'post') {
    const row = await ctx.db.get(item.postId)
    if (!row) throw new Error(`post ${item.postId} not found`)
    return { kind: 'post' as const, row }
  }
  const row = await ctx.db.get(item.replyId)
  if (!row) throw new Error(`reply ${item.replyId} not found`)
  return { kind: 'reply' as const, row }
}

/** An item the analyst reads: one with the id its platform knows it by, that its community has not removed. */
function readable(row: Doc<'posts'> | Doc<'replies'>, item: ItemRef): ToMeasure[] {
  const posted = postedItemOf(row.posted)
  if (posted === null || row.removedAt !== undefined) return []
  return [{ item, externalId: posted.externalId, postedAt: posted.at }]
}

/**
 * The numbers read, each on its post or reply and as a snapshot, the items
 * their community removed (core/communities.ts `recordRemoval`), and the
 * account's reach, in one write.
 */
export async function storeNumbers(
  ctx: MutationCtx,
  accountId: Id<'accounts'>,
  read: { numbers: { item: ItemRef; counts: ItemCounts }[]; removed: ItemRef[]; reach: AccountReach | null; mock: boolean },
  now: number
): Promise<void> {
  if (read.removed.length > 0) {
    const account = await ctx.db.get(accountId)
    if (!account) throw new Error(`account ${accountId} not found`)
    for (const item of read.removed) await recordRemoval(ctx, account, await rowOf(ctx, item), now)
  }
  for (const { item, counts } of read.numbers) {
    const before = (await rowOf(ctx, item)).row.numbers?.counts
    const numbers = { counts, readAt: now, mock: read.mock, before }
    if (item.kind === 'post') await ctx.db.patch(item.postId, { numbers })
    else await ctx.db.patch(item.replyId, { numbers })
    await ctx.db.insert('metricSnapshots', { accountId, item, takenAt: now, counts, mock: read.mock })
  }
  if (read.reach !== null) await ctx.db.insert('accountSnapshots', { accountId, takenAt: now, reach: read.reach, mock: read.mock })
}

/** The account's posts and replies past their measurement window become measured. */
export async function closeMeasured(ctx: MutationCtx, accountId: Id<'accounts'>, now: number): Promise<{ posts: number; replies: number }> {
  return { posts: await closeMeasuredPosts(ctx, accountId, now), replies: await closeMeasuredReplies(ctx, accountId, now) }
}
