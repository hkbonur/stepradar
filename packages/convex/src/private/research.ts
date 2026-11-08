import { v } from 'convex/values'
import type { Doc } from '../_generated/dataModel'
import { query } from '../_generated/server'
import { activeProblems, latestBrief } from '../core/research'

/**
 * The account page's Research section (docs/plan.md, v0.2 item 9): the
 * newest morning brief, which the page hides once it expires, and every open
 * problem, newest first.
 */
export const get = query({
  args: { accountId: v.id('accounts') },
  handler: async (
    ctx,
    args
  ): Promise<{
    brief: { _id: Doc<'memories'>['_id']; text: string; createdAt: number; expiresAt: number } | null
    problems: { _id: Doc<'memories'>['_id']; text: string; createdAt: number }[]
  }> => {
    const brief = await latestBrief(ctx, args.accountId)
    const problems = await activeProblems(ctx, args.accountId)
    return {
      brief: brief === null ? null : { _id: brief._id, text: brief.text, createdAt: brief.createdAt, expiresAt: brief.expiresAt },
      problems: problems.map((problem) => ({ _id: problem._id, text: problem.text, createdAt: problem.createdAt })),
    }
  },
})
