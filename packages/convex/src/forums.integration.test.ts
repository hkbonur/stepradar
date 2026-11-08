import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, internal } from './_generated/api'
import { dayKey, weekStart } from './core/dates'
import { noMetCommunity } from './core/planner'
import { cannotRead } from './providers/platforms'
import { mockXHistory } from './providers/platforms/mock/history'
import { HEARD_FIT, N8N_FORUM, TIMEZONE, insertAccount } from '../test/fixtures'
import { setup } from '../test/setup'

// The mock reader lists the mock history as the account's own posts; the match test says which the operator made.
vi.mock('./providers/platforms/mock/history', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./providers/platforms/mock/history')>()
  return { ...actual, mockXHistory: vi.fn(actual.mockXHistory) }
})

afterEach(() => {
  vi.mocked(mockXHistory).mockReset()
})

const HOUR = 3_600_000

/** A forum on software Influstep cannot read: its steps are the operator's, like LinkedIn's. */
const ZAPIER_FORUM = { origin: 'https://community.zapier.com', name: 'Zapier Community', software: 'other' as const }

describe('a forum account', () => {
  it("listens on a Discourse forum in its categories, under each category's rules, and drafts replies to rewrite", async () => {
    const t = setup()
    const account = await t.run((ctx) => insertAccount(ctx, { platform: 'forum', forum: N8N_FORUM, handle: 'ada' }))
    await t.mutation(api.private.replies.listenNow, { accountId: account._id })
    await t.finishAllScheduledFunctions(() => {})
    const replies = await t.run((ctx) => ctx.db.query('replies').collect())
    expect(replies.length).toBeGreaterThan(0)
    expect(replies.every((reply) => reply.thread.community !== null)).toBe(true)
    // The mock forum's guidelines forbid advertising, so no reply there names the sponsor.
    const communities = await t.run((ctx) => ctx.db.query('communities').collect())
    expect(communities.length).toBeGreaterThan(0)
    expect(communities.every((community) => community.selfPromotion === 'forbidden')).toBe(true)
    expect(replies.filter((reply) => reply.status === 'draft').every((reply) => !reply.text.includes('Formstep'))).toBe(true)

    // Once it has met categories, half the next sweep keeps to them.
    expect(await t.query(internal.internal.replies.searchedCommunitiesOf, { accountId: account._id })).toEqual(
      communities.map((community) => community.name)
    )
  })

  it('leaves every step on a forum Influstep cannot read to the operator, and answers a thread pasted from that forum only', async () => {
    const t = setup()
    const account = await t.run((ctx) => insertAccount(ctx, { platform: 'forum', forum: ZAPIER_FORUM, handle: 'ada' }))
    await expect(t.mutation(api.private.replies.listenNow, { accountId: account._id })).rejects.toThrow(
      cannotRead({ platform: 'forum', forum: ZAPIER_FORUM }, 'search')
    )
    const paste = (url: string) =>
      t.action(api.private.replies.pasteThread, { accountId: account._id, url, text: 'How do I send a form to one customer from a Zap?' })
    await expect(paste('https://community.n8n.io/t/webhook-retries/296315')).rejects.toThrow(
      'That is no link to a thread on Zapier Community.'
    )
    await paste('https://community.zapier.com/how-do-i-3/send-a-form-to-one-customer-41')
    await t.finishAllScheduledFunctions(() => {})
    expect(await t.run((ctx) => ctx.db.query('replies').collect())).toMatchObject([
      { origin: 'pasted', status: 'draft', inReplyTo: '/how-do-i-3/send-a-form-to-one-customer-41' },
    ])
  })

  it('drafts a reply to a topic pasted from a Discourse forum under the rules of its category, which the link does not name', async () => {
    const t = setup()
    const account = await t.run((ctx) => insertAccount(ctx, { platform: 'forum', forum: N8N_FORUM, handle: 'ada' }))
    await t.action(api.private.replies.pasteThread, {
      accountId: account._id,
      url: 'https://community.n8n.io/t/form-webhook-runs-twice/41',
      text: 'My form webhook runs twice. Which tool do you use?',
    })
    expect(await t.run((ctx) => ctx.db.query('replies').collect())).toMatchObject([{ inReplyTo: '41', thread: { community: 'Questions' } }])
    // The mock forum's guidelines forbid advertising, so the category is read as one where the sponsor is not named.
    expect(await t.run((ctx) => ctx.db.query('communities').collect())).toMatchObject([{ name: 'Questions', selfPromotion: 'forbidden' }])
  })

  it("searches the workspace's forums for any account's niche, and names the forum in each signal", async () => {
    const t = setup()
    const x = await t.run((ctx) => insertAccount(ctx))
    await t.run((ctx) => insertAccount(ctx, { platform: 'forum', forum: N8N_FORUM, handle: 'ada' }))
    await t.action(internal.internal.researcher.pollSignals, { accountId: x._id })
    const fromForum = (await t.run((ctx) => ctx.db.query('signals').collect())).filter(
      (signal) => signal.accountId === x._id && signal.source === 'forum'
    )
    expect(fromForum.length).toBeGreaterThan(0)
    expect(fromForum.every((signal) => signal.summary.startsWith('n8n Community, '))).toBe(true)
  })

  it("finds the operator's reply to a topic posted under a later post of it, and reads the comments under it", async () => {
    const t = setup()
    const account = await t.run((ctx) => insertAccount(ctx, { platform: 'forum', forum: N8N_FORUM, handle: 'ada' }))
    const now = Date.now()
    const replyId = await t.run((ctx) =>
      ctx.db.insert('replies', {
        accountId: account._id,
        origin: 'search',
        inReplyTo: '41',
        thread: {
          url: 'https://community.n8n.io/t/form-webhook-runs-twice/41',
          title: 'Form webhook runs twice',
          text: 'My form webhook runs twice when the client double-clicks.',
          postedAt: now - 5 * HOUR,
          author: { handle: 'dana', name: 'Dana Ruiz' },
          reach: 2,
          community: 'Questions',
        },
        fit: HEARD_FIT,
        status: 'draft',
        text: 'Dedupe on the submission id before the workflow runs.',
        operatorAsked: false,
        heardAt: now - 3 * HOUR,
        writtenAt: now - 2 * HOUR,
        mock: true,
      })
    )
    // The operator clicked Reply under the third post of the topic, in their own words.
    vi.mocked(mockXHistory).mockReturnValue([
      {
        externalId: '41/7',
        parts: ['I keep a table of submission ids and skip any I have seen.'],
        postedAt: now - HOUR,
        likes: 0,
        reposts: 0,
        replies: 0,
        parentId: '41/3',
        url: 'https://community.n8n.io/t/form-webhook-runs-twice/41/7',
        community: 'Questions',
        lang: null,
      },
    ])
    expect(await t.action(internal.internal.match.match, { accountId: account._id })).toMatchObject({ replies: 1 })
    expect(await t.run((ctx) => ctx.db.get(replyId))).toMatchObject({
      status: 'posted',
      posted: { kind: 'found', externalId: '41/7', url: 'https://community.n8n.io/t/form-webhook-runs-twice/41/7' },
    })
    await t.action(internal.internal.comments.poll, { accountId: account._id })
    const comments = await t.run((ctx) => ctx.db.query('comments').collect())
    expect(comments.length).toBeGreaterThan(0)
    expect(comments.every((comment) => comment.inReplyTo === '41/7' && comment.url.startsWith('https://community.n8n.io/'))).toBe(true)
    // A forum's post names no category, so a comment is said where the reply it answers was: its answer keeps that category's rules.
    expect(comments.every((comment) => comment.community === 'Questions')).toBe(true)
  })

  it('plans no post until the listener has met a category, says why, and plans the first weeks once it has', async () => {
    const t = setup()
    const account = await t.run((ctx) => insertAccount(ctx, { platform: 'forum', forum: N8N_FORUM, handle: 'ada' }))
    const week = weekStart(dayKey(Date.now(), TIMEZONE))
    expect(await t.mutation(internal.internal.writer.planWeek, { accountId: account._id, weekStart: week })).toEqual({
      skipped: noMetCommunity('forum'),
    })
    await expect(t.mutation(api.private.accounts.planWeek, { accountId: account._id })).rejects.toThrow(noMetCommunity('forum'))
    // Today's Plan this week plans every other account and counts this one as waiting.
    const x = await t.run((ctx) => insertAccount(ctx))
    expect(await t.mutation(api.private.accounts.planActiveWeek, { weekStart: week })).toEqual({ queued: 1, waiting: 1 })
    expect(
      (await t.run((ctx) => ctx.db.query('jobs').collect())).filter((job) => job.kind === 'plan_week').map((job) => job.accountId)
    ).toEqual([x._id])
    expect(await t.query(api.private.accounts.get, { accountId: account._id })).toMatchObject({ planWaits: noMetCommunity('forum') })

    // The sweep meets the categories, and their first one plans the weeks the account waited for: nobody presses Plan this week.
    await t.mutation(api.private.replies.listenNow, { accountId: account._id })
    await t.finishAllScheduledFunctions(() => {})
    const met = new Set((await t.run((ctx) => ctx.db.query('communities').collect())).map((community) => community.name))
    const posts = (await t.run((ctx) => ctx.db.query('posts').collect())).filter((post) => post.accountId === account._id)
    expect(posts.length).toBeGreaterThan(0)
    expect(posts.every((post) => post.community !== undefined && met.has(post.community))).toBe(true)
    expect(await t.query(api.private.accounts.get, { accountId: account._id })).toMatchObject({ planWaits: null })
    // One plan of two weeks, once every category of the sweep is stored.
    const plans = (await t.run((ctx) => ctx.db.query('jobs').collect())).filter(
      (job) => job.kind === 'plan_week' && job.accountId === account._id
    )
    expect(plans).toHaveLength(2)
  })

  it('plans again once the operator looks at the only category, which had removed a reply', async () => {
    const t = setup()
    const account = await t.run((ctx) => insertAccount(ctx, { platform: 'forum', forum: N8N_FORUM, handle: 'ada' }))
    const itemId = await t.run(async (ctx) => {
      const communityId = await ctx.db.insert('communities', {
        accountId: account._id,
        name: 'Questions',
        rulesText: 'Be kind.',
        selfPromotion: 'forbidden',
        reason: 'No advertising.',
        weight: 1,
        removedAt: Date.now(),
        rulesReadAt: Date.now(),
      })
      return ctx.db.insert('checklistItems', {
        accountId: account._id,
        communityId,
        title: 'Look at why Questions removed your reply',
        why: 'Questions gets no more posts or replies until you tick this off.',
        status: 'open',
        createdAt: Date.now(),
      })
    })
    expect(await t.query(api.private.accounts.get, { accountId: account._id })).toMatchObject({ planWaits: noMetCommunity('forum') })
    await t.mutation(api.private.checklist.complete, { itemId })
    const plans = (await t.run((ctx) => ctx.db.query('jobs').collect())).filter((job) => job.kind === 'plan_week')
    expect(plans).toHaveLength(2)
  })
})
