import { communityLabel, parseThreadLink, placeOf } from '@influstep/shared'
import { v } from 'convex/values'
import type { Id } from '../_generated/dataModel'
import { mutation, query, action } from '../_generated/server'
import { listens } from '../core/formats'
import { askForReply, markReplyPosted, openReply, repliesView, skipReply } from '../core/replies'
import { enqueueJob } from '../jobs/queue'
import { cannotRead } from '../providers/platforms'
import { refusal } from '../lib/errors'
import { accountRefOf } from '../core/accounts'
import { accountReader } from '../core/connections'
import { classifierProvider, classifyBriefOf } from '../providers/classifier'
import { internal } from '../_generated/api'
import { readCommunityRules } from '../internal/communities'
import { actionReader } from '../internal/connections'

/** The replies page: the account's replies by where they stand, and today's budget. */
export const list = query({
  args: { accountId: v.id('accounts') },
  handler: async (ctx, args) => {
    const account = await ctx.db.get(args.accountId)
    if (!account) return null
    const reader = await accountReader(ctx, account)
    return {
      account: { ...accountRefOf(account), paused: account.paused },
      // Whether the listener searches the account's platform; where it cannot, pasting a thread is how a reply starts.
      searches: reader.search !== undefined,
      // Whether the analyst reads a posted reply's numbers there; where it cannot, the page says so instead of waiting.
      readsCounts: reader.counts !== undefined,
      ...(await repliesView(ctx, account, Date.now())),
    }
  },
})

/** The operator posted a draft by hand, in these words; the link, when given, is how the analyst finds its numbers. */
export const markPosted = mutation({
  args: { replyId: v.id('replies'), text: v.string(), url: v.optional(v.string()) },
  handler: async (ctx, args): Promise<void> => {
    await markReplyPosted(ctx, args.replyId, { text: args.text, url: args.url }, Date.now())
  },
})

/** The operator passes on a draft. */
export const skip = mutation({
  args: { replyId: v.id('replies') },
  handler: async (ctx, args): Promise<void> => {
    await skipReply(ctx, args.replyId)
  },
})

/** The operator asks for a reply to a post the account passed on; the writer drafts one for them. */
export const ask = mutation({
  args: { replyId: v.id('replies') },
  handler: async (ctx, args): Promise<void> => {
    await askForReply(ctx, args.replyId)
  },
})

/** Listen now instead of at the next hourly sweep. */
export const listenNow = mutation({
  args: { accountId: v.id('accounts') },
  handler: async (ctx, args) => {
    const account = await ctx.db.get(args.accountId)
    if (!account) throw new Error(`account ${args.accountId} not found`)
    if (!listens(account)) throw refusal(`${account.name} answers nobody: give it a reply budget above 0 first.`)
    const reader = await accountReader(ctx, account)
    if (!reader.search) throw refusal(cannotRead(placeOf(account), 'search'))
    return enqueueJob(ctx, { kind: 'listen', accountId: account._id })
  },
})

/**
 * Answer a thread the listener cannot hear (on X and LinkedIn, where no
 * reader searches): its link and the text to answer become a reply the
 * operator asked for, which the writer drafts. Where the link names no
 * community, the reader says where the thread was said, when it can (a
 * forum topic's category).
 */
export const pasteThread = action({
  args: { accountId: v.id('accounts'), url: v.string(), text: v.string() },
  handler: async (ctx, args): Promise<Id<'replies'>> => {
    const { account, workspace, connection } = await ctx.runQuery(internal.internal.data.getAccount, { accountId: args.accountId })
    const parsed = parseThreadLink(placeOf(account), args.url)
    if (parsed.kind === 'invalid') throw refusal(parsed.problem)
    const reader = actionReader(ctx, account, connection)
    const said = parsed.community ?? (reader.community ? await reader.community(parsed.externalId) : null)
    const link = { ...parsed, community: said }
    // The writer answers only where it knows the community's rules (docs/plan.md, ground rule 3).
    if (link.community !== null) {
      const { unread } = await readCommunityRules(ctx, account, reader, [link.community])
      const [failed] = unread
      if (failed) throw refusal(`Influstep could not read the rules of ${communityLabel(account.platform, failed.name)}: ${failed.error}`)
    }
    const text = args.text.trim()
    if (text === '') throw refusal('Paste the text you want to answer.')
    const [fit] = await classifierProvider().classify(classifyBriefOf(account, workspace, [{ origin: 'pasted', text }]))
    if (fit === undefined) throw new Error('the classifier read no pasted thread')
    return ctx.runMutation(internal.internal.replies.storePastedMutation, { accountId: account._id, link, text, fit })
  },
})

/** The operator copied a draft or opened the thread it answers. */
export const opened = mutation({
  args: { replyId: v.id('replies') },
  handler: async (ctx, args) => openReply(ctx, args.replyId, Date.now()),
})
