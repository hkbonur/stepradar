import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { mockLlm } from './providers/llm/mock'
import type { ReplyBrief } from './providers/llm'
import { insertAccount, insertPostedReply, HEARD_FIT } from '../test/fixtures'
import { setup } from '../test/setup'

const DAY = 24 * 60 * 60 * 1000

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the strategy loop', () => {
  it('starts an experiment from the review, decides it on the numbers, and writes the next reply to the winner', async () => {
    const t = setup()
    const accountId: Id<'accounts'> = await t.run(async (ctx) => (await insertAccount(ctx))._id)

    // The review as the operator asks for it, through the job queue and dispatch.
    const jobId = await t.mutation(api.private.strategy.reviewNow, { accountId })
    await expect(t.mutation(api.private.strategy.reviewNow, { accountId })).rejects.toThrow(
      'Ada Automates is already reviewing the strategy.'
    )
    await t.finishAllScheduledFunctions(() => {})
    const job = await t.run((ctx) => ctx.db.get(jobId))
    expect(job?.status).toBe('done')
    const experiment = await t.run(async (ctx) =>
      ctx.db
        .query('experiments')
        .withIndex('by_account_status', (q) => q.eq('accountId', accountId).eq('status', 'running'))
        .unique()
    )
    if (!experiment) throw new Error('the review started no experiment')
    expect(experiment).toMatchObject({ name: 'Reply style: Question back vs Tip', metric: 'reach', createdBy: 'analyst', minItems: 15 })
    expect(job?.result).toEqual({ changes: 1, goalNoteId: expect.any(String), startedExperimentId: experiment._id })

    // Fifteen measured replies of each variant: the questions back reach nearly three times as far.
    await t.run(async (ctx) => {
      const account = await ctx.db.get(accountId)
      if (!account) throw new Error('account vanished')
      const now = Date.now()
      for (let index = 0; index < 30; index += 1) {
        const variantKey = index % 2 === 0 ? 'tip' : 'question'
        await insertPostedReply(ctx, account, {
          heardAt: now - (20 - index / 2) * DAY,
          impressions: (variantKey === 'question' ? 2800 : 900) + (Math.floor(index / 2) % 3) * 100,
          follows: 0,
          experimentId: experiment._id,
          variantKey,
          status: 'measured',
        })
      }
    })
    expect(await t.mutation(internal.internal.analyst.evaluateExperiments, { accountId })).toEqual({ decided: 1 })
    const account = await t.run((ctx) => ctx.db.get(accountId))
    expect(account?.strategy?.defaults).toEqual([
      expect.objectContaining({ kind: 'reply_style', key: 'question', experimentId: experiment._id }),
    ])
    const learning = 'Reply style: "Question back" beat "Tip" on reach per item, 2,900 against 1,000 over 30 replies, 99% confidence.'

    // The next reply is written to the winner: the brief carries the learning and the style, and the reply asks.
    const briefs: ReplyBrief[] = []
    const write = mockLlm.writeReply.bind(mockLlm)
    vi.spyOn(mockLlm, 'writeReply').mockImplementation(async (brief) => {
      briefs.push(brief)
      return write(brief)
    })
    await t.run((ctx) =>
      ctx.db.insert('replies', {
        accountId,
        origin: 'search',
        inReplyTo: '1850000000000000001',
        thread: {
          url: 'https://x.com/dana/status/1850000000000000001',
          title: null,
          text: 'What do you check first when a webhook stops firing?',
          postedAt: Date.now() - 60_000,
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
    )
    await t.mutation(api.private.replies.listenNow, { accountId })
    await t.finishAllScheduledFunctions(() => {})
    const [brief] = briefs
    expect(brief?.memory.learnings).toEqual([learning])
    expect(brief?.style.key).toBe('question')
    const drafts = await t.run((ctx) =>
      ctx.db
        .query('replies')
        .withIndex('by_account_status', (q) => q.eq('accountId', accountId).eq('status', 'draft'))
        .collect()
    )
    expect(drafts.some((reply) => reply.text.endsWith('?'))).toBe(true)
  })

  it('stops a test that ends at its floor without a clear winner, and frees the slot', async () => {
    const t = setup()
    const accountId: Id<'accounts'> = await t.run(async (ctx) => (await insertAccount(ctx))._id)
    const experimentId = await t.run(async (ctx) => {
      const account = await ctx.db.get(accountId)
      if (!account) throw new Error('account vanished')
      const id = await ctx.db.insert('experiments', {
        accountId,
        name: 'Reply style: Question back vs Tip',
        hypothesis: 'A question back reaches further.',
        kind: 'reply_style',
        metric: 'reach',
        variants: [
          { key: 'tip', label: 'Tip', description: 'Answer with one tip.', isControl: true },
          { key: 'question', label: 'Question back', description: 'Answer with a question back.', isControl: false },
        ],
        minItems: 15,
        minConfidence: 0.9,
        status: 'running',
        createdBy: 'analyst',
        createdAt: Date.now() - 30 * DAY,
      })
      // Both variants reach about as far: no lead the test could trust.
      for (let index = 0; index < 30; index += 1) {
        await insertPostedReply(ctx, account, {
          heardAt: Date.now() - (20 - index / 2) * DAY,
          impressions: 1000 + (Math.floor(index / 2) % 3) * 100,
          follows: 0,
          experimentId: id,
          variantKey: index % 2 === 0 ? 'tip' : 'question',
          status: 'measured',
        })
      }
      return id
    })
    expect(await t.mutation(internal.internal.analyst.evaluateExperiments, { accountId })).toEqual({ decided: 0 })
    expect((await t.run((ctx) => ctx.db.get(experimentId)))?.status).toBe('stopped')
    const stopped = await t.run((ctx) => ctx.db.query('journal').collect())
    expect(stopped.find((entry) => entry.kind === 'experiment_stopped')).toMatchObject({
      actor: 'analyst',
      reason:
        'Every variant reached 15 replies and none led on reach per item with 90% confidence. So nothing changes: the account keeps doing what it did, and what went out keeps its variant.',
    })
  })

  it('reviews every active account from the weekly cron', async () => {
    const t = setup()
    const [active, paused] = await t.run(async (ctx) => {
      const first = await insertAccount(ctx)
      const second = await insertAccount(ctx, { name: 'Max Ships', handle: 'max.ships' })
      await ctx.db.patch(second._id, { paused: true })
      return [first._id, second._id]
    })
    await t.mutation(internal.internal.schedule.reviewStrategies, {})
    await t.finishAllScheduledFunctions(() => {})
    // A query result cannot carry undefined, so the test asks whether each account was reviewed.
    const reviewed = await t.run(async (ctx) =>
      Promise.all([active, paused].map(async (id) => (await ctx.db.get(id))?.strategy?.reviewedAt !== undefined))
    )
    expect(reviewed).toEqual([true, false])
  })
})

describe('the seeded strategy', () => {
  it('gives Ada a reviewed strategy with a running reply experiment, and Max none', async () => {
    const t = setup()
    await t.mutation(internal.internal.seed.run, {})
    const seeded = await t.run(async (ctx) => {
      const accounts = await ctx.db.query('accounts').collect()
      const ada = accounts.find((account) => account.handle === 'ada_automates' && account.platform === 'x')
      const max = accounts.find((account) => account.handle === 'max_builds')
      if (!ada || !max) throw new Error('the seed has no Ada and Max')
      const journal = await ctx.db
        .query('journal')
        .withIndex('by_account_time', (q) => q.eq('accountId', ada._id))
        .collect()
      const active = async (accountId: Id<'accounts'>) =>
        ctx.db
          .query('memories')
          .withIndex('by_account_status', (q) => q.eq('accountId', accountId).eq('status', 'active'))
          .collect()
      const adaMemories = await active(ada._id)
      return {
        ada,
        max,
        journalKinds: journal.map((entry) => entry.kind),
        learnings: adaMemories
          .filter((memory) => memory.kind === 'learning')
          .map((memory) => memory.text)
          .sort(),
        // Beside the learnings: the review's goal note, the operator's fact and rule, and the morning's
        // research (a brief and the one repeated question).
        others: adaMemories
          .filter((memory) => memory.kind !== 'learning')
          .map((memory) => memory.kind)
          .sort(),
        maxMemories: (await active(max._id)).length,
      }
    })
    expect(seeded.ada.strategy?.defaults).toEqual([])
    expect(seeded.ada.strategy?.reviewedAt).toEqual(expect.any(Number))
    expect(seeded.journalKinds).toEqual(expect.arrayContaining(['experiment_started']))
    expect(seeded.learnings.every((text) => /^Over the last 28 days .* So ".*" gets \d+% of the evergreen plan/.test(text))).toBe(true)
    expect(seeded.others).toEqual(['brief', 'fact', 'goal_note', 'problem', 'rule', 'rule'])
    expect(seeded.max.strategy).toBeUndefined()
    expect(seeded.maxMemories).toBe(0)
  })
})
