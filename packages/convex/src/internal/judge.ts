import { v } from 'convex/values'
import { engages } from '@influstep/shared'
import { internal } from '../_generated/api'
import { internalAction, internalMutation, internalQuery } from '../_generated/server'
import { accountBriefOf } from '../core/accounts'
import { sendBackToWriter } from '../core/posts'
import { providersMode } from '../lib/env'
import { engagementReasonsValidator, judgedWordsValidator, postPartsValidator } from '../lib/validators'
import { llmProvider, type JudgeBrief } from '../providers/llm'

/**
 * The judge (CONTEXT.md, "Judge"): reads each written post from the reader's
 * side and gives the reasons a person would read on, comment, like and
 * follow (shared judge.ts), from how people read and act, never from why the
 * account should post it. Its reading is kept on the post. The first reading
 * of a post, when it reads the writer's words and finds too few reasons,
 * sends it back to the writer once, with what would give them; after that,
 * and on the operator's own words always, the operator sees what is missing
 * and decides.
 */

type JudgeResult = { engages: boolean; sentBack: boolean } | { skipped: string }

export const judgePost = internalAction({
  args: { postId: v.id('posts'), wordsBy: judgedWordsValidator },
  handler: async (ctx, args): Promise<JudgeResult> => {
    const brief: JudgeBrief | null = await ctx.runQuery(internal.internal.judge.judgeContext, { postId: args.postId })
    if (brief === null) return { skipped: 'The post is no longer a draft to judge.' }
    const judged = await llmProvider().judgePost(brief)
    return ctx.runMutation(internal.internal.judge.storeJudgment, {
      postId: args.postId,
      wordsBy: args.wordsBy,
      parts: brief.parts,
      ...judged,
    })
  },
})

/** What the judge reads: a draft's words, where it goes and who it is for; null once it is no draft. */
export const judgeContext = internalQuery({
  args: { postId: v.id('posts') },
  handler: async (ctx, args): Promise<JudgeBrief | null> => {
    const post = await ctx.db.get(args.postId)
    if (!post || post.status !== 'draft' || post.parts === undefined) return null
    const account = await ctx.db.get(post.accountId)
    if (!account) throw new Error(`account ${post.accountId} of post ${post._id} not found`)
    return {
      account: accountBriefOf(account),
      intent: post.intent,
      title: post.title,
      parts: post.parts,
      community: post.community ?? null,
    }
  },
})

/**
 * Keeps the judge's reading of the words it read. Words that changed while it
 * read them were edited by the operator, whose edit queued its own reading,
 * so this one is dropped. A weak first reading of the writer's words sends the
 * draft back to the writer at once (core `sendBackToWriter`), which then
 * writes for the missing reasons; the operator's words are never sent back,
 * even when the judge had not read the draft before.
 */
export const storeJudgment = internalMutation({
  args: {
    postId: v.id('posts'),
    wordsBy: judgedWordsValidator,
    parts: postPartsValidator,
    reasons: engagementReasonsValidator,
    fix: v.string(),
  },
  handler: async (ctx, args): Promise<JudgeResult> => {
    const post = await ctx.db.get(args.postId)
    if (!post || post.status !== 'draft') return { skipped: 'The post is no longer a draft to judge.' }
    if (JSON.stringify(post.parts) !== JSON.stringify(args.parts)) return { skipped: 'Its words changed while the judge read them.' }
    const now = Date.now()
    const round = (post.judgment?.round ?? 0) + 1
    await ctx.db.patch(post._id, {
      judgment: { reasons: args.reasons, fix: args.fix, round, judgedAt: now, mock: providersMode() === 'mock' },
    })
    if (engages(args.reasons)) return { engages: true, sentBack: false }
    if (round > 1 || args.wordsBy === 'operator') return { engages: false, sentBack: false }
    await sendBackToWriter(ctx, post._id)
    return { engages: false, sentBack: true }
  },
})
