import { v } from 'convex/values'
import { COMMENT_WINDOW_MS, REPLY_FRESH_MS, placeLabel, placeOf, sameHandle } from '@influstep/shared'
import { internal } from '../_generated/api'
import { internalAction, internalMutation, internalQuery } from '../_generated/server'
import {
  commentTargets,
  commentsToAnswer,
  expireComments,
  knownComments,
  storeComments,
  type CommentTarget,
  type HeardComment,
} from '../core/comments'
import { refusal } from '../lib/errors'
import { providersMode } from '../lib/env'
import { heardCommentValidator } from '../lib/validators'
import { cannotRead, type PlatformComment } from '../providers/platforms'
import { actionReader } from './connections'
import { queueCommentNotification } from '../core/notifications'
import { listens } from '../core/formats'
import { judgeAndStore, type HeardResult } from './replies'

/**
 * The researcher's comment poll (docs/plan.md, slice 6): the comments under
 * the account's items posted within COMMENT_WINDOW_MS and the mentions of
 * the account. Each comment is stored once, and every one is a signal the
 * problem log and the comment digest read, as before. Then every waiting
 * comment with no answer yet goes down the listener's path to an answer
 * draft, while the account answers people (a reply budget above 0); with
 * replies off, the operator answers it in their own words. Reading only.
 */
export const poll = internalAction({
  args: { accountId: v.id('accounts') },
  handler: async (ctx, args): Promise<{ comments: number; drafting: HeardResult | null }> => {
    const accountId = args.accountId
    const { account, workspace, connection } = await ctx.runQuery(internal.internal.data.getAccount, { accountId })
    const reader = actionReader(ctx, account, connection)
    // The schedule queues this only for a reader that reads comments or mentions, so one that cannot changed since.
    if (!reader.comments && !reader.mentions) throw refusal(cannotRead(placeOf(account), 'comments'))
    const now = Date.now()
    const { items, known } = await ctx.runQuery(internal.internal.comments.toRead, { accountId })
    const ids = items.map((item) => item.externalId)
    const read =
      reader.comments && ids.length > 0 ? await reader.comments({ items: ids, since: now - COMMENT_WINDOW_MS, known: new Set(known) }) : []
    // A comment is said where the item it answers is, when its reader does not say (a forum's post names no category).
    const whereSaid = new Map(items.map((item) => [item.externalId, item.community]))
    // The operator's own words under their items (a reply in their own thread) are no comment to answer.
    const comments = read.filter((comment) => !sameHandle(comment.author.handle, account.handle))
    const mentions = reader.mentions ? await reader.mentions({ handle: account.handle, since: now - REPLY_FRESH_MS.mention }) : []
    const heard = [
      ...comments.map((comment) => ({ thread: heardOf(comment, whereSaid.get(comment.parentId) ?? null), inReplyTo: comment.parentId })),
      ...mentions.map((thread) => ({ thread, inReplyTo: null })),
    ]
    await ctx.runMutation(internal.internal.comments.store, { accountId, heard, mock: providersMode() === 'mock' })
    await ctx.runMutation(internal.internal.researcher.storeSignals, {
      accountId,
      mock: providersMode() === 'mock',
      signals: comments.map((comment) => ({
        source: 'comments' as const,
        externalId: comment.externalId,
        title: comment.text.slice(0, 120),
        url: comment.url,
        summary: `${comment.likes} likes, from ${comment.author.handle} on ${placeLabel(placeOf(account))}`,
        score: comment.likes * 5 + 5,
        topics: [account.platform],
        publishedAt: comment.at,
      })),
    })
    if (!listens(account)) return { comments: heard.length, drafting: null }
    const unanswered: HeardComment[] = await ctx.runQuery(internal.internal.comments.unanswered, { accountId })
    const drafting = unanswered.length === 0 ? null : await judgeAndStore(ctx, { account, workspace, reader }, unanswered)
    return { comments: heard.length, drafting }
  },
})

/** A comment as the listener's path hears it: a thread under the account's item, said where the platform says, else where the item was. */
function heardOf(comment: PlatformComment, itemCommunity: string | null): HeardComment {
  return {
    origin: 'comment',
    externalId: comment.externalId,
    url: comment.url,
    title: null,
    text: comment.text,
    postedAt: comment.at,
    author: comment.author,
    reach: null,
    community: comment.community ?? itemCommunity,
    pillar: null,
    comments: null,
  }
}

/** The account's items to read under, and the comments read before. */
export const toRead = internalQuery({
  args: { accountId: v.id('accounts') },
  handler: async (ctx, args): Promise<{ items: CommentTarget[]; known: string[] }> => ({
    items: await commentTargets(ctx, args.accountId, Date.now()),
    known: await knownComments(ctx, args.accountId, Date.now()),
  }),
})

export const unanswered = internalQuery({
  args: { accountId: v.id('accounts') },
  handler: async (ctx, args): Promise<HeardComment[]> => commentsToAnswer(ctx, args.accountId),
})

export const store = internalMutation({
  args: {
    accountId: v.id('accounts'),
    heard: v.array(v.object({ thread: heardCommentValidator, inReplyTo: v.union(v.string(), v.null()) })),
    mock: v.boolean(),
  },
  handler: async (ctx, args): Promise<void> => {
    const now = Date.now()
    await expireComments(ctx, args.accountId, now)
    const fresh = await storeComments(ctx, args.accountId, args.heard, { now, mock: args.mock })
    if (fresh.length === 0) return
    // One poll's comments are one notification: the batch within ten minutes the plan asks for.
    const account = await ctx.db.get(args.accountId)
    if (!account) throw new Error(`account ${args.accountId} not found`)
    await queueCommentNotification(ctx, account, fresh, { now, mock: args.mock })
  },
})
