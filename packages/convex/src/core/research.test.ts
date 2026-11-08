import { describe, expect, it } from 'vitest'
import { BRIEF_TTL_MS, PROBLEM_SCORE } from '@influstep/shared'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'
import { insertPost, insertAccount, insertSignal } from '../../test/fixtures'
import { setup } from '../../test/setup'
import { activeBrief, lastCheck, latestBrief, logRepeatedQuestions, researchFor, writeDailyBrief } from './research'

const HOUR = 3_600_000
const DAY = 24 * HOUR
/** A Tuesday morning, after the sweep. */
const NOW = Date.UTC(2026, 9, 13, 6, 15)

async function problemsOf(ctx: MutationCtx, accountId: Id<'accounts'>): Promise<Doc<'memories'>[]> {
  const memories = await ctx.db
    .query('memories')
    .withIndex('by_account_kind_status', (q) => q.eq('accountId', accountId).eq('kind', 'problem'))
    .collect()
  return memories
}

async function candidatesOf(ctx: MutationCtx, accountId: Id<'accounts'>): Promise<Doc<'signals'>[]> {
  const signals = await ctx.db
    .query('signals')
    .withIndex('by_account_status', (q) => q.eq('accountId', accountId))
    .collect()
  return signals.filter((signal) => signal.source === 'problems')
}

async function insertProblem(ctx: MutationCtx, account: Doc<'accounts'>, text: string, createdAt: number) {
  return ctx.db.insert('memories', {
    accountId: account._id,
    kind: 'problem',
    text,
    actor: 'researcher',
    evidence: { postIds: [], signalIds: [] },
    key: `tool:${text}`,
    status: 'active',
    createdAt,
  })
}

/** A reactive idea for `plannedFor`, built on `signal`. */
async function reactiveIdea(ctx: MutationCtx, account: Doc<'accounts'>, signal: Doc<'signals'>, plannedFor: string) {
  const post = await insertPost(ctx, account, {
    status: 'idea',
    plannedFor,
    concept: `React to: ${signal.title}`,
    pillar: 'n8n tutorials',
  })
  await ctx.db.patch(post._id, { signalIds: [signal._id] })
  await ctx.db.patch(signal._id, { status: 'used' })
  return post
}

describe('writeDailyBrief', () => {
  it('counts what each source found in the last day, names the five freshest and the open problems, and expires', async () => {
    const t = setup()
    await t.run(async (ctx) => {
      const account = await insertAccount(ctx)
      const queue = await insertSignal(ctx, account, {
        title: 'n8n queue mode for webhooks',
        source: 'reddit',
        score: 88,
        foundAt: NOW - 2 * HOUR,
        publishedAt: NOW - 3 * HOUR,
      })
      const search = await insertSignal(ctx, account, {
        title: 'n8n error workflow',
        source: 'search',
        score: 70,
        foundAt: NOW - 2 * HOUR,
        publishedAt: NOW - 2 * HOUR,
      })
      // A source that says nothing about when is dated by when it was found.
      const trend = await insertSignal(ctx, account, { title: 'n8n vs make', source: 'reddit', score: 64, foundAt: NOW - 10 * HOUR })
      const hn = await insertSignal(ctx, account, {
        title: 'Show HN: a webhook inspector',
        source: 'hackernews',
        score: 50,
        foundAt: NOW - HOUR,
        publishedAt: NOW - HOUR,
      })
      const comment = await insertSignal(ctx, account, {
        title: 'Is there a way to retry the failed webhook step?',
        source: 'comments',
        score: 58,
        foundAt: NOW - 18 * HOUR,
        publishedAt: NOW - 20 * HOUR,
      })
      // The sixth of the day: counted, but not among the five named.
      await insertSignal(ctx, account, {
        title: 'A slow thread',
        source: 'reddit',
        score: 40,
        foundAt: NOW - 5 * HOUR,
        publishedAt: NOW - 5 * HOUR,
      })
      // Neither found nor posted in the last day, and dismissed: left out.
      await insertSignal(ctx, account, {
        title: 'Old news',
        source: 'hackernews',
        score: 81,
        foundAt: NOW - 30 * HOUR,
        publishedAt: NOW - 40 * HOUR,
      })
      await insertSignal(ctx, account, { title: 'Dismissed', source: 'reddit', score: 99, foundAt: NOW - HOUR, status: 'dismissed' })
      await insertProblem(ctx, account, 'Readers keep asking how to retry a failed webhook step.', NOW - DAY)

      const briefId = await writeDailyBrief(ctx, account, NOW)
      const brief = await ctx.db.get(briefId)
      expect(brief).toMatchObject({
        kind: 'brief',
        status: 'active',
        expiresAt: NOW + BRIEF_TTL_MS,
        evidence: { postIds: [], signalIds: [queue._id, search._id, trend._id, hn._id, comment._id] },
      })
      expect(brief?.confidence).toBeUndefined()
      expect(brief?.text).toBe(
        [
          'Hacker News: 1 new item.',
          'Reddit: 3 new items.',
          'Search suggestions: 1 new item.',
          'Comments: 1 new item.',
          'The strongest:',
          '"n8n queue mode for webhooks" (Reddit, freshness 84)',
          '"n8n error workflow" (Search suggestions, freshness 68)',
          '"n8n vs make" (Reddit, freshness 55)',
          '"Show HN: a webhook inspector" (Hacker News, freshness 49)',
          '"Is there a way to retry the failed webhook step?" (Comments, freshness 43)',
          'Open problems: Readers keep asking how to retry a failed webhook step.',
        ].join('\n')
      )
    })
  })

  it('says nothing moved when nothing did, supersedes the brief before it, and is never read once expired', async () => {
    const t = setup()
    await t.run(async (ctx) => {
      const account = await insertAccount(ctx)
      await insertSignal(ctx, account, { title: 'Yesterday', foundAt: NOW - 2 * HOUR, publishedAt: NOW - 2 * HOUR })
      const first = await writeDailyBrief(ctx, account, NOW)
      expect((await activeBrief(ctx, account._id, NOW + HOUR))?._id).toBe(first)

      const later = NOW + 2 * DAY
      const second = await writeDailyBrief(ctx, account, later)
      expect(await ctx.db.get(second)).toMatchObject({ text: 'Nothing new moved since yesterday.', evidence: { signalIds: [] } })
      expect(await ctx.db.get(first)).toMatchObject({ status: 'superseded', supersededBy: second })
      expect((await activeBrief(ctx, account._id, later))?._id).toBe(second)

      // The cron missed a morning: the writer reads no brief rather than an old one. The account page still gets
      // the newest, and hides it by its expiry on its own clock.
      expect(await activeBrief(ctx, account._id, later + BRIEF_TTL_MS)).toBeNull()
      expect(await latestBrief(ctx, account._id)).toMatchObject({ _id: second, expiresAt: later + BRIEF_TTL_MS })
      expect(await researchFor(ctx, account._id, later + BRIEF_TTL_MS)).toEqual({ brief: null, problems: [] })
    })
  })
})

describe('researchFor', () => {
  it('hands the writer the brief in force and the five newest open problems', async () => {
    const t = setup()
    await t.run(async (ctx) => {
      const account = await insertAccount(ctx)
      for (let index = 0; index < 6; index += 1) await insertProblem(ctx, account, `Problem ${index}.`, NOW - (6 - index) * HOUR)
      await writeDailyBrief(ctx, account, NOW)
      const research = await researchFor(ctx, account._id, NOW + HOUR)
      expect(research.brief).toMatch(/^Nothing new moved since yesterday\.\nOpen problems: /)
      expect(research.problems).toEqual(['Problem 5.', 'Problem 4.', 'Problem 3.', 'Problem 2.', 'Problem 1.'])
    })
  })
})

describe('logRepeatedQuestions', () => {
  it('logs a question asked three times in different words once, with one candidate, and folds later askers in', async () => {
    const t = setup()
    await t.run(async (ctx) => {
      const account = await insertAccount(ctx)
      const asked = async (title: string, hoursAgo: number, fields: { status?: 'dismissed' } = {}) =>
        insertSignal(ctx, account, {
          title,
          source: 'comments',
          foundAt: NOW - hoursAgo * HOUR + HOUR,
          publishedAt: NOW - hoursAgo * HOUR,
          ...fields,
        })
      const first = await asked('Can you show how to retry a failed webhook step?', 120)
      const second = await asked('How do I retry a failed webhook step in n8n?', 72)
      const third = await asked('Is there a way to retry the failed webhook step?', 20)
      // Not counted: outside the window, dismissed, no question, and a question asked once.
      await asked('Could you retry a failed webhook step for me?', 20 * 24)
      await asked('Can I retry a failed webhook step twice?', 10, { status: 'dismissed' })
      await asked('Retry the failed webhook step, it works great', 8)
      await asked('What camera do you use?', 6)

      const written = await logRepeatedQuestions(ctx, account, NOW)
      expect(written).toHaveLength(1)
      const [problem] = await problemsOf(ctx, account._id)
      expect(problem).toMatchObject({
        _id: written[0],
        status: 'active',
        key: 'question:failed retry step webhook',
        text: 'Readers keep asking: "Can you show how to retry a failed webhook step?" (3 times under my posts).',
        evidence: { postIds: [], signalIds: [first._id, second._id, third._id] },
      })
      const candidates = await candidatesOf(ctx, account._id)
      expect(candidates).toHaveLength(1)
      expect(candidates[0]).toMatchObject({
        source: 'problems',
        externalId: written[0],
        title: 'Can you show how to retry a failed webhook step?',
        summary: problem?.text,
        url: '',
        score: PROBLEM_SCORE,
        topics: ['failed', 'retry', 'step', 'webhook'],
        status: 'new',
        foundAt: NOW,
        publishedAt: NOW,
      })

      // The next morning: the same question again writes nothing new.
      expect(await logRepeatedQuestions(ctx, account, NOW + DAY)).toEqual([])
      // A fourth asker joins the problem's evidence; one who drops "step" narrows the shared words, and so
      // the key, but holds the same comments, so it is still the same problem.
      const fourth = await asked('How can I retry a failed webhook step after a timeout?', 2)
      const fifth = await asked('Retry failed webhook?', 1)
      expect(await logRepeatedQuestions(ctx, account, NOW + DAY)).toEqual([])
      const problems = await problemsOf(ctx, account._id)
      expect(problems).toHaveLength(1)
      expect(problems[0]?.text).toBe(problem?.text)
      expect(problems[0]?.evidence.signalIds).toEqual([first._id, second._id, third._id, fourth._id, fifth._id])
      expect(await candidatesOf(ctx, account._id)).toHaveLength(1)
    })
  })

  it('counts only comments that ask something themselves, not the post they are under', async () => {
    const t = setup()
    await t.run(async (ctx) => {
      const account = await insertAccount(ctx)
      // As the comment poll stores them: the comment as the title, its likes and the post's title as the summary.
      for (const [title, hoursAgo] of [
        ['This saved my Monday. Subscribed.', 30],
        ['This saved my Monday. Subscribed.', 20],
        ['This saved my Monday. Subscribed.', 10],
      ] as const) {
        await insertSignal(ctx, account, {
          title,
          source: 'comments',
          summary: '12 likes under "Is n8n worth it?" on X',
          foundAt: NOW - hoursAgo * HOUR,
          publishedAt: NOW - hoursAgo * HOUR,
        })
      }

      expect(await logRepeatedQuestions(ctx, account, NOW)).toEqual([])
      expect(await problemsOf(ctx, account._id)).toEqual([])
      expect(await candidatesOf(ctx, account._id)).toEqual([])
    })
  })
})

describe('lastCheck', () => {
  it('swaps a reactive idea whose signal went cold for the freshest new signal, and journals why', async () => {
    const t = setup()
    await t.run(async (ctx) => {
      const account = await insertAccount(ctx)
      const cold = await insertSignal(ctx, account, {
        title: 'n8n credentials vanished after the upgrade',
        score: 85,
        foundAt: NOW - 10 * DAY,
        publishedAt: NOW - 10 * DAY,
      })
      const post = await reactiveIdea(ctx, account, cold, '2026-10-14')
      const fresh = await insertSignal(ctx, account, {
        title: 'n8n queue mode for webhooks',
        score: 88,
        foundAt: NOW - 2 * HOUR,
        publishedAt: NOW - 3 * HOUR,
      })
      await insertSignal(ctx, account, {
        title: 'Weaker',
        source: 'search',
        score: 70,
        foundAt: NOW - 2 * HOUR,
        publishedAt: NOW - 2 * HOUR,
      })
      await insertSignal(ctx, account, { title: 'Dismissed', score: 99, foundAt: NOW, publishedAt: NOW, status: 'dismissed' })

      expect(await lastCheck(ctx, post._id, NOW)).toEqual({
        swapped: true,
        from: 'React to: n8n credentials vanished after the upgrade',
        to: 'React to: n8n queue mode for webhooks',
      })
      expect(await ctx.db.get(post._id)).toMatchObject({
        status: 'idea',
        concept: 'React to: n8n queue mode for webhooks',
        title: 'React to: n8n queue mode for webhooks',
        signalIds: [fresh._id],
        pillar: 'n8n tutorials',
      })
      expect((await ctx.db.get(fresh._id))?.status).toBe('used')
      expect((await ctx.db.get(cold._id))?.status).toBe('used')
      const journal = await ctx.db
        .query('journal')
        .withIndex('by_account_time', (q) => q.eq('accountId', account._id))
        .collect()
      expect(journal).toMatchObject([
        {
          kind: 'concept_swapped',
          actor: 'researcher',
          text: 'Swapped "n8n credentials vanished after the upgrade" for "n8n queue mode for webhooks" on Wed 14 Oct.',
          reason:
            '"n8n credentials vanished after the upgrade" went cold: its signal is 10 days old, freshness 3. ' +
            '"n8n queue mode for webhooks" is the strongest fresh signal (Reddit, freshness 84).',
          evidence: {
            postIds: [post._id],
            signalIds: [cold._id, fresh._id],
            numbers: [
              { label: 'Old freshness', value: 3 },
              { label: 'New freshness', value: 84 },
            ],
          },
        },
      ])
      const messages = await ctx.db
        .query('messages')
        .withIndex('by_account', (q) => q.eq('accountId', account._id))
        .collect()
      expect(messages).toEqual([])
    })
  })

  it('swaps an idea whose signal is gone as if it went cold, and keeps it when nothing is fresh enough', async () => {
    const t = setup()
    await t.run(async (ctx) => {
      const account = await insertAccount(ctx)
      // Dismissed on the Signals page after it was used, then aged out while the ideas waited for their write day.
      const gone = await insertSignal(ctx, account, { title: 'Gone', score: 85, foundAt: NOW - DAY, publishedAt: NOW - DAY })
      const swapped = await reactiveIdea(ctx, account, gone, '2026-10-14')
      const kept = await reactiveIdea(ctx, account, gone, '2026-10-15')
      await ctx.db.delete(gone._id)

      // Freshness 49: below the bar a swap needs.
      const weak = await insertSignal(ctx, account, { title: 'Not fresh enough', score: 70, foundAt: NOW - DAY, publishedAt: NOW - DAY })
      expect(await lastCheck(ctx, kept._id, NOW)).toEqual({ swapped: false })
      expect(await ctx.db.get(kept._id)).toMatchObject({ concept: kept.concept, signalIds: [gone._id] })
      await ctx.db.delete(weak._id)

      const fresh = await insertSignal(ctx, account, {
        title: 'n8n queue mode for webhooks',
        score: 88,
        foundAt: NOW - 2 * HOUR,
        publishedAt: NOW - 3 * HOUR,
      })
      expect(await lastCheck(ctx, swapped._id, NOW)).toEqual({
        swapped: true,
        from: 'React to: Gone',
        to: 'React to: n8n queue mode for webhooks',
      })
      expect(await ctx.db.get(swapped._id)).toMatchObject({ concept: 'React to: n8n queue mode for webhooks', signalIds: [fresh._id] })
      const journal = await ctx.db
        .query('journal')
        .withIndex('by_account_time', (q) => q.eq('accountId', account._id))
        .collect()
      expect(journal).toMatchObject([
        {
          kind: 'concept_swapped',
          text: 'Swapped "React to: Gone" for "n8n queue mode for webhooks" on Wed 14 Oct.',
          reason:
            '"React to: Gone" lost its signal: it is no longer among the signals, so nothing says it still matters. ' +
            '"n8n queue mode for webhooks" is the strongest fresh signal (Reddit, freshness 84).',
          evidence: { postIds: [swapped._id], signalIds: [fresh._id], numbers: [{ label: 'New freshness', value: 84 }] },
        },
      ])
    })
  })

  it('keeps the concept while its signal is warm, when nothing new is fresh enough, and for an evergreen or written post', async () => {
    const t = setup()
    await t.run(async (ctx) => {
      const account = await insertAccount(ctx)
      const warm = await insertSignal(ctx, account, { title: 'A day old', score: 80, foundAt: NOW - DAY, publishedAt: NOW - DAY })
      const warmIdea = await reactiveIdea(ctx, account, warm, '2026-10-14')
      const cold = await insertSignal(ctx, account, {
        title: 'Ten days old',
        score: 85,
        foundAt: NOW - 10 * DAY,
        publishedAt: NOW - 10 * DAY,
      })
      const coldIdea = await reactiveIdea(ctx, account, cold, '2026-10-15')
      // Freshness 49: below the bar a swap needs.
      await insertSignal(ctx, account, { title: 'Not fresh enough', score: 70, foundAt: NOW - DAY, publishedAt: NOW - DAY })
      const evergreen = await insertPost(ctx, account, { status: 'idea', plannedFor: '2026-10-14' })
      const written = await insertPost(ctx, account, { status: 'draft', plannedFor: '2026-10-14' })
      await ctx.db.patch(written._id, { signalIds: [cold._id] })

      for (const post of [warmIdea, coldIdea, evergreen, written]) {
        expect(await lastCheck(ctx, post._id, NOW)).toEqual({ swapped: false })
        expect(await ctx.db.get(post._id)).toMatchObject({ concept: post.concept, title: post.title })
      }
      expect((await ctx.db.get(coldIdea._id))?.signalIds).toEqual([cold._id])
      const journal = await ctx.db
        .query('journal')
        .withIndex('by_account_time', (q) => q.eq('accountId', account._id))
        .collect()
      expect(journal).toEqual([])
    })
  })
})
