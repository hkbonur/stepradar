import { PROBLEM_SCORE } from '@influstep/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import { addDays, dayKey, weekStart } from './core/dates'
import type { PostBrief } from './providers/llm'
import { mockLlm } from './providers/llm/mock'
import { TIMEZONE, insertPost, insertAccount, insertSignal } from '../test/fixtures'
import { setup } from '../test/setup'

/**
 * The research loop of docs/plan.md, v0.2 item 9, on mock providers: the
 * morning sweep stores what the sources found with when it was posted, logs
 * the question readers keep asking and writes the brief; the write pass
 * the day before swaps a reactive concept that went cold; the planner ranks
 * by freshness and leaves cold signals out.
 */

const HOUR = 3_600_000
const DAY = 24 * HOUR

type Test = ReturnType<typeof setup>

afterEach(() => {
  vi.restoreAllMocks()
})

async function signalsOf(t: Test, accountId: Id<'accounts'>): Promise<Doc<'signals'>[]> {
  return t.run((ctx) =>
    ctx.db
      .query('signals')
      .withIndex('by_account_status', (q) => q.eq('accountId', accountId))
      .collect()
  )
}

async function memoriesOf(t: Test, accountId: Id<'accounts'>): Promise<Doc<'memories'>[]> {
  return t.run((ctx) =>
    ctx.db
      .query('memories')
      .withIndex('by_account_status', (q) => q.eq('accountId', accountId).eq('status', 'active'))
      .collect()
  )
}

describe('the morning sweep', () => {
  it('stores what the sources found with when it was posted, logs the repeated question, and writes the brief', async () => {
    const t = setup()
    const account = await t.run(async (ctx) => {
      const ada = await insertAccount(ctx)
      // Three readers asked one question in their own words; the comment poll stored them.
      const now = Date.now()
      for (const [index, title] of [
        'Can you show how to retry a failed webhook step?',
        'How do I retry a failed webhook step in n8n?',
        'Is there a way to retry the failed webhook step?',
      ].entries()) {
        await insertSignal(ctx, ada, {
          title,
          source: 'comments',
          foundAt: now - (3 - index) * DAY,
          publishedAt: now - (3 - index) * DAY - HOUR,
        })
      }
      return ada
    })

    await t.mutation(internal.internal.schedule.morningSweep, {})
    await t.finishAllScheduledFunctions(() => {})

    const job = await t.run(async (ctx) =>
      ctx.db
        .query('jobs')
        .withIndex('by_account_kind', (q) => q.eq('accountId', account._id).eq('kind', 'morning_sweep'))
        .unique()
    )
    expect(job).toMatchObject({ status: 'done', role: 'researcher', result: { problems: 1 } })

    const signals = await signalsOf(t, account._id)
    const polled = signals.filter((signal) => signal.source !== 'comments' && signal.source !== 'problems')
    expect(polled.length).toBeGreaterThan(0)
    // Every source says when an item was posted, and freshness decays from that.
    expect(polled.every((signal) => signal.publishedAt !== undefined)).toBe(true)
    expect(polled.some((signal) => signal.source === 'search')).toBe(true)

    const memories = await memoriesOf(t, account._id)
    const problems = memories.filter((memory) => memory.kind === 'problem')
    expect(problems.map((problem) => problem.text)).toEqual([
      'Readers keep asking: "Can you show how to retry a failed webhook step?" (3 times under my posts).',
    ])
    const candidate = signals.find((signal) => signal.source === 'problems')
    expect(candidate).toMatchObject({ externalId: problems[0]?._id, score: PROBLEM_SCORE, status: 'new', url: '' })

    // The brief names the problem it was written after, and what the sources found.
    const briefs = memories.filter((memory) => memory.kind === 'brief')
    expect(briefs).toHaveLength(1)
    const [brief] = briefs
    expect(job?.result).toMatchObject({ briefId: brief?._id })
    expect(brief?.text).toContain('The strongest:')
    expect(brief?.text).toContain(`Open problems: ${problems[0]?.text}`)
    expect(brief?.evidence.signalIds.length).toBe(5)

    // The writer reads it.
    const post = await t.run(async (ctx) =>
      insertPost(ctx, account, { status: 'idea', plannedFor: addDays(dayKey(Date.now(), TIMEZONE), 1) })
    )
    const context = await t.query(internal.internal.writer.getPostContext, { postId: post._id })
    expect(context.research).toEqual({ brief: brief?.text, problems: [problems[0]?.text] })
  })
})

describe('the last check', () => {
  it("swaps tomorrow's reactive idea whose signal went cold before the writer writes it, and journals why", async () => {
    const t = setup()
    const briefs: PostBrief[] = []
    const write = mockLlm.writePost.bind(mockLlm)
    vi.spyOn(mockLlm, 'writePost').mockImplementation(async (brief) => {
      briefs.push(brief)
      return write(brief)
    })
    const { account, post, cold, fresh } = await t.run(async (ctx) => {
      const ada = await insertAccount(ctx)
      const now = Date.now()
      const cold = await insertSignal(ctx, ada, {
        title: 'n8n credentials vanished after the upgrade',
        score: 85,
        foundAt: now - 10 * DAY,
        publishedAt: now - 10 * DAY,
        status: 'used',
      })
      const fresh = await insertSignal(ctx, ada, {
        title: 'n8n queue mode for webhooks',
        score: 88,
        foundAt: now - 2 * HOUR,
        publishedAt: now - 3 * HOUR,
      })
      // Planned last week as the planner leaves it: an idea with no write job yet.
      const post = await insertPost(ctx, ada, {
        status: 'idea',
        plannedFor: addDays(dayKey(now, TIMEZONE), 1),
        concept: `React to: ${cold.title}`,
        pillar: 'n8n tutorials',
      })
      await ctx.db.patch(post._id, { signalIds: [cold._id] })
      return { account: ada, post, cold, fresh }
    })

    expect(await t.mutation(internal.internal.schedule.writeDuePosts, {})).toEqual({ queued: 1, skipped: 0 })
    await t.finishAllScheduledFunctions(() => {})

    const written = await t.run((ctx) => ctx.db.get(post._id))
    expect(written).toMatchObject({
      status: 'draft',
      concept: 'React to: n8n queue mode for webhooks',
      signalIds: [fresh._id],
      pillar: 'n8n tutorials',
    })
    // The judge may send the draft back once: the writer writes the swapped concept every time.
    expect(new Set(briefs.map((brief) => brief.concept))).toEqual(new Set(['React to: n8n queue mode for webhooks']))
    const journal = await t.run((ctx) =>
      ctx.db
        .query('journal')
        .withIndex('by_account_time', (q) => q.eq('accountId', account._id))
        .collect()
    )
    expect(journal).toMatchObject([
      {
        kind: 'concept_swapped',
        actor: 'researcher',
        evidence: { postIds: [post._id], signalIds: [cold._id, fresh._id] },
      },
    ])
    expect(journal[0]?.text).toMatch(/^Swapped "n8n credentials vanished after the upgrade" for "n8n queue mode for webhooks" on /)

    // The strategy page names both signals of the swap by title.
    const strategy = await t.query(api.private.strategy.get, { accountId: account._id })
    expect(strategy?.signals.map((signal) => signal.title).sort()).toEqual([cold.title, fresh.title].sort())

    // The pass runs again the same morning: the post is written, so nothing is queued twice.
    expect(await t.mutation(internal.internal.schedule.writeDuePosts, {})).toEqual({ queued: 0, skipped: 0 })
  })
})

describe('the planner', () => {
  it('builds reactive ideas on the freshest signals and leaves cold ones out, however high they scored', async () => {
    const t = setup()
    const { account, cold, fresh } = await t.run(async (ctx) => {
      const ada = await insertAccount(ctx)
      const now = Date.now()
      const cold = await insertSignal(ctx, ada, {
        title: 'A thread from last month',
        score: 99,
        foundAt: now - 12 * DAY,
        publishedAt: now - 12 * DAY,
      })
      const fresh = await insertSignal(ctx, ada, {
        title: 'A thread from this morning',
        score: 60,
        foundAt: now - HOUR,
        publishedAt: now - HOUR,
      })
      return { account: ada, cold, fresh }
    })

    const nextMonday = addDays(weekStart(dayKey(Date.now(), TIMEZONE)), 7)
    await t.mutation(internal.internal.writer.planWeek, { accountId: account._id, weekStart: nextMonday })

    const posts = await t.run((ctx) =>
      ctx.db
        .query('posts')
        .withIndex('by_account', (q) => q.eq('accountId', account._id))
        .collect()
    )
    const fed = posts.flatMap((post) => post.signalIds)
    expect(fed).toContain(fresh._id)
    expect(fed).not.toContain(cold._id)
    expect((await t.run((ctx) => ctx.db.get(cold._id)))?.status).toBe('new')
  })
})

describe('the Signals page', () => {
  it('lists the freshest signals of the account before the cut, without dismissed ones or another account’s', async () => {
    const t = setup()
    const { ada, max, refound, maxs } = await t.run(async (ctx) => {
      const ada = await insertAccount(ctx)
      const max = await insertAccount(ctx, { name: 'Max', handle: 'max.builds' })
      const now = Date.now()
      // A page's worth of weak signals found this hour, all newer finds than the suggestion below.
      for (let index = 0; index < 200; index += 1) {
        await insertSignal(ctx, ada, { title: `Weak ${index}`, score: 10, foundAt: now - HOUR, publishedAt: now - HOUR })
      }
      // A search suggestion first found four days ago and found again now: as fresh as its latest find.
      const refound = await insertSignal(ctx, ada, {
        title: 'n8n retry failed execution',
        source: 'search',
        score: 70,
        foundAt: now - 4 * DAY,
        publishedAt: now,
      })
      await insertSignal(ctx, ada, { title: 'Dismissed', score: 99, foundAt: now, publishedAt: now, status: 'dismissed' })
      const maxs = await insertSignal(ctx, max, { title: 'Max’s', score: 90, foundAt: now, publishedAt: now })
      return { ada, max, refound, maxs }
    })

    const adas = await t.query(api.private.signals.list, { accountId: ada._id })
    expect(adas).toHaveLength(200)
    expect(adas[0]).toMatchObject({ _id: refound._id, account: { handle: ada.handle, platform: 'x' } })
    expect(adas.some((signal) => signal.status === 'dismissed' || signal.accountId === max._id)).toBe(false)

    const everyone = await t.query(api.private.signals.list, {})
    expect(everyone).toHaveLength(200)
    expect(everyone.slice(0, 2).map((signal) => signal._id)).toEqual([maxs._id, refound._id])
  })
})
