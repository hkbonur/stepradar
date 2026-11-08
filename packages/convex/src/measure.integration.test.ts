import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, internal } from './_generated/api'
import { mockCounts } from './providers/platforms/mock/items'
import { HEARD_FIT, insertAccount, insertPost } from '../test/fixtures'
import { setup } from '../test/setup'

// The mock reader reads every item as standing; a test can have its moderators remove one.
vi.mock('./providers/platforms/mock/items', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./providers/platforms/mock/items')>()
  return { ...actual, mockCounts: vi.fn(actual.mockCounts) }
})

const HOUR = 3_600_000
const NOW = Date.UTC(2026, 9, 14, 12)

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'], shouldAdvanceTime: true })
})

afterEach(() => {
  vi.useRealTimers()
  vi.mocked(mockCounts).mockReset()
})

describe('measuring', () => {
  it("reads a Hacker News post's and reply's numbers and the account's karma, and shows them with the comments under them", async () => {
    const t = setup()
    const account = await t.run((ctx) => insertAccount(ctx, { platform: 'hackernews', handle: 'nora' }))
    const post = await t.run(async (ctx) => {
      const draft = await insertPost(ctx, account, { status: 'draft', plannedFor: '2026-10-14' })
      await ctx.db.patch(draft._id, { parts: ['- Retries that never run twice'] })
      return draft
    })
    await t.mutation(api.private.posts.markPosted, {
      postId: post._id,
      title: 'Retries that never run twice',
      parts: ['We key every event, so a retried webhook never runs twice.'],
      url: 'https://news.ycombinator.com/item?id=4100',
    })
    const replyId = await t.run((ctx) =>
      ctx.db.insert('replies', {
        accountId: account._id,
        origin: 'search',
        inReplyTo: '7',
        thread: {
          url: 'https://news.ycombinator.com/item?id=7',
          title: 'Ask HN: Webhook retries?',
          text: 'Mine run twice.',
          postedAt: NOW - 5 * HOUR,
          author: { handle: 'dana', name: 'dana' },
          reach: 12,
          community: 'Ask HN',
        },
        fit: HEARD_FIT,
        status: 'posted',
        text: 'Use an idempotency key.',
        operatorAsked: false,
        heardAt: NOW - 4 * HOUR,
        writtenAt: NOW - 3 * HOUR,
        posted: { kind: 'linked', at: NOW - 2 * HOUR, externalId: '4200', url: 'https://news.ycombinator.com/item?id=4200' },
        mock: true,
      })
    )
    await t.run((ctx) =>
      ctx.db.insert('comments', {
        accountId: account._id,
        externalId: '4300',
        inReplyTo: '4100',
        author: { handle: 'tomtries', name: 'tomtries' },
        text: 'Where do you keep the keys?',
        url: 'https://news.ycombinator.com/item?id=4300',
        postedAt: NOW - HOUR,
        status: 'new',
        heardAt: NOW - HOUR,
        mock: true,
      })
    )

    await t.mutation(api.private.accounts.pullMetrics, { accountId: account._id })
    await t.finishAllScheduledFunctions(() => {})

    const posted = await t.query(api.private.posted.forAccount, { accountId: account._id })
    expect(posted?.readsCounts).toBe(true)
    expect(
      posted?.items.map(({ item, comments }) => [item.kind, item.numbers?.counts.platform, comments.map((comment) => comment.externalId)])
    ).toEqual([
      // Newest first: the post went out just now, the reply two hours ago.
      ['post', 'hackernews', ['4300']],
      ['reply', 'hackernews', []],
    ])
    // Hacker News shows no comment's score, so the reply's numbers carry its answers alone.
    expect((await t.run((ctx) => ctx.db.get(replyId)))?.numbers?.counts).toMatchObject({ platform: 'hackernews', score: null })

    // The report counts their reach and the comments under them, and draws the karma read today.
    const report = await t.query(api.private.report.forAccount, { accountId: account._id })
    // Only the post carries reach: the reply is a comment, whose points Hacker News does not show.
    expect(report?.funnel).toMatchObject({ items: 2, counted: 2, reached: 1, mock: true })
    expect(report?.funnel.reach).toBeGreaterThan(0)
    expect(report?.reads).toEqual({ counts: true, account: true })
    expect(report?.reachLine).toMatchObject({ change: 0, mock: true })
    expect(report?.reachLine?.latest).toBeGreaterThan(0)
  })

  it('says a LinkedIn account has no numbers to read rather than counting zeros', async () => {
    const t = setup()
    const account = await t.run((ctx) => insertAccount(ctx, { platform: 'linkedin', handle: 'nora-builds' }))
    const report = await t.query(api.private.report.forAccount, { accountId: account._id })
    expect(report?.reads).toEqual({ counts: false, account: false })
    expect(report?.reachLine).toBeNull()
    // Nothing read is no zero.
    expect(report?.funnel).toMatchObject({ items: 0, counted: 0, reach: null, replies: null })
  })

  it('stops reading a post its community removed, leaves that community out of the plan, and asks the operator to look', async () => {
    const t = setup()
    const account = await t.run((ctx) => insertAccount(ctx, { platform: 'hackernews', handle: 'nora' }))
    const communityId = await t.run((ctx) =>
      ctx.db.insert('communities', {
        accountId: account._id,
        name: 'Show HN',
        rulesText: 'Show HN is for something you made.',
        selfPromotion: 'allowed',
        reason: 'the guidelines allow it',
        weight: 1,
        rulesReadAt: NOW,
      })
    )
    const post = await t.run(async (ctx) => {
      const draft = await insertPost(ctx, account, { status: 'draft', plannedFor: '2026-10-14' })
      await ctx.db.patch(draft._id, { community: 'Show HN', parts: ['- Retries that never run twice'] })
      return draft
    })
    await t.mutation(api.private.posts.markPosted, {
      postId: post._id,
      title: 'Show HN: Retries that never run twice',
      parts: ['We key every event, so a retried webhook never runs twice.'],
      url: 'https://news.ycombinator.com/item?id=4100',
    })
    vi.mocked(mockCounts).mockReturnValue(async () => [{ externalId: '4100', removed: true }])

    await t.mutation(api.private.accounts.pullMetrics, { accountId: account._id })
    await t.finishAllScheduledFunctions(() => {})
    const removed = await t.run((ctx) => ctx.db.get(post._id))
    expect(removed?.removedAt).toBeGreaterThan(0)
    expect(removed?.numbers).toBeUndefined()
    expect((await t.run((ctx) => ctx.db.get(communityId)))?.removedAt).toBeGreaterThan(0)
    const items = await t.run((ctx) => ctx.db.query('checklistItems').collect())
    expect(items.map((item) => [item.title, item.action, item.communityId])).toEqual([
      ['Look at why Show HN removed your post', { kind: 'visit', url: 'https://news.ycombinator.com/item?id=4100' }, communityId],
    ])

    // The next pull no longer asks for it, and opens no second item.
    vi.mocked(mockCounts).mockClear()
    await t.mutation(api.private.accounts.pullMetrics, { accountId: account._id })
    await t.finishAllScheduledFunctions(() => {})
    const [item] = await t.run((ctx) => ctx.db.query('checklistItems').collect())
    if (!item) throw new Error('the removal opened no checklist item')

    // The listener passes on a new thread there until the operator looks.
    const heard = {
      origin: 'search' as const,
      externalId: '4400',
      url: 'https://news.ycombinator.com/item?id=4400',
      title: 'Show HN: Another tool',
      text: 'Mine.',
      postedAt: Date.now() - 60_000,
      author: { handle: 'dana', name: 'dana' },
      reach: 3,
      community: 'Show HN',
      pillar: 'n8n',
      comments: 0,
    }
    const ruled = await t.query(internal.internal.replies.ruledIn, { accountId: account._id, posts: [heard] })
    expect(ruled).toHaveLength(1)
    await t.mutation(internal.internal.replies.storeHeardMutation, {
      accountId: account._id,
      heard: [{ post: heard, fit: HEARD_FIT }],
      mock: true,
    })
    expect((await t.run((ctx) => ctx.db.query('replies').collect())).find((reply) => reply.inReplyTo === '4400')).toMatchObject({
      status: 'skipped',
      skipReason: 'Show HN removed one of your posts or replies; the account answers there again once you look.',
    })
    // Looked at: ticking the item off takes the community back.
    await t.mutation(api.private.checklist.complete, { itemId: item._id })
    expect((await t.run((ctx) => ctx.db.get(communityId)))?.removedAt).toBeUndefined()
  })

  it("counts a sponsored post's visits for the mock: its tracked link's clicks on X, its reach on Reddit, where no click is counted", async () => {
    const t = setup()
    const posted = async (platform: 'x' | 'reddit', handle: string) =>
      t.run(async (ctx) => {
        const account = await insertAccount(ctx, { platform, handle })
        const post = await insertPost(ctx, account, { status: 'posted', plannedFor: '2026-10-13' })
        const counts =
          platform === 'x'
            ? { platform, impressions: 900, likes: 0, replies: 0, reposts: 0, profileVisits: 0, follows: 0 }
            : { platform, score: 60, replies: 4 }
        await ctx.db.patch(post._id, {
          posted: { kind: 'said', at: NOW - 24 * HOUR },
          sponsorLink: 'https://formstep.io',
          numbers: { counts, readAt: NOW - HOUR, mock: true },
        })
        if (platform === 'x')
          await ctx.db.insert('links', {
            kind: 'post',
            slug: 'abc1234',
            accountId: account._id,
            postId: post._id,
            target: 'https://formstep.io',
            clicks: 30,
            createdAt: NOW - 24 * HOUR,
          })
        // An unsponsored post carries no link, so it brings no visits.
        const plain = await insertPost(ctx, account, { status: 'posted', plannedFor: '2026-10-12' })
        await ctx.db.patch(plain._id, { posted: { kind: 'said', at: NOW - 48 * HOUR } })
        return account
      })
    const visits = async (platform: 'x' | 'reddit', handle: string) => {
      const account = await posted(platform, handle)
      const found = await t.query(internal.internal.analyst.mockVisits, { accountId: account._id, since: NOW - 30 * 24 * HOUR })
      return found.map((post) => post.visits)
    }
    expect(await visits('x', 'ada_x')).toEqual([30])
    expect(await visits('reddit', 'ada_reddit')).toEqual([60])
  })
})
