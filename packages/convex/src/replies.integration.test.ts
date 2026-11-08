import { DRAFT_STALE_MS, EXPERIMENT_CATALOG, REPLY_PEER_MAX, REPLY_REACH_MIN } from '@influstep/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, internal } from './_generated/api'
import type { Doc } from './_generated/dataModel'
import type { MutationCtx } from './_generated/server'
import { instantAt } from './core/dates'
import { mockClassifier } from './providers/classifier/mock'
import { mockLlm } from './providers/llm/mock'
import { HEARD_FIT, TIMEZONE, insertAccount, insertPostedReply } from '../test/fixtures'
import { setup } from '../test/setup'

type Test = ReturnType<typeof setup>

/** The mock listener hears a fresh set every three hours, naming the sponsor in even windows and politics in odd ones. */
const WINDOW_MS = 3 * 3_600_000
const MORNING = instantAt('2026-10-14', 8, TIMEZONE)

beforeEach(() => {
  // Only Date is faked, and it keeps running, so the scheduler's timers and the rows' creation order are real.
  vi.useFakeTimers({ now: MORNING, toFake: ['Date'], shouldAdvanceTime: true })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function listenNow(t: Test, account: Doc<'accounts'>): Promise<void> {
  await t.mutation(api.private.replies.listenNow, { accountId: account._id })
  await t.finishAllScheduledFunctions(() => {})
}

async function view(t: Test, account: Doc<'accounts'>) {
  const page = await t.query(api.private.replies.list, { accountId: account._id })
  if (!page) throw new Error('the account is gone')
  return page
}

async function setBudget(t: Test, account: Doc<'accounts'>, repliesPerDay: number): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.patch(account._id, { cadence: { ...account.cadence, repliesPerDay } })
  })
}

let posts = 0

/** The operator posts the reply on X by hand, as drafted, and gives its link. */
async function operatorPosts(t: Test, reply: Doc<'replies'>): Promise<void> {
  posts += 1
  // Spelled out: an X id is past what a JavaScript number holds exactly.
  const url = `https://x.com/ada_automates/status/18500000000000${String(posts).padStart(5, '0')}`
  await t.mutation(api.private.replies.markPosted, { replyId: reply._id, text: reply.text, url })
}

/** A thread heard on X a moment ago, waiting for the writer. */
async function insertHeard(ctx: MutationCtx, account: Doc<'accounts'>, externalId: string): Promise<void> {
  await ctx.db.insert('replies', {
    accountId: account._id,
    origin: 'search',
    inReplyTo: externalId,
    thread: {
      url: `https://x.com/dana/status/${externalId}`,
      title: null,
      text: 'How do you keep a webhook from running twice?',
      postedAt: Date.now() - 600_000,
      author: { handle: 'dana', name: 'Dana' },
      reach: 4_000,
      community: null,
    },
    fit: HEARD_FIT,
    status: 'heard',
    text: '',
    operatorAsked: false,
    heardAt: Date.now(),
    mock: true,
  })
}

/** The window parity of the clock now: the mock names the sponsor in an even window. */
function sponsorWindow(): boolean {
  return Math.floor(Date.now() / WINDOW_MS) % 2 === 0
}

/** Engagement on X: listen, write within the budget, the operator posts by hand, the numbers. */
describe('engagement on X', () => {
  it('keeps what is worth answering, passes on the sponsor and what a rule covers, and drafts the rest for the operator', async () => {
    const t = setup()
    const account = await t.run((ctx) => insertAccount(ctx))
    await setBudget(t, account, 20)
    await t.mutation(api.private.accounts.sendMessage, { accountId: account._id, text: 'never reply to politics' })
    await t.finishAllScheduledFunctions(() => {})

    // Two sweeps three hours apart: one hears a post naming the sponsor, the other a post about politics.
    await listenNow(t, account)
    vi.setSystemTime(Date.now() + WINDOW_MS)
    await listenNow(t, account)

    const page = await view(t, account)
    expect(page.beingWritten).toEqual([])
    const all = [...page.waiting, ...page.skipped]
    // Per sweep, at most three found posts with reach; the old one is dropped. Mentions and comments come through the comment poll.
    const found = all.filter((reply) => reply.origin === 'search')
    expect(found).toHaveLength(all.length)
    expect(found.length).toBeLessThanOrEqual(6)
    for (const reply of found) expect(reply.thread.reach).toBeGreaterThanOrEqual(REPLY_REACH_MIN)
    expect(new Set(all.map((reply) => reply.inReplyTo)).size).toBe(all.length)

    expect(page.skipped.map((reply) => reply.skipReason).sort()).toEqual([
      'It names Formstep; the account answers about its sponsor only when you ask.',
      'My rule "Never reply to politics." covers this post.',
    ])
    // Influstep never posts, so every draft waits for the operator; every draft is a reply that fits X.
    expect(page.waiting.length).toBe(all.length - 2)
    for (const reply of page.waiting) {
      expect(reply.text.length).toBeGreaterThan(0)
      expect(reply.text).not.toContain('Formstep')
    }

    // The same window heard again answers nothing twice: no thread gets a second row.
    await listenNow(t, account)
    const rows = await t.run(async (ctx) => (await ctx.db.query('replies').collect()).map((reply) => reply.inReplyTo))
    expect(new Set(rows).size).toBe(rows.length)
  })

  it('drops what the classifier reads as off topic, and keeps its read on every post it keeps', async () => {
    const t = setup()
    const account = await t.run((ctx) => insertAccount(ctx))
    await setBudget(t, account, 20)
    const classify = mockClassifier.classify.bind(mockClassifier)
    const spy = vi.spyOn(mockClassifier, 'classify').mockImplementation(async (brief) => {
      const fits = await classify(brief)
      // The classifier reads the mention as small talk.
      return fits.map((fit, index) => (brief.posts[index]?.origin === 'mention' ? { ...fit, relevant: false, reason: 'small talk' } : fit))
    })
    await listenNow(t, account)
    // The mock listener hears seven posts a sweep; the rules drop at least the one too old to answer before the classifier reads.
    const read = spy.mock.calls.flatMap(([brief]) => brief.posts)
    spy.mockRestore()
    expect(read.length).toBeGreaterThan(0)
    expect(read.length).toBeLessThan(7)

    const page = await view(t, account)
    const all = [...page.waiting, ...page.skipped]
    expect(all.filter((reply) => reply.origin === 'mention')).toEqual([])
    expect(all.length).toBeGreaterThan(0)
    for (const reply of all) expect(reply.fit).toMatchObject({ relevant: true, replyWorthy: true })
  })

  it('drafts within the day’s budget, and records the operator’s posted reply by its link', async () => {
    const t = setup()
    const account = await t.run((ctx) => insertAccount(ctx))
    await setBudget(t, account, 2)
    await listenNow(t, account)
    vi.setSystemTime(Date.now() + WINDOW_MS)
    await listenNow(t, account)
    const page = await view(t, account)
    // Two drafts today over two sweeps; what else was heard waits for tomorrow's budget.
    expect([page.waiting.length, page.draftedToday]).toEqual([2, 2])
    expect(page.beingWritten.length).toBeGreaterThan(0)
    const [first, second] = page.waiting
    if (!first || !second) throw new Error('the sweep left fewer than two drafts')

    await expect(
      t.mutation(api.private.replies.markPosted, { replyId: first._id, text: first.text, url: 'https://example.com/1' })
    ).rejects.toThrow('That is no link to your post or reply on X.')
    // The operator edited the draft before posting it: the record keeps the words that went out.
    await t.mutation(api.private.replies.markPosted, { replyId: first._id, text: '  Edited before posting.  ' })
    const after = await view(t, account)
    expect(after.posted.map((reply) => [reply._id, reply.text, reply.posted?.kind])).toEqual([
      [first._id, 'Edited before posting.', 'said'],
    ])
    // On X the draft was ready to post, so how much the operator changed is kept: here, all of it.
    expect(after.posted[0]?.posted?.editShare).toBe(1)
    await expect(t.mutation(api.private.replies.markPosted, { replyId: first._id, text: first.text })).rejects.toThrow(
      'This reply is posted; only a reply waiting for you can be marked posted.'
    )

    await t.mutation(api.private.replies.skip, { replyId: second._id })
    expect((await view(t, account)).skipped.map((reply) => [reply._id, reply.skipReason])).toContainEqual([second._id, 'You passed on it.'])
    const [heard] = after.beingWritten
    if (!heard) throw new Error('nothing waits to be written')
    await expect(t.mutation(api.private.replies.skip, { replyId: heard._id })).rejects.toThrow(
      'This reply is being written; only one waiting for you can be skipped.'
    )
  })

  it('passes on a draft and a heard post nobody touched within a day', async () => {
    const t = setup()
    const account = await t.run((ctx) => insertAccount(ctx))
    await setBudget(t, account, 1)
    await listenNow(t, account)
    const before = await view(t, account)
    expect(before.waiting).toHaveLength(1)
    expect(before.beingWritten.length).toBeGreaterThan(0)

    vi.setSystemTime(Date.now() + DRAFT_STALE_MS + WINDOW_MS)
    await listenNow(t, account)
    const after = await view(t, account)
    const stale = after.skipped.filter((reply) => reply.skipReason?.startsWith('Went stale'))
    expect(stale.map((reply) => reply._id).sort()).toEqual([...before.waiting, ...before.beingWritten].map((reply) => reply._id).sort())
  })

  it('writes the reply the operator asks for on a post naming the sponsor, and measures what posted replies brought back', async () => {
    const t = setup()
    const account = await t.run((ctx) => insertAccount(ctx))
    if (!sponsorWindow()) vi.setSystemTime(Date.now() + WINDOW_MS)
    await listenNow(t, account)
    const sponsored = (await view(t, account)).skipped.find((reply) => reply.thread.text.includes('Formstep'))
    if (!sponsored) throw new Error('the sweep heard no post naming the sponsor')

    await t.mutation(api.private.replies.ask, { replyId: sponsored._id })
    await t.finishAllScheduledFunctions(() => {})
    const asked = (await view(t, account)).waiting.find((reply) => reply._id === sponsored._id)
    expect(asked).toMatchObject({ operatorAsked: true, status: 'draft' })
    expect(asked?.text).toContain('Formstep does that')
    if (!asked) throw new Error('the asked reply is not waiting')

    await operatorPosts(t, asked)
    await t.mutation(api.private.accounts.pullMetrics, { accountId: account._id })
    await t.finishAllScheduledFunctions(() => {})
    const [posted] = (await view(t, account)).posted
    const counts = posted?.numbers?.counts
    if (posted === undefined || counts?.platform !== 'x') throw new Error('the reply on X has no numbers from X')
    expect(counts.impressions).toBeGreaterThan(0)

    // The report counts its reach, and lists it among what went out.
    const report = await t.query(api.private.report.forAccount, { accountId: account._id })
    expect(report?.funnel).toMatchObject({ items: 1, counted: 1, reach: counts.impressions, reached: 1, mock: true })
    expect(report?.posted).toMatchObject([{ kind: 'reply', _id: posted._id, numbers: posted.numbers }])

    // Past its window it is measured, and the analyst stops reading it.
    vi.setSystemTime(Date.now() + 8 * 24 * 3_600_000)
    await t.mutation(api.private.accounts.pullMetrics, { accountId: account._id })
    await t.finishAllScheduledFunctions(() => {})
    expect((await view(t, account)).posted.map((reply) => reply.status)).toEqual(['measured'])
  })

  it('tests reply styles on the replies it hears, and answers in the winner once it is decided', async () => {
    const t = setup()
    const account = await t.run((ctx) => insertAccount(ctx))
    await setBudget(t, account, 20)
    const [tip, question] = EXPERIMENT_CATALOG.reply_style
    if (!tip || !question) throw new Error('the reply style catalog lost a variant')
    const experimentId = await t.mutation(api.private.experiments.create, {
      accountId: account._id,
      name: 'Reply style: Question back vs Tip',
      hypothesis: 'A question back reaches more than a tip.',
      kind: 'reply_style',
      metric: 'reach',
      variants: [tip, question],
      minItems: 1_000,
      minConfidence: 0.9,
    })

    // Every reply worth answering carries a style, the two in turn, and the writer writes in it.
    await listenNow(t, account)
    const heard = await view(t, account)
    const styles = heard.waiting.map((reply) => reply.variantKey)
    expect(heard.waiting.length).toBeGreaterThanOrEqual(2)
    for (const reply of heard.waiting) expect(reply.experimentId).toBe(experimentId)
    const count = (key: string) => styles.filter((style) => style === key).length
    expect(Math.abs(count('tip') - count('question'))).toBeLessThanOrEqual(1)
    for (const reply of heard.waiting) expect(reply.text.endsWith('?')).toBe(reply.variantKey === 'question')
    for (const reply of heard.skipped) expect(reply.variantKey).toBeUndefined()

    // The operator posts them all, and the analyst reads what they brought back; past their window they count toward the test.
    for (const reply of heard.waiting) await operatorPosts(t, reply)
    await t.mutation(api.private.accounts.pullMetrics, { accountId: account._id })
    await t.finishAllScheduledFunctions(() => {})
    const [inWindow] = await t.query(api.private.experiments.list, { accountId: account._id })
    for (const stat of inWindow?.stats ?? []) expect(stat.items).toBe(0)
    vi.setSystemTime(Date.now() + 8 * 24 * 3_600_000)
    await t.mutation(api.private.accounts.pullMetrics, { accountId: account._id })
    await t.finishAllScheduledFunctions(() => {})
    const [running] = await t.query(api.private.experiments.list, { accountId: account._id })
    expect(running?.status).toBe('running')
    for (const stat of running?.stats ?? []) {
      expect(stat.items).toBe(count(stat.key))
      expect(stat.sum).toBeGreaterThan(0)
    }

    await t.mutation(api.private.experiments.override, { experimentId, winnerKey: 'question', note: 'Questions start conversations.' })
    const learned = await t.run(async (ctx) => {
      const reloaded = await ctx.db.get(account._id)
      const memories = await ctx.db
        .query('memories')
        .withIndex('by_account_status', (q) => q.eq('accountId', account._id).eq('status', 'active'))
        .collect()
      return { defaults: reloaded?.strategy?.defaults, learnings: memories.filter((memory) => memory.dimension === 'reply_style') }
    })
    expect(learned.defaults).toEqual([expect.objectContaining({ kind: 'reply_style', key: 'question', experimentId })])
    expect(learned.learnings.map((learning) => learning.text)).toEqual([
      'Reply style: "Question back" over "Tip", chosen by the operator: Questions start conversations.',
    ])

    // The next sweep carries no variant, and every reply asks a question back.
    vi.setSystemTime(Date.now() + WINDOW_MS)
    await listenNow(t, account)
    const next = (await view(t, account)).waiting
    expect(next.length).toBeGreaterThan(0)
    for (const reply of next) {
      expect(reply.variantKey).toBeUndefined()
      expect(reply.text.endsWith('?')).toBe(true)
    }
  })

  it('answers the found posts of smaller accounts while a reply target test gives a sweep where a reply stands out', async () => {
    const t = setup()
    const account = await t.run((ctx) => insertAccount(ctx))
    await setBudget(t, account, 20)
    const [reach, standout] = EXPERIMENT_CATALOG.reply_target
    if (!reach || !standout) throw new Error('the reply target catalog lost a variant')
    const experimentId = await t.mutation(api.private.experiments.create, {
      accountId: account._id,
      name: 'Reply target: Where a reply stands out vs Most reach',
      hypothesis: 'Where a reply stands out it reaches more.',
      kind: 'reply_target',
      metric: 'reach',
      variants: [reach, standout],
      minItems: 1_000,
      minConfidence: 0.9,
    })
    // Sweeps in turn get the variant with the fewest replies, so within a few windows both have found posts.
    const found = []
    for (let window = 0; window < 6; window += 1) {
      await listenNow(t, account)
      vi.setSystemTime(Date.now() + WINDOW_MS)
    }
    const page = await view(t, account)
    for (const reply of [...page.waiting, ...page.skipped]) {
      if (reply.origin !== 'search' || reply.status === 'skipped') {
        expect(reply.variantKey).toBeUndefined()
        continue
      }
      expect(reply.experimentId).toBe(experimentId)
      found.push(reply)
    }
    const byStandout = found.filter((reply) => reply.variantKey === 'standout')
    expect(byStandout.length).toBeGreaterThan(0)
    expect(found.some((reply) => reply.variantKey === 'reach')).toBe(true)
    for (const reply of byStandout) expect(reply.thread.reach).toBeLessThan(REPLY_PEER_MAX)
  })

  it('writes the thread the operator pasted first, whatever is left of the day’s budget', async () => {
    const t = setup()
    const account = await t.run((ctx) => insertAccount(ctx))
    await setBudget(t, account, 1)
    await listenNow(t, account)
    expect((await view(t, account)).waiting).toHaveLength(1)

    const url = 'https://x.com/dana/status/1840000000000000001'
    await t.action(api.private.replies.pasteThread, { accountId: account._id, url, text: 'How do you stop retries running twice?' })
    await t.finishAllScheduledFunctions(() => {})
    const page = await view(t, account)
    // It waits first, ahead of the drafts that reach more.
    expect(page.waiting).toHaveLength(2)
    expect(page.waiting[0]).toMatchObject({ origin: 'pasted', status: 'draft', inReplyTo: '1840000000000000001', thread: { reach: null } })
    expect(page.beingWritten.length).toBeGreaterThan(0)
  })

  it('keeps the sponsor within the dial over the drafts of one sweep and the drafts that wait', async () => {
    const t = setup()
    const account = await t.run((ctx) => insertAccount(ctx))
    await setBudget(t, account, 20)
    // Four replies posted this week name nobody, at the fixture's 40% dial.
    for (let posted = 0; posted < 4; posted += 1) {
      await t.run((ctx) => insertPostedReply(ctx, account, { heardAt: Date.now() - 3_600_000, impressions: 0, follows: 0 }))
    }
    const write = mockLlm.writeReply.bind(mockLlm)
    vi.spyOn(mockLlm, 'writeReply').mockImplementation(async (brief) =>
      brief.mayNameSponsor ? { kind: 'reply', text: `${brief.affiliationLine} Formstep does that.` } : write(brief)
    )
    const naming = async () => (await view(t, account)).waiting.filter((reply) => reply.text.includes('Formstep does that.'))
    const writeHeard = async (count: number) => {
      for (let index = 0; index < count; index += 1) await t.run((ctx) => insertHeard(ctx, account, `${Date.now()}-${index}`))
      await t.action(internal.internal.replies.writeReplies, { accountId: account._id })
    }

    // Each draft counts as posted the moment it is written, naming the sponsor or not: 1 of 5, 2 of 6, not 3 of 7, then 3 of 8.
    await writeHeard(4)
    expect((await view(t, account)).waiting).toHaveLength(4)
    expect(await naming()).toHaveLength(3)
    // The next run counts the four drafts that wait: not 4 of 9, then 4 of 10.
    await writeHeard(2)
    expect(await naming()).toHaveLength(4)
    // Then the dial is full: 5 of 11 would pass it.
    await writeHeard(1)
    expect(await naming()).toHaveLength(4)
  })
})
