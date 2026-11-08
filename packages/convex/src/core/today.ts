import { POST_PHASES, draftRank } from '@influstep/shared'
import type { Doc, Id } from '../_generated/dataModel'
import type { QueryCtx } from '../_generated/server'
import { accountRefOf, type AccountRef } from './accounts'
import { calendarPostOf, type CalendarPost } from './calendar'
import { dayKey } from './dates'
import { listens } from './formats'
import { NEXT_STEPS_SHOWN, nextSteps, nextStepsInput } from './steps'
import { replyRowsOf, repliesWithStatus, type ReplyRow } from './replies'

/**
 * Today, the home page (docs/plan.md, "Studio screens"): what the operator
 * does next, in order. The comments that wait for an answer, the ones
 * closest to going cold first, each with its answer; the other reply drafts
 * that deserve the next minute most (shared `draftRank`); the posts due
 * today; the failures and the checklist. The next steps join with the
 * strategy (slice 10).
 */

type Reader = { db: QueryCtx['db'] }

/** How many waiting comments Today lists; the rest are counted. */
const COMMENTS_SHOWN = 10

/** How many reply drafts Today lists; the rest wait on each account's replies page. */
const DRAFTS_SHOWN = 5

/**
 * Where a waiting comment's answer stands: drafted for the operator to post,
 * being drafted, or not coming from the writer, since the account's replies
 * are off or the account is paused, so the operator answers in their own
 * words.
 */
export type CommentAnswer = { kind: 'draft'; reply: ReplyRow } | { kind: 'drafting' } | { kind: 'replies_off' } | { kind: 'paused' }

export interface WaitingComment {
  comment: Doc<'comments'>
  account: AccountRef
  answer: CommentAnswer
}

export async function todayView(ctx: Reader, now: number) {
  const accounts = await ctx.db.query('accounts').collect()
  const waiting: { comment: Doc<'comments'>; account: Doc<'accounts'>; answer: Doc<'replies'> | null }[] = []
  const drafts: Doc<'replies'>[] = []
  const due: CalendarPost[] = []
  for (const account of accounts) {
    const comments = await ctx.db
      .query('comments')
      .withIndex('by_account_status', (q) => q.eq('accountId', account._id).eq('status', 'new'))
      .collect()
    for (const comment of comments) {
      const answer = await ctx.db
        .query('replies')
        .withIndex('by_account_target', (q) => q.eq('accountId', account._id).eq('inReplyTo', comment.externalId))
        .first()
      waiting.push({ comment, account, answer })
    }
    drafts.push(...(await repliesWithStatus(ctx, account._id, 'draft')))
    const today = await ctx.db
      .query('posts')
      .withIndex('by_account_day', (q) => q.eq('accountId', account._id).eq('plannedFor', dayKey(now, account.timezone)))
      .collect()
    // Due today and still the operator's to do: an idea, a draft, or a failed post.
    for (const post of today) if (POST_PHASES[post.status] === 'open') due.push(await calendarPostOf(ctx, post, account))
  }

  // Every draft shows once: an answer with its comment, the rest in the list.
  const answers = new Set(waiting.flatMap(({ answer }) => (answer?.status === 'draft' ? [answer._id] : [])))
  const rows = new Map((await replyRowsOf(ctx, drafts, now)).map((row) => [row._id, row]))
  const rowOf = (replyId: Id<'replies'>) => {
    const row = rows.get(replyId)
    if (!row) throw new Error(`draft ${replyId} has no row`)
    return row
  }
  const comments: WaitingComment[] = waiting
    // The ones closest to going cold first.
    .sort((a, b) => a.comment.postedAt - b.comment.postedAt)
    .map(({ comment, account, answer }) => ({ comment, account: accountRefOf(account), answer: commentAnswerOf(account, answer, rowOf) }))
  const byId = new Map(accounts.map((account) => [account._id, account]))
  const ranked = drafts
    .filter((draft) => !answers.has(draft._id))
    .map((draft) => {
      const account = byId.get(draft.accountId)
      if (!account) throw new Error(`draft ${draft._id} has no account`)
      const reply = rowOf(draft._id)
      return { reply, account: accountRefOf(account), rank: draftRank(reply, now) }
    })
    .sort((a, b) => b.rank - a.rank)

  const failed: CalendarPost[] = []
  for (const post of await ctx.db
    .query('posts')
    .withIndex('by_status', (q) => q.eq('status', 'failed'))
    .collect()) {
    const account = byId.get(post.accountId)
    if (account && !due.some((row) => row._id === post._id)) failed.push(await calendarPostOf(ctx, post, account))
  }
  const checklist = await ctx.db
    .query('checklistItems')
    .withIndex('by_status', (q) => q.eq('status', 'open'))
    .collect()

  due.sort((a, b) => a.scheduledAt - b.scheduledAt)
  return {
    comments: { shown: comments.slice(0, COMMENTS_SHOWN), total: comments.length },
    drafts: { shown: ranked.slice(0, DRAFTS_SHOWN), total: ranked.length },
    due,
    // What to do next, by the rules (core/steps.ts): the comments are on this page, the rest a link away.
    nextSteps: nextSteps(await nextStepsInput(ctx, accounts, now), now).slice(0, NEXT_STEPS_SHOWN),
    failed,
    checklist: checklist.length,
  }
}

function commentAnswerOf(
  account: Doc<'accounts'>,
  answer: Doc<'replies'> | null,
  rowOf: (replyId: Id<'replies'>) => ReplyRow
): CommentAnswer {
  if (answer?.status === 'draft') return { kind: 'draft', reply: rowOf(answer._id) }
  if (answer !== null) return { kind: 'drafting' }
  if (account.paused) return { kind: 'paused' }
  if (!listens(account)) return { kind: 'replies_off' }
  return { kind: 'drafting' }
}
