import { v } from 'convex/values'
import { mutation, query } from '../_generated/server'
import { editPost, killPost, markPostPosted, reschedulePost, retryPost, rewritePost, postBeingWritten, skipPost } from '../core/posts'
import { shownClicks } from '../core/posted'
import { postPartsValidator } from '../lib/validators'

export const get = query({
  args: { postId: v.id('posts') },
  handler: async (ctx, args) => {
    const post = await ctx.db.get(args.postId)
    if (!post) return null
    const account = await ctx.db.get(post.accountId)
    if (!account) return null
    const jobs = (
      await ctx.db
        .query('jobs')
        .withIndex('by_post', (q) => q.eq('postId', post._id))
        .collect()
    ).sort((a, b) => b.createdAt - a.createdAt)
    const signals = []
    for (const signalId of post.signalIds) {
      const signal = await ctx.db.get(signalId)
      if (signal) signals.push(signal)
    }
    // What this post did for the sponsor: the clicks on its tracked links.
    const clicks = await shownClicks(ctx, account.platform, post._id)
    return {
      post,
      account,
      jobs,
      // An idea the writer is on now (core `postBeingWritten`, as the calendar and the account page read it).
      writing: post.status === 'idea' && (await postBeingWritten(ctx, post._id)),
      signals,
      clicks,
    }
  },
})

/** Save a post the operator edited. It refuses with the first thing X would not take (shared `postProblems`). */
export const updatePost = mutation({
  args: { postId: v.id('posts'), title: v.string(), parts: postPartsValidator },
  handler: async (ctx, args) => editPost(ctx, args.postId, { title: args.title, parts: args.parts }),
})

/** The operator posted the draft on X by hand, in these words; the link, when given, is how the analyst finds its numbers. */
export const markPosted = mutation({
  args: { postId: v.id('posts'), title: v.string(), parts: postPartsValidator, url: v.optional(v.string()) },
  handler: async (ctx, args) => markPostPosted(ctx, args.postId, { title: args.title, parts: args.parts, url: args.url }, Date.now()),
})

export const skip = mutation({
  args: { postId: v.id('posts') },
  handler: async (ctx, args) => skipPost(ctx, args.postId),
})

export const kill = mutation({
  args: { postId: v.id('posts') },
  handler: async (ctx, args) => killPost(ctx, args.postId),
})

/** Send the post back to the writer (core `rewritePost`). */
export const rewrite = mutation({
  args: { postId: v.id('posts') },
  handler: async (ctx, args) => rewritePost(ctx, args.postId, Date.now()),
})

/** Retry a failed post (core `retryPost`). */
export const retry = mutation({
  args: { postId: v.id('posts') },
  handler: async (ctx, args) => retryPost(ctx, args.postId, Date.now()),
})

export const reschedule = mutation({
  args: { postId: v.id('posts'), plannedFor: v.string() },
  handler: async (ctx, args) => reschedulePost(ctx, args.postId, args.plannedFor),
})
