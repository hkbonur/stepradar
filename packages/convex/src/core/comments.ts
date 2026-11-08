import {
  COMMENT_STATUS_OF_ANSWER,
  COMMENT_WINDOW_MS,
  REPLY_FRESH_MS,
  postedItemOf,
  type HeardThread,
  type ReplyStatus,
} from '@influstep/shared'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'

/**
 * Comments (shared comments.ts): which of the account's items the comment
 * poll reads under, the comments it stores, which of them still need an
 * answer drafted, and how each one's status follows its answer.
 */

type Reader = { db: QueryCtx['db'] }

/** A comment or a mention as the listener's path hears it: a thread to answer. */
export type HeardComment = HeardThread & { origin: 'comment' | 'mention' }

/** One of the account's items to read the comments under: its id on the platform, and where it was said. */
export interface CommentTarget {
  externalId: string
  community: string | null
}

/**
 * The account's items posted within COMMENT_WINDOW_MS, each once: its posted
 * replies and posts with their id, and the items of its history, which hold
 * what it posted without a draft, each with the community it was said in.
 */
export async function commentTargets(ctx: Reader, accountId: Id<'accounts'>, now: number): Promise<CommentTarget[]> {
  const since = now - COMMENT_WINDOW_MS
  const replies = await ctx.db
    .query('replies')
    .withIndex('by_account_posted', (q) => q.eq('accountId', accountId).gte('posted.at', since))
    .collect()
  const posts = await ctx.db
    .query('posts')
    .withIndex('by_account_posted', (q) => q.eq('accountId', accountId).gte('posted.at', since))
    .collect()
  const history = await ctx.db
    .query('accountPosts')
    .withIndex('by_account_posted', (q) => q.eq('accountId', accountId).gte('postedAt', since))
    .collect()
  const targets = new Map<string, CommentTarget>()
  const add = (externalId: string, community: string | null | undefined) => {
    const known = targets.get(externalId)
    if (known === undefined || known.community === null) targets.set(externalId, { externalId, community: community ?? null })
  }
  for (const reply of replies) {
    const item = postedItemOf(reply.posted)
    if (item) add(item.externalId, reply.thread.community)
  }
  for (const post of posts) {
    const item = postedItemOf(post.posted)
    if (item) add(item.externalId, post.community)
  }
  for (const row of history) add(row.externalId, row.community)
  return [...targets.values()]
}

/** The ids of the comments the poll stored within COMMENT_WINDOW_MS, which a reader skips reading again. */
export async function knownComments(ctx: Reader, accountId: Id<'accounts'>, now: number): Promise<string[]> {
  const rows = await ctx.db
    .query('comments')
    .withIndex('by_account_posted', (q) => q.eq('accountId', accountId).gte('postedAt', now - COMMENT_WINDOW_MS))
    .collect()
  return rows.map((row) => row.externalId)
}

/** Whether the comment `externalId` still waits for its answer: one the operator let go or answered meanwhile gets none. */
export async function commentWaits(ctx: Reader, accountId: Id<'accounts'>, externalId: string): Promise<boolean> {
  return (await commentOf(ctx, accountId, externalId))?.status === 'new'
}

function commentOf(ctx: Reader, accountId: Id<'accounts'>, externalId: string): Promise<Doc<'comments'> | null> {
  return ctx.db
    .query('comments')
    .withIndex('by_account_external', (q) => q.eq('accountId', accountId).eq('externalId', externalId))
    .first()
}

/**
 * Stores the comments heard, each once: waiting for its answer while it is
 * fresh enough to answer (shared REPLY_FRESH_MS), let go when the poll first
 * reads it later than that, so a comment days old gets neither a draft nor a
 * notification. Returns the fresh ones.
 */
export async function storeComments(
  ctx: MutationCtx,
  accountId: Id<'accounts'>,
  heard: { thread: HeardComment; inReplyTo: string | null }[],
  args: { now: number; mock: boolean }
): Promise<Doc<'comments'>[]> {
  const fresh: Doc<'comments'>[] = []
  for (const { thread, inReplyTo } of heard) {
    if ((await commentOf(ctx, accountId, thread.externalId)) !== null) continue
    const isFresh = args.now - thread.postedAt <= REPLY_FRESH_MS[thread.origin]
    const commentId = await ctx.db.insert('comments', {
      accountId,
      externalId: thread.externalId,
      inReplyTo: inReplyTo ?? undefined,
      author: thread.author,
      text: thread.text,
      url: thread.url,
      community: thread.community ?? undefined,
      postedAt: thread.postedAt,
      status: isFresh ? 'new' : 'dismissed',
      heardAt: args.now,
      mock: args.mock,
    })
    if (!isFresh) continue
    const stored = await ctx.db.get(commentId)
    if (stored === null) throw new Error(`comment ${commentId} vanished as it was stored`)
    fresh.push(stored)
  }
  return fresh
}

/**
 * The account's waiting comments with no answer yet, as threads for the
 * listener's path: a pass that failed, or left one out until its
 * community's rules can be read, is taken up by the next poll.
 */
export async function commentsToAnswer(ctx: Reader, accountId: Id<'accounts'>): Promise<HeardComment[]> {
  const waiting = await ctx.db
    .query('comments')
    .withIndex('by_account_status', (q) => q.eq('accountId', accountId).eq('status', 'new'))
    .collect()
  const unanswered: HeardComment[] = []
  for (const comment of waiting) {
    const answer = await ctx.db
      .query('replies')
      .withIndex('by_account_target', (q) => q.eq('accountId', accountId).eq('inReplyTo', comment.externalId))
      .first()
    if (answer === null) unanswered.push(heardOf(comment))
  }
  return unanswered
}

function heardOf(comment: Doc<'comments'>): HeardComment {
  return {
    origin: comment.inReplyTo === undefined ? 'mention' : 'comment',
    externalId: comment.externalId,
    url: comment.url,
    title: null,
    text: comment.text,
    postedAt: comment.postedAt,
    author: comment.author,
    reach: null,
    community: comment.community ?? null,
    pillar: null,
    comments: null,
  }
}

/**
 * A comment follows its answer (shared COMMENT_STATUS_OF_ANSWER): waiting
 * while the answer is, answered when it went out, let go when it was passed
 * on. One the operator answered stays answered.
 */
export async function followAnswer(
  ctx: MutationCtx,
  accountId: Id<'accounts'>,
  commentId: string,
  answer: ReplyStatus | null
): Promise<void> {
  const comment = await commentOf(ctx, accountId, commentId)
  if (comment === null || comment.status === 'answered') return
  const status = answer === null ? 'dismissed' : COMMENT_STATUS_OF_ANSWER[answer]
  if (status !== comment.status) await ctx.db.patch(comment._id, { status })
}

/**
 * The account's waiting comments with no answer, past the time a comment
 * stays fresh (shared REPLY_FRESH_MS), are let go: no pass drafted one in
 * time (replies off, the account paused, the community's rules unread), and
 * an answer now would come too late.
 */
export async function expireComments(ctx: MutationCtx, accountId: Id<'accounts'>, now: number): Promise<number> {
  const waiting = await ctx.db
    .query('comments')
    .withIndex('by_account_status', (q) => q.eq('accountId', accountId).eq('status', 'new'))
    .collect()
  let expired = 0
  for (const comment of waiting) {
    const origin = comment.inReplyTo === undefined ? 'mention' : 'comment'
    if (now - comment.postedAt <= REPLY_FRESH_MS[origin]) continue
    const answer = await ctx.db
      .query('replies')
      .withIndex('by_account_target', (q) => q.eq('accountId', accountId).eq('inReplyTo', comment.externalId))
      .first()
    if (answer !== null) continue
    await ctx.db.patch(comment._id, { status: 'dismissed' })
    expired += 1
  }
  return expired
}

/** The account's comments among `externalIds` are answered: an item of the operator's under each went out, drafted or not. */
export async function answerComments(ctx: MutationCtx, accountId: Id<'accounts'>, externalIds: string[]): Promise<number> {
  let answered = 0
  for (const externalId of new Set(externalIds)) {
    const comment = await commentOf(ctx, accountId, externalId)
    if (comment === null || comment.status === 'answered') continue
    await ctx.db.patch(comment._id, { status: 'answered' })
    answered += 1
  }
  return answered
}
