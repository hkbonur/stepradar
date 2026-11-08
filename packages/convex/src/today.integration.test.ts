import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import type { MutationCtx } from './_generated/server'
import { instantAt } from './core/dates'
import { HEARD_FIT, TIMEZONE, insertAccount, insertPost } from '../test/fixtures'
import { setup } from '../test/setup'

const HOUR = 3_600_000
const NOW = instantAt('2026-10-14', 12, TIMEZONE)

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'], shouldAdvanceTime: true })
})

afterEach(() => {
  vi.useRealTimers()
})

/** A reply draft waiting for the operator: a found thread `hoursAgo` old with the classifier's score, or a comment's answer. */
async function insertDraft(
  ctx: MutationCtx,
  account: Doc<'accounts'>,
  fields: { inReplyTo: string; origin: 'search' | 'comment'; score: number; hoursAgo: number }
): Promise<Id<'replies'>> {
  return ctx.db.insert('replies', {
    accountId: account._id,
    origin: fields.origin,
    inReplyTo: fields.inReplyTo,
    thread: {
      url: `https://x.com/dana/status/${fields.inReplyTo}`,
      title: null,
      text: 'How do you keep a webhook from running twice?',
      postedAt: NOW - fields.hoursAgo * HOUR,
      author: { handle: 'dana', name: 'Dana' },
      reach: 4_000,
      community: null,
    },
    fit: { ...HEARD_FIT, score: fields.score },
    status: 'draft',
    text: 'Cap the retries at three.',
    operatorAsked: false,
    heardAt: NOW - HOUR,
    writtenAt: NOW - HOUR,
    mock: true,
  })
}

describe('Today', () => {
  it('leads with the comments and their answers, ranks the other drafts, and lists the posts due today', async () => {
    const t = setup()
    const account = await t.run((ctx) => insertAccount(ctx))
    const commentId = await t.run((ctx) =>
      ctx.db.insert('comments', {
        accountId: account._id,
        externalId: 'c-1',
        inReplyTo: '1840',
        author: { handle: 'dana_ops', name: 'Dana' },
        text: 'Which queue?',
        url: 'https://x.com/dana_ops/status/c-1',
        postedAt: NOW - HOUR,
        status: 'new',
        heardAt: NOW - HOUR,
        mock: true,
      })
    )
    const answer = await t.run((ctx) => insertDraft(ctx, account, { inReplyTo: 'c-1', origin: 'comment', score: 0.9, hoursAgo: 1 }))
    const strong = await t.run((ctx) => insertDraft(ctx, account, { inReplyTo: 'f-1', origin: 'search', score: 0.9, hoursAgo: 1 }))
    const cold = await t.run((ctx) => insertDraft(ctx, account, { inReplyTo: 'f-2', origin: 'search', score: 0.9, hoursAgo: 11 }))
    const weak = await t.run((ctx) => insertDraft(ctx, account, { inReplyTo: 'f-3', origin: 'search', score: 0.3, hoursAgo: 1 }))
    const due = await t.run((ctx) => insertPost(ctx, account, { status: 'draft', plannedFor: '2026-10-14' }))
    await t.run((ctx) => insertPost(ctx, account, { status: 'draft', plannedFor: '2026-10-15' }))

    const today = await t.query(api.private.today.view, { now: Date.now() })
    expect(today.comments.shown.map((row) => [row.comment._id, row.answer.kind === 'draft' ? row.answer.reply._id : null])).toEqual([
      [commentId, answer],
    ])
    // A fresh thread with a strong fit first; one nearly cold, or with a weak fit, after it. The comment's answer leads the page, not this list.
    expect(today.drafts.shown.map((row) => row.reply._id)).toEqual([strong, weak, cold])
    expect(today.drafts.total).toBe(3)
    expect(today.due.map((post) => post._id)).toEqual([due._id])

    // Let the comment go: its draft goes with it, off the replies page.
    await t.mutation(api.private.comments.dismiss, { commentId })
    expect((await t.query(api.private.today.view, { now: Date.now() })).comments.total).toBe(0)
    expect((await t.run((ctx) => ctx.db.get(answer)))?.status).toBe('skipped')
    await expect(t.mutation(api.private.comments.dismiss, { commentId })).rejects.toThrow(
      'Only a comment that waits for its answer can be let go.'
    )
  })

  it('keeps a comment let go while its answer was being judged, and lets go one no answer reached in time', async () => {
    const t = setup()
    const account = await t.run((ctx) => insertAccount(ctx))
    const comment = (externalId: string, postedAt: number) =>
      t.run((ctx) =>
        ctx.db.insert('comments', {
          accountId: account._id,
          externalId,
          inReplyTo: '1840',
          author: { handle: 'dana_ops', name: 'Dana' },
          text: 'Which queue?',
          url: `https://x.com/dana_ops/status/${externalId}`,
          postedAt,
          status: 'new',
          heardAt: postedAt,
          mock: true,
        })
      )
    const letGo = await comment('c-1', NOW - HOUR)
    await t.mutation(api.private.comments.dismiss, { commentId: letGo })
    // A pass that judged it before the operator let it go stores no answer for it.
    await t.mutation(internal.internal.replies.storeHeardMutation, {
      accountId: account._id,
      mock: true,
      heard: [
        {
          post: {
            origin: 'comment',
            externalId: 'c-1',
            url: 'https://x.com/dana_ops/status/c-1',
            title: null,
            text: 'Which queue?',
            postedAt: NOW - HOUR,
            author: { handle: 'dana_ops', name: 'Dana' },
            reach: null,
            community: null,
            pillar: null,
            comments: null,
          },
          fit: HEARD_FIT,
        },
      ],
    })
    expect(await t.run((ctx) => ctx.db.query('replies').collect())).toEqual([])
    expect((await t.run((ctx) => ctx.db.get(letGo)))?.status).toBe('dismissed')

    // Two days without an answer: the next poll's store lets it go.
    const cold = await comment('c-2', NOW - 49 * HOUR)
    await t.mutation(internal.internal.comments.store, { accountId: account._id, heard: [], mock: true })
    expect((await t.run((ctx) => ctx.db.get(cold)))?.status).toBe('dismissed')
  })
})
