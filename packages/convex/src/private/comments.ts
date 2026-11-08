import { v } from 'convex/values'
import { mutation } from '../_generated/server'
import { dismissComment } from '../core/replies'

/** The operator lets a comment go: no answer is coming, and its draft, if one waits, goes with it. */
export const dismiss = mutation({
  args: { commentId: v.id('comments') },
  handler: async (ctx, args) => dismissComment(ctx, args.commentId, Date.now()),
})
