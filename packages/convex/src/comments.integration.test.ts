import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, internal } from './_generated/api'
import type { Doc } from './_generated/dataModel'
import { instantAt } from './core/dates'
import type { PlatformComment } from './providers/platforms'
import { mockClassifier } from './providers/classifier/mock'
import { mockComments } from './providers/platforms/mock/items'
import { TIMEZONE, insertAccount, insertPostedReply } from '../test/fixtures'
import { setup } from '../test/setup'

// The mock reader's comments under the account's items; each test says which comments people wrote.
vi.mock('./providers/platforms/mock/items', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./providers/platforms/mock/items')>()
  return { ...actual, mockComments: vi.fn(actual.mockComments) }
})

type Test = ReturnType<typeof setup>

const HOUR = 3_600_000
const NOW = instantAt('2026-10-14', 12, TIMEZONE)

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'], shouldAdvanceTime: true })
})

afterEach(() => {
  vi.useRealTimers()
  vi.mocked(mockComments).mockReset()
  vi.restoreAllMocks()
})

/** What people wrote under the account's items, as its platform reader lists them. */
function commentsWritten(comments: PlatformComment[]): void {
  vi.mocked(mockComments).mockReturnValue(async () => comments)
}

function comment(externalId: string, parentId: string, at: number): PlatformComment {
  return {
    externalId,
    parentId,
    author: { handle: 'dana_ops', name: 'Dana' },
    text: 'Which queue do you use for the retries?',
    url: `https://x.com/dana_ops/status/${externalId}`,
    community: null,
    likes: 3,
    at,
  }
}

/** An X account with one reply posted an hour ago; returns the account and the posted reply's id on X. */
async function withPostedReply(t: Test): Promise<{ account: Doc<'accounts'>; itemId: string }> {
  const account = await t.run((ctx) => insertAccount(ctx))
  const replyId = await t.run((ctx) => insertPostedReply(ctx, account, { heardAt: NOW - HOUR, impressions: 0, follows: 0 }))
  const reply = await t.run((ctx) => ctx.db.get(replyId))
  if (reply?.posted?.kind !== 'linked') throw new Error('the posted reply has no id')
  return { account, itemId: reply.posted.externalId }
}

async function poll(t: Test, account: Doc<'accounts'>) {
  const outcome = await t.action(internal.internal.comments.poll, { accountId: account._id })
  await t.finishAllScheduledFunctions(() => {})
  return outcome
}

describe('the comment poll', () => {
  it('stores each comment once, answers the fresh ones and the mentions, and lets an old one go', async () => {
    const t = setup()
    const { account, itemId } = await withPostedReply(t)
    commentsWritten([comment('c-fresh', itemId, NOW - 10 * 60_000), comment('c-old', itemId, NOW - 72 * HOUR)])

    await poll(t, account)
    const comments = await t.run((ctx) => ctx.db.query('comments').collect())
    expect(comments.map((row) => [row.externalId, row.inReplyTo ?? null, row.status]).sort()).toEqual(
      [
        ['c-fresh', itemId, 'new'],
        ['c-old', itemId, 'dismissed'],
        [expect.any(String), null, 'new'],
      ].sort()
    )
    // The fresh comment and the mention get answer drafts, written whatever is left of the day's budget; the old one none.
    const replies = await t.run((ctx) => ctx.db.query('replies').collect())
    const answers = replies.filter((reply) => reply.origin === 'comment' || reply.origin === 'mention')
    expect(answers.map((reply) => [reply.origin, reply.status]).sort()).toEqual([
      ['comment', 'draft'],
      ['mention', 'draft'],
    ])
    expect(answers.find((reply) => reply.origin === 'comment')?.inReplyTo).toBe('c-fresh')
    // Every comment is a signal the problem log and the comment digest read.
    const signals = await t.run((ctx) => ctx.db.query('signals').collect())
    expect(
      signals
        .filter((signal) => signal.source === 'comments')
        .map((signal) => signal.externalId)
        .sort()
    ).toEqual(['c-fresh', 'c-old'])

    // A second poll stores and answers nothing twice.
    await poll(t, account)
    expect(await t.run((ctx) => ctx.db.query('comments').collect())).toHaveLength(3)
    expect(await t.run((ctx) => ctx.db.query('replies').collect())).toHaveLength(replies.length)
  })

  it('marks a comment answered once the operator posts its answer, or the match sees their reply under it', async () => {
    const t = setup()
    const { account, itemId } = await withPostedReply(t)
    commentsWritten([comment('c-1', itemId, NOW - 10 * 60_000), comment('c-2', itemId, NOW - 20 * 60_000)])
    await poll(t, account)
    const answer = (await t.run((ctx) => ctx.db.query('replies').collect())).find((reply) => reply.inReplyTo === 'c-1')
    if (!answer) throw new Error('the comment has no answer draft')

    await t.mutation(api.private.replies.markPosted, { replyId: answer._id, text: answer.text })
    const status = async (externalId: string) =>
      (await t.run((ctx) => ctx.db.query('comments').collect())).find((row) => row.externalId === externalId)?.status
    expect(await status('c-1')).toBe('answered')

    // The operator answered the other one by hand; the match reads it as an item under the comment.
    await t.mutation(internal.internal.match.store, {
      accountId: account._id,
      mock: true,
      items: [
        {
          externalId: '1990',
          parts: ['Redis, with a lock per event.'],
          postedAt: NOW,
          likes: 0,
          reposts: 0,
          replies: 0,
          parentId: 'c-2',
          url: null,
          community: null,
          lang: null,
        },
      ],
    })
    expect(await status('c-2')).toBe('answered')
  })

  it('reads only for accounts whose reader hears mentions, or reads comments and has something posted this week', async () => {
    const t = setup()
    const x = await t.run((ctx) => insertAccount(ctx))
    const quiet = await t.run((ctx) => insertAccount(ctx, { platform: 'hackernews', handle: 'nora' }))
    const posted = await t.run((ctx) => insertAccount(ctx, { platform: 'hackernews', handle: 'nora_two' }))
    await t.run((ctx) => insertPostedReply(ctx, posted, { heardAt: NOW - HOUR, impressions: 0, follows: 0 }))
    await t.run((ctx) => insertAccount(ctx, { platform: 'linkedin', handle: 'nora-builds' }))
    await t.mutation(internal.internal.schedule.pollComments, {})
    const jobs = await t.run((ctx) => ctx.db.query('jobs').collect())
    expect(jobs.map((job) => job.accountId).sort()).toEqual([x._id, posted._id].sort())
    expect(jobs.map((job) => job.accountId)).not.toContain(quiet._id)
  })

  it('lets a comment go when its answer is passed on, and drafts the answers a failed pass left for the next poll', async () => {
    const t = setup()
    const { account, itemId } = await withPostedReply(t)
    commentsWritten([comment('c-1', itemId, NOW - 10 * 60_000)])
    const classify = mockClassifier.classify.bind(mockClassifier)
    vi.spyOn(mockClassifier, 'classify').mockRejectedValueOnce(new Error('the model is down'))
    await expect(poll(t, account)).rejects.toThrow('the model is down')
    expect(
      await t.run((ctx) =>
        ctx.db
          .query('replies')
          .withIndex('by_account_target', (q) => q.eq('accountId', account._id).eq('inReplyTo', 'c-1'))
          .first()
      )
    ).toBeNull()

    vi.spyOn(mockClassifier, 'classify').mockImplementation(classify)
    await poll(t, account)
    const answer = await t.run((ctx) =>
      ctx.db
        .query('replies')
        .withIndex('by_account_target', (q) => q.eq('accountId', account._id).eq('inReplyTo', 'c-1'))
        .first()
    )
    expect(answer?.status).toBe('draft')
    const status = async () => (await t.run((ctx) => ctx.db.query('comments').collect())).find((row) => row.externalId === 'c-1')?.status
    expect(await status()).toBe('new')
    if (!answer) throw new Error('no answer')
    await t.mutation(api.private.replies.skip, { replyId: answer._id })
    expect(await status()).toBe('dismissed')
  })

  it('stores and announces comments but drafts no answer while replies are off', async () => {
    const t = setup()
    const { account, itemId } = await withPostedReply(t)
    await t.run((ctx) => ctx.db.patch(account._id, { cadence: { ...account.cadence, repliesPerDay: 0 } }))
    commentsWritten([comment('c-1', itemId, NOW - 10 * 60_000)])
    await poll(t, account)
    expect((await t.run((ctx) => ctx.db.query('comments').collect())).map((row) => row.status)).toContain('new')
    expect((await t.run((ctx) => ctx.db.query('replies').collect())).filter((reply) => reply.origin !== 'search')).toEqual([])
    expect(await t.run((ctx) => ctx.db.query('notifications').collect())).toHaveLength(1)
    // No answer is coming, so the comment and the mention wait on the operator, and the sidebar counts them.
    const [row] = await t.query(api.private.accounts.list, {})
    expect(row?.counts.waitingTotal).toBe(2)
  })
})
