import type { Doc } from '../_generated/dataModel'
import type { QueryCtx } from '../_generated/server'
import { listens } from './formats'

type Reader = { db: QueryCtx['db'] }

/**
 * What waits on the operator for one account: drafts to post, posts that
 * failed, reply drafts to post (comment answers among them), comments no
 * answer will be drafted for while the account's replies are off, and open
 * checklist items, posts soonest first. The sidebar, the account list, the
 * account page and Today all read it, so they never count differently.
 */
export interface Waiting {
  drafts: Doc<'posts'>[]
  failed: Doc<'posts'>[]
  replyDrafts: number
  unansweredComments: number
  checklist: Doc<'checklistItems'>[]
}

export async function waitingOn(ctx: Reader, account: Doc<'accounts'>): Promise<Waiting> {
  const accountId = account._id
  const posts = (
    await ctx.db
      .query('posts')
      .withIndex('by_account', (q) => q.eq('accountId', accountId))
      .collect()
  ).sort((a, b) => a.scheduledAt - b.scheduledAt)
  const replyDrafts = await ctx.db
    .query('replies')
    .withIndex('by_account_status', (q) => q.eq('accountId', accountId).eq('status', 'draft'))
    .collect()
  return {
    drafts: posts.filter((post) => post.status === 'draft'),
    failed: posts.filter((post) => post.status === 'failed'),
    replyDrafts: replyDrafts.length,
    // A waiting comment gets its draft and is counted with the reply drafts; with replies off, it is the operator's own to answer.
    unansweredComments: listens(account)
      ? 0
      : (
          await ctx.db
            .query('comments')
            .withIndex('by_account_status', (q) => q.eq('accountId', accountId).eq('status', 'new'))
            .collect()
        ).length,
    checklist: await ctx.db
      .query('checklistItems')
      .withIndex('by_account_status', (q) => q.eq('accountId', accountId).eq('status', 'open'))
      .collect(),
  }
}

/** The sidebar's count: each thing that waits, a failed post aside, which has its own mark. */
export function waitingCount(waiting: Waiting): number {
  return waiting.drafts.length + waiting.replyDrafts + waiting.unansweredComments + waiting.checklist.length
}
