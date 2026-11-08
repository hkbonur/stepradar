import { MATCH_WINDOW_MS, type ImportedPost, type Platform } from '@influstep/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import { instantAt } from './core/dates'
import { postedLately } from './core/history'
import { mockXHistory } from './providers/platforms/mock/history'
import { HEARD_FIT, TIMEZONE, insertAccount, insertPost } from '../test/fixtures'
import { setup } from '../test/setup'

// The mock reader lists the mock history as the account's own posts; each test says which posts the operator made.
vi.mock('./providers/platforms/mock/history', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./providers/platforms/mock/history')>()
  return { ...actual, mockXHistory: vi.fn(actual.mockXHistory) }
})

type Test = ReturnType<typeof setup>

const HOUR = 3_600_000
const NOW = instantAt('2026-10-14', 12, TIMEZONE)
const DRAFT = 'Cap the retries at three and alert on the last one, so a failing webhook never runs twice.'

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'], shouldAdvanceTime: true })
})

afterEach(() => {
  vi.useRealTimers()
  vi.mocked(mockXHistory).mockReset()
})

/** What the operator posted, as the account's platform reader lists it. */
function postedByOperator(items: ImportedPost[]): void {
  vi.mocked(mockXHistory).mockReturnValue(items)
}

function own(overrides: Partial<ImportedPost> & Pick<ImportedPost, 'externalId'>): ImportedPost {
  return {
    parts: ['Honestly? Idempotency keys. We dedupe on the event id in Postgres.'],
    postedAt: NOW - HOUR,
    likes: 0,
    reposts: 0,
    replies: 0,
    parentId: '7',
    url: `https://news.ycombinator.com/item?id=${overrides.externalId}`,
    community: 'Hacker News',
    lang: null,
    ...overrides,
  }
}

/** A reply draft waiting for the operator, answering `inReplyTo`. */
async function insertDraft(t: Test, account: Doc<'accounts'>, fields: Partial<Doc<'replies'>> = {}): Promise<Id<'replies'>> {
  return t.run((ctx) =>
    ctx.db.insert('replies', {
      accountId: account._id,
      origin: 'search',
      inReplyTo: '7',
      thread: {
        url: 'https://news.ycombinator.com/item?id=7',
        title: 'Webhooks',
        text: 'Retries?',
        postedAt: NOW - 5 * HOUR,
        author: null,
        reach: null,
        community: 'Hacker News',
      },
      fit: HEARD_FIT,
      status: 'draft',
      text: DRAFT,
      operatorAsked: false,
      heardAt: NOW - 3 * HOUR,
      writtenAt: NOW - 2 * HOUR,
      mock: true,
      ...fields,
    })
  )
}

async function match(t: Test, account: Doc<'accounts'>) {
  return t.action(internal.internal.match.match, { accountId: account._id })
}

async function hackerNews(t: Test, platform: Platform = 'hackernews'): Promise<Doc<'accounts'>> {
  return t.run((ctx) => insertAccount(ctx, { platform, handle: platform === 'x' ? 'nora_builds' : 'nora' }))
}

describe('the match', () => {
  it('finds the comment the operator wrote from a draft, and keeps everything read in the history, once', async () => {
    const t = setup()
    const account = await hackerNews(t)
    const replyId = await insertDraft(t, account)
    const comment = own({ externalId: '41' })
    const story = own({ externalId: '40', parentId: null, parts: ['Show HN: my weekend project'], community: 'Show HN' })
    postedByOperator([comment, story])

    expect(await match(t, account)).toEqual({ replies: 1, posts: 0, stored: 2, answered: 0 })
    // The operator rewrote it in their own words, as Hacker News asks: the reply keeps what went out, and no edit share.
    const found = await t.run((ctx) => ctx.db.get(replyId))
    expect(found).toMatchObject({
      status: 'posted',
      text: comment.parts[0],
      posted: {
        kind: 'found',
        at: comment.postedAt,
        externalId: '41',
        url: 'https://news.ycombinator.com/item?id=41',
      },
    })
    expect(found?.posted?.editShare).toBeUndefined()
    // Both items join the history; the story, which no draft points at, was posted without a draft.
    const history = await t.run((ctx) => ctx.db.query('accountPosts').collect())
    expect(history.map((row) => [row.externalId, row.isReply, row.community]).sort()).toEqual([
      ['40', false, 'Show HN'],
      ['41', true, 'Hacker News'],
    ])

    // Run again: what was found stays found, and nothing is stored twice.
    expect(await match(t, account)).toEqual({ replies: 0, posts: 0, stored: 0, answered: 0 })
  })

  it('says how much of a ready draft the operator changed on X', async () => {
    const t = setup()
    const account = await hackerNews(t, 'x')
    const replyId = await insertDraft(t, account, { inReplyTo: '1840' })
    postedByOperator([own({ externalId: '1850', parentId: '1840', parts: [DRAFT.replace('three', 'five')], url: null, community: null })])
    await match(t, account)
    const reply = await t.run((ctx) => ctx.db.get(replyId))
    expect(reply?.status).toBe('posted')
    expect(reply?.posted?.editShare).toBeGreaterThan(0)
    expect(reply?.posted?.editShare).toBeLessThan(0.5)

    // The writer reads what went out and how much the operator changed, to write closer to it next time.
    const posted = await t.run((ctx) => postedLately(ctx, account._id, 'reply'))
    expect(posted).toEqual({ texts: [DRAFT.replace('three', 'five')], editShare: reply?.posted?.editShare })
  })

  it('fills in a reply marked posted without a link once it sees the comment, and asks for the link of a draft opened two days ago', async () => {
    const t = setup()
    const account = await hackerNews(t)
    const replyId = await insertDraft(t, account)
    postedByOperator([])
    await t.mutation(api.private.replies.markPosted, { replyId, text: DRAFT })
    expect(await match(t, account)).toMatchObject({ replies: 0 })
    postedByOperator([own({ externalId: '42', postedAt: Date.now() - HOUR })])
    expect(await match(t, account)).toMatchObject({ replies: 1 })
    expect(await t.run((ctx) => ctx.db.get(replyId))).toMatchObject({
      status: 'posted',
      posted: { kind: 'found', externalId: '42', at: Date.now() - HOUR },
    })

    // A draft the operator opened and the match has not found: it keeps waiting, and asks for its link after two days.
    const opened = await insertDraft(t, account, { inReplyTo: '8', openedAt: NOW })
    vi.setSystemTime(NOW + MATCH_WINDOW_MS + HOUR)
    const page = await t.query(api.private.replies.list, { accountId: account._id })
    expect(page?.waiting).toMatchObject([{ _id: opened, asksForLink: true }])
  })

  it('finds a post by the link the operator gave, and pairs no draft post with a post of their own', async () => {
    const t = setup()
    const account = await hackerNews(t)
    const posted = await t.run((ctx) => insertPost(ctx, account, { status: 'draft', plannedFor: '2026-10-14' }))
    const waiting = await t.run((ctx) => insertPost(ctx, account, { status: 'draft', plannedFor: '2026-10-14' }))
    await t.run(async (ctx) => {
      for (const id of [posted._id, waiting._id]) await ctx.db.patch(id, { parts: ['- Retries that never run twice'] })
    })
    // The draft is talking points; the operator posts their own words from them.
    const parts = ['We keep an idempotency key per event, so a retried webhook never runs twice.']
    await t.mutation(api.private.posts.markPosted, {
      postId: posted._id,
      title: 'Retries',
      parts,
      url: 'https://news.ycombinator.com/item?id=43',
    })
    postedByOperator([own({ externalId: '43', parentId: null, parts }), own({ externalId: '44', parentId: null, parts })])
    expect(await match(t, account)).toMatchObject({ posts: 1 })
    expect(await t.run((ctx) => ctx.db.get(posted._id))).toMatchObject({
      status: 'posted',
      posted: { kind: 'found', externalId: '43', at: NOW - HOUR },
    })
    expect((await t.run((ctx) => ctx.db.get(waiting._id)))?.status).toBe('draft')
  })

  it('finds a post the operator made on X from a draft, and keeps the words they posted', async () => {
    const t = setup()
    const account = await hackerNews(t, 'x')
    const draft = await t.run(async (ctx) => {
      const post = await insertPost(ctx, account, { status: 'draft', plannedFor: '2026-10-14' })
      await ctx.db.patch(post._id, { parts: [DRAFT], hook: DRAFT, writtenAt: NOW - 20 * HOUR })
      return post
    })
    const words = [DRAFT.replace('three', 'five')]
    postedByOperator([own({ externalId: '1860', parentId: null, parts: words, url: null, community: null })])
    expect(await match(t, account)).toMatchObject({ posts: 1 })
    const found = await t.run((ctx) => ctx.db.get(draft._id))
    expect(found).toMatchObject({ status: 'posted', posted: { kind: 'found', externalId: '1860' }, parts: words, hook: words[0] })
    expect(found?.posted?.editShare).toBeGreaterThan(0)
  })

  it('looks only on accounts whose reader lists their posts and that have a reply or post draft waiting or something posted lately', async () => {
    const t = setup()
    const withDraft = await hackerNews(t)
    await insertDraft(t, withDraft)
    const withPosted = await hackerNews(t)
    await insertDraft(t, withPosted, { status: 'posted', posted: { kind: 'said', at: NOW - HOUR } })
    const longAgo = await hackerNews(t)
    await insertDraft(t, longAgo, { status: 'posted', posted: { kind: 'said', at: NOW - MATCH_WINDOW_MS - HOUR } })
    const withPostDraft = await hackerNews(t)
    await t.run((ctx) => insertPost(ctx, withPostDraft, { status: 'draft', plannedFor: '2026-10-14' }))
    await hackerNews(t)
    const linkedIn = await t.run((ctx) => insertAccount(ctx, { platform: 'linkedin', handle: 'nora-builds' }))
    await insertDraft(t, linkedIn)
    await t.mutation(internal.internal.schedule.match, {})
    const jobs = await t.run((ctx) => ctx.db.query('jobs').collect())
    expect(jobs.map((job) => [job.kind, job.accountId])).toEqual([
      ['match', withDraft._id],
      ['match', withPosted._id],
      ['match', withPostDraft._id],
    ])
  })
})
