import { EXPERIMENT_CATALOG } from '@influstep/shared'
import { describe, expect, it } from 'vitest'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'
import { insertAccount, insertMeasuredPost, insertPost, insertPostedReply } from '../../test/fixtures'
import { hourAt } from './dates'
import { reschedulePost } from './posts'
import { setup } from '../../test/setup'
import {
  analystDecisionNote,
  applyExperimentDecision,
  startExperiment,
  stopExperiment,
  measurableMetrics,
  assertHoursKept,
  experimentStats,
  variantStatsFor,
  variantStatsSince,
  type StartExperimentInput,
} from './experiments'

const DAY = 24 * 60 * 60 * 1000
const [tip, question, story] = EXPERIMENT_CATALOG.reply_style

/** An experiment on two catalog variants of `kind`, the first the control. */
function catalogExperiment(kind: StartExperimentInput['kind'], keys: [string, string], overrides: Partial<StartExperimentInput> = {}) {
  const variants = keys.map((key, index) => {
    const variant = EXPERIMENT_CATALOG[kind].find((candidate) => candidate.key === key)
    if (!variant) throw new Error(`the ${kind} catalog has no "${key}"`)
    return { ...variant, isControl: index === 0 }
  })
  return {
    name: 'Reply style: Question back vs Tip',
    hypothesis: 'Question back beats tip.',
    kind,
    metric: 'reach',
    variants,
    minItems: 15,
    minConfidence: 0.9,
    createdBy: 'analyst',
    reason: 'Reply style was never tested.',
    ...overrides,
  } satisfies StartExperimentInput
}

const styleExperiment = (overrides: Partial<StartExperimentInput> = {}) => catalogExperiment('reply_style', ['tip', 'question'], overrides)

async function experimentOf(ctx: MutationCtx, experimentId: Id<'experiments'>): Promise<Doc<'experiments'>> {
  const experiment = await ctx.db.get(experimentId)
  if (!experiment) throw new Error('experiment vanished')
  return experiment
}

async function journalOf(ctx: MutationCtx, account: Doc<'accounts'>): Promise<Doc<'journal'>[]> {
  return ctx.db
    .query('journal')
    .withIndex('by_account_time', (q) => q.eq('accountId', account._id))
    .collect()
}

describe('startExperiment', () => {
  it('starts the experiment with who set it up and journals why', async () => {
    const t = setup()
    await t.run(async (ctx) => {
      const account = await insertAccount(ctx)
      const experimentId = await startExperiment(ctx, account, styleExperiment())
      const experiment = await experimentOf(ctx, experimentId)
      expect(experiment).toMatchObject({ status: 'running', createdBy: 'analyst', kind: 'reply_style' })
      expect(experiment.retestOf).toBeUndefined()
      const [entry] = await journalOf(ctx, account)
      expect(entry).toMatchObject({
        kind: 'experiment_started',
        actor: 'analyst',
        text: 'Started "Reply style: Question back vs Tip".',
        reason: 'Reply style was never tested.',
        evidence: { experimentId, postIds: [] },
      })
      expect(entry?.evidence.numbers).toEqual([
        { label: 'Replies needed per variant', value: 15 },
        { label: 'Confidence needed (%)', value: 90 },
      ])
    })
  })

  it('refuses a second running experiment, a single variant and duplicate keys', async () => {
    const t = setup()
    await t.run(async (ctx) => {
      const account = await insertAccount(ctx)
      if (!tip) throw new Error('the reply style catalog lost a variant')
      await expect(startExperiment(ctx, account, styleExperiment({ variants: [{ ...tip, isControl: true }] }))).rejects.toThrow(
        'An experiment needs at least two variants.'
      )
      await expect(
        startExperiment(
          ctx,
          account,
          styleExperiment({
            variants: [
              { ...tip, isControl: true },
              { ...tip, isControl: false },
            ],
          })
        )
      ).rejects.toThrow('Variant keys must be unique.')
      await startExperiment(ctx, account, styleExperiment())
      await expect(startExperiment(ctx, account, styleExperiment({ name: 'Another' }))).rejects.toThrow(
        '"Reply style: Question back vs Tip" is still running; stop it first so replies and posts carry one variant.'
      )
    })
  })

  it('refuses a test that would compare nothing, a metric a reply cannot carry, and a key nothing acts on', async () => {
    const t = setup()
    await t.run(async (ctx) => {
      const account = await insertAccount(ctx)
      const withBudget = async (repliesPerDay: number) => {
        await ctx.db.patch(account._id, { cadence: { ...account.cadence, repliesPerDay } })
        const reloaded = await ctx.db.get(account._id)
        if (!reloaded) throw new Error('account vanished')
        return reloaded
      }
      const silent = await withBudget(0)
      await expect(startExperiment(ctx, silent, styleExperiment())).rejects.toThrow(
        'Ada Automates answers nobody, so a reply style test would compare nothing. Give it a reply budget above 0 first.'
      )

      const ready = await withBudget(5)
      await expect(startExperiment(ctx, ready, styleExperiment({ metric: 'clicks' }))).rejects.toThrow(
        'A reply carries no link. Test the reply style on reach.'
      )
      // The planner plans only the cadence's intents, so a post kind outside it would never be posted.
      const kinds = catalogExperiment('post_kind', ['teach', 'show'], { name: 'Post kind: Show vs How-to' })
      await ctx.db.patch(account._id, { cadence: { ...ready.cadence, intents: ['ask', 'teach'] } })
      const narrow = await ctx.db.get(account._id)
      if (!narrow) throw new Error('account vanished')
      await expect(startExperiment(ctx, narrow, kinds)).rejects.toThrow(
        '"Show" is no post kind Ada Automates plans; its cadence plans How-to, Question.'
      )
      // A Reddit post links to the sponsor directly, so a test on clicks would count none; and until the account is connected, nothing reads its reach.
      const reddit = await insertAccount(ctx, { platform: 'reddit', handle: 'ada' })
      await expect(
        startExperiment(ctx, reddit, catalogExperiment('hook', ['statement', 'question'], { metric: 'clicks' }))
      ).rejects.toThrow(
        "A post on Reddit links to the sponsor directly, so no click is counted. Influstep cannot read a posted item's numbers on Reddit yet. A hook test on reach would never be decided. Test the hook on paid or signups."
      )
      // LinkedIn's numbers are not read, so a test on reach would never end.
      const linkedIn = await insertAccount(ctx, { platform: 'linkedin', handle: 'ada-lovelace' })
      await expect(startExperiment(ctx, linkedIn, catalogExperiment('hook', ['statement', 'question']))).rejects.toThrow(
        "Influstep cannot read a posted item's numbers on LinkedIn yet. A hook test on reach would never be decided."
      )
      // A Hacker News comment shows no points to anyone but its author, so a reply test there would never end.
      const hackerNews = await insertAccount(ctx, { platform: 'hackernews', handle: 'ada' })
      await expect(startExperiment(ctx, hackerNews, styleExperiment())).rejects.toThrow(
        'A reply on Hacker News shows no reach, so a reply style test would never be decided.'
      )
      const target = catalogExperiment('reply_target', ['reach', 'standout'])
      await expect(
        startExperiment(ctx, ready, {
          ...target,
          variants: target.variants.map((variant) => (variant.isControl ? variant : { ...variant, key: 'famous', label: 'Famous' })),
        })
      ).rejects.toThrow('"Famous" is no reply target the listener knows; the keys are reach, standout.')
      const experimentId = await startExperiment(ctx, ready, target)
      expect((await experimentOf(ctx, experimentId)).kind).toBe('reply_target')
    })
  })
})

describe('measurableMetrics', () => {
  it('offers what the form may start: no metric for a reply where replies show no reach, and no reach where nothing reads it', async () => {
    const t = setup()
    await t.run(async (ctx) => {
      const hackerNews = await insertAccount(ctx, { platform: 'hackernews', handle: 'ada' })
      expect(await measurableMetrics(ctx, hackerNews, 'reply_style')).toEqual({
        metrics: [],
        why: 'A reply on Hacker News shows no reach, so a reply style test would never be decided.',
      })
      const linkedIn = await insertAccount(ctx, { platform: 'linkedin', handle: 'ada-lovelace' })
      expect(await measurableMetrics(ctx, linkedIn, 'hook')).toEqual({
        metrics: ['paid', 'signups', 'clicks'],
        why: "Influstep cannot read a posted item's numbers on LinkedIn yet. A hook test on reach would never be decided.",
      })
      const x = await insertAccount(ctx, { platform: 'x', handle: 'ada_x' })
      expect(await measurableMetrics(ctx, x, 'hook')).toEqual({ metrics: ['paid', 'signups', 'clicks', 'reach'], why: null })
    })
  })
})

describe('analystDecisionNote', () => {
  it('names the winner, its lead on the rate and a confidence that never reads 100%', () => {
    expect(analystDecisionNote(styleExperiment(), { winnerKey: 'question', lift: 0.5, confidence: 0.9996 })).toBe(
      '"Question back" leads on reach per item by 50% at 99% confidence.'
    )
  })
})

describe('applyExperimentDecision', () => {
  it('makes the winner the default, writes the learning, supersedes the older one, journals and says it once', async () => {
    const t = setup()
    await t.run(async (ctx) => {
      const account = await insertAccount(ctx)
      // What an earlier reply style decision left: a default and a learning, and a reply target learning that stays.
      const older = await ctx.db.insert('memories', {
        accountId: account._id,
        kind: 'learning',
        text: 'Reply style: "Story" beat "Tip".',
        actor: 'analyst',
        dimension: 'reply_style',
        evidence: { postIds: [], signalIds: [] },
        confidence: 0.92,
        status: 'active',
        createdAt: Date.now() - 90 * DAY,
      })
      const targetLearning = await ctx.db.insert('memories', {
        accountId: account._id,
        kind: 'learning',
        text: 'Reply target: "Where a reply stands out" beat "Most reach".',
        actor: 'analyst',
        dimension: 'reply_target',
        evidence: { postIds: [], signalIds: [] },
        confidence: 0.95,
        status: 'active',
        createdAt: Date.now() - 80 * DAY,
      })
      if (!story || !question) throw new Error('the reply style catalog lost a variant')
      await ctx.db.patch(account._id, {
        strategy: {
          pillarWeights: [{ pillar: 'n8n tutorials', weight: 1 }],
          defaults: [
            { kind: 'reply_style', key: story.key, label: story.label, description: story.description, since: Date.now() - 90 * DAY },
          ],
        },
      })
      const experimentId = await startExperiment(ctx, account, styleExperiment())
      const now = Date.now()
      for (const [index, variantKey] of ['tip', 'question', 'tip', 'question'].entries()) {
        await insertPostedReply(ctx, account, {
          heardAt: now - (10 - index) * DAY,
          impressions: variantKey === 'question' ? 2000 : 1000,
          follows: 0,
          experimentId,
          variantKey,
          status: 'measured',
        })
      }
      const experiment = await experimentOf(ctx, experimentId)
      await applyExperimentDecision(
        ctx,
        experiment,
        { winnerKey: 'question', lift: 1, confidence: 0.9996, winnerRate: 2000, runnerUpRate: 1000, runnerUpKey: 'tip' },
        'analyst',
        '"Question back" leads on reach by 100% at 99% confidence.',
        now
      )

      const decided = await experimentOf(ctx, experimentId)
      expect(decided.status).toBe('decided')
      expect(decided.decision).toEqual({
        winnerKey: 'question',
        lift: 1,
        confidence: 0.9996,
        note: '"Question back" leads on reach by 100% at 99% confidence.',
        decidedAt: now,
        byOperator: false,
        winnerRate: 2000,
        runnerUpRate: 1000,
        runnerUpKey: 'tip',
      })

      const after = await ctx.db.get(account._id)
      expect(after?.strategy?.defaults).toEqual([
        { kind: 'reply_style', key: 'question', label: 'Question back', description: question.description, experimentId, since: now },
      ])
      expect(after?.strategy?.pillarWeights).toEqual([{ pillar: 'n8n tutorials', weight: 1 }])

      const memories = await ctx.db
        .query('memories')
        .withIndex('by_account_status', (q) => q.eq('accountId', account._id))
        .collect()
      const learning = memories.find((memory) => memory.status === 'active' && memory.dimension === 'reply_style')
      expect(learning?.text).toBe(
        'Reply style: "Question back" beat "Tip" on reach per item, 2,000 against 1,000 over 4 replies, 99% confidence.'
      )
      expect(learning?.confidence).toBe(0.9996)
      expect(learning?.evidence.experimentId).toBe(experimentId)
      // A reply is no post, so the learning names none.
      expect(learning?.evidence.postIds).toEqual([])
      expect(memories.find((memory) => memory._id === older)).toMatchObject({ status: 'superseded', supersededBy: learning?._id })
      expect(memories.find((memory) => memory._id === targetLearning)?.status).toBe('active')

      const decidedEntry = (await journalOf(ctx, account)).find((entry) => entry.kind === 'experiment_decided')
      expect(decidedEntry).toMatchObject({ actor: 'analyst', text: '"Question back" is the default for reply style now.' })
      expect(decidedEntry?.evidence.numbers).toEqual([
        { label: '"Tip" reach per item', value: 1000 },
        { label: '"Tip" replies', value: 2 },
        { label: '"Question back" reach per item', value: 2000 },
        { label: '"Question back" replies', value: 2 },
        { label: 'Confidence (%)', value: 99.9 },
      ])

      const messages = await ctx.db
        .query('messages')
        .withIndex('by_account', (q) => q.eq('accountId', account._id))
        .collect()
      expect(messages.map((message) => message.text)).toEqual([
        'Experiment "Reply style: Question back vs Tip" is decided: "Question back" leads on reach by 100% at 99% confidence. From now on I answer with a short question back that keeps the conversation going.',
      ])
    })
  })

  it('records the operator’s own verdict with full confidence and their note', async () => {
    const t = setup()
    await t.run(async (ctx) => {
      const account = await insertAccount(ctx)
      const experimentId = await startExperiment(ctx, account, styleExperiment({ createdBy: 'operator' }))
      await applyExperimentDecision(
        ctx,
        await experimentOf(ctx, experimentId),
        { winnerKey: 'question', lift: 0, confidence: 0 },
        'operator',
        'questions start the conversations our customers join'
      )
      const decided = await experimentOf(ctx, experimentId)
      expect(decided.decision?.byOperator).toBe(true)
      expect(decided.decision?.winnerRate).toBeUndefined()
      const [learning] = await ctx.db
        .query('memories')
        .withIndex('by_account_status', (q) => q.eq('accountId', account._id).eq('status', 'active'))
        .collect()
      expect(learning?.text).toBe(
        'Reply style: "Question back" over "Tip", chosen by the operator: questions start the conversations our customers join.'
      )
      expect(learning?.confidence).toBe(1)
      const entry = (await journalOf(ctx, account)).find((candidate) => candidate.kind === 'experiment_decided')
      expect(entry?.actor).toBe('operator')
      expect(entry?.evidence.numbers.map((number) => number.label)).not.toContain('Confidence (%)')
    })
  })

  it('lands once: a second decision on a decided experiment is refused and writes nothing', async () => {
    const t = setup()
    await t.run(async (ctx) => {
      const account = await insertAccount(ctx)
      const experimentId = await startExperiment(ctx, account, styleExperiment())
      // The daily evaluation decides while the operator's override form is still open.
      await applyExperimentDecision(
        ctx,
        await experimentOf(ctx, experimentId),
        { winnerKey: 'question', lift: 1, confidence: 0.95, winnerRate: 2000, runnerUpRate: 1000, runnerUpKey: 'tip' },
        'analyst',
        'Question back leads.'
      )
      const decided = await experimentOf(ctx, experimentId)
      await expect(
        applyExperimentDecision(ctx, decided, { winnerKey: 'tip', lift: 0, confidence: 0 }, 'operator', 'I like it better')
      ).rejects.toThrow('"Reply style: Question back vs Tip" is already decided.')
      expect((await experimentOf(ctx, experimentId)).decision).toMatchObject({
        winnerKey: 'question',
        winnerRate: 2000,
        runnerUpRate: 1000,
      })
      const learnings = await ctx.db
        .query('memories')
        .withIndex('by_account_status', (q) => q.eq('accountId', account._id))
        .collect()
      expect(learnings).toHaveLength(1)
      expect((await journalOf(ctx, account)).filter((entry) => entry.kind === 'experiment_decided')).toHaveLength(1)
    })
  })

  it('takes the rates of a decision all together or not at all', async () => {
    const t = setup()
    await t.run(async (ctx) => {
      const account = await insertAccount(ctx)
      const experimentId = await startExperiment(ctx, account, styleExperiment())
      const experiment = await experimentOf(ctx, experimentId)
      await expect(
        applyExperimentDecision(
          ctx,
          experiment,
          { winnerKey: 'question', lift: 1, confidence: 0.95, winnerRate: 2000, runnerUpRate: 1000 },
          'analyst',
          ''
        )
      ).rejects.toThrow("needs the winner's rate, the runner-up's rate and its key together")
      await expect(
        applyExperimentDecision(
          ctx,
          experiment,
          { winnerKey: 'question', lift: 1, confidence: 0.95, winnerRate: 2000, runnerUpRate: 1000, runnerUpKey: 'question' },
          'analyst',
          ''
        )
      ).rejects.toThrow('names its winner "question" as the runner-up')
      expect((await experimentOf(ctx, experimentId)).status).toBe('running')
    })
  })

  it('refuses a stopped experiment and a winner it does not have', async () => {
    const t = setup()
    await t.run(async (ctx) => {
      const account = await insertAccount(ctx)
      const experimentId = await startExperiment(ctx, account, styleExperiment())
      await expect(
        applyExperimentDecision(ctx, await experimentOf(ctx, experimentId), { winnerKey: 'story', lift: 0, confidence: 0 }, 'operator', '')
      ).rejects.toThrow('There is no variant "story".')
      await stopExperiment(ctx, experimentId, { actor: 'operator' })
      await expect(
        applyExperimentDecision(
          ctx,
          await experimentOf(ctx, experimentId),
          { winnerKey: 'question', lift: 0, confidence: 0 },
          'operator',
          ''
        )
      ).rejects.toThrow('"Reply style: Question back vs Tip" was stopped, so it cannot be decided.')
    })
  })
})

describe('stopExperiment', () => {
  it('stops a running experiment, journals it, and refuses one that is not running', async () => {
    const t = setup()
    await t.run(async (ctx) => {
      const account = await insertAccount(ctx)
      const experimentId = await startExperiment(ctx, account, styleExperiment({ createdBy: 'operator' }))
      await stopExperiment(ctx, experimentId, { actor: 'operator' })
      expect((await experimentOf(ctx, experimentId)).status).toBe('stopped')
      const entry = (await journalOf(ctx, account)).find((candidate) => candidate.kind === 'experiment_stopped')
      expect(entry).toMatchObject({ actor: 'operator', text: 'Stopped "Reply style: Question back vs Tip" before it was decided.' })
      await expect(stopExperiment(ctx, experimentId, { actor: 'operator' })).rejects.toThrow(
        '"Reply style: Question back vs Tip" is not running.'
      )
    })
  })
})

describe('a reply experiment', () => {
  it('counts reach per reply over its replies past their window, each by the variant it carries', async () => {
    const t = setup()
    await t.run(async (ctx) => {
      const account = await insertAccount(ctx)
      const experimentId = await startExperiment(ctx, account, styleExperiment())
      const now = Date.now()
      const measured = { experimentId, status: 'measured' as const, follows: 0 }
      await insertPostedReply(ctx, account, { ...measured, heardAt: now - DAY, impressions: 1000, variantKey: 'tip' })
      await insertPostedReply(ctx, account, { ...measured, heardAt: now - DAY, impressions: 500, variantKey: 'question' })
      await insertPostedReply(ctx, account, { ...measured, heardAt: now - DAY, impressions: 700, variantKey: 'question' })
      // Still in its window: its clicks and reach are not all in yet.
      await insertPostedReply(ctx, account, { heardAt: now - DAY, impressions: 9000, follows: 0, experimentId, variantKey: 'tip' })
      // In no experiment: not counted.
      await insertPostedReply(ctx, account, { heardAt: now - DAY, impressions: 9000, follows: 90, status: 'measured' })
      expect(await variantStatsFor(ctx, await experimentOf(ctx, experimentId))).toEqual([
        { key: 'tip', items: 1, sum: 1000, sumSquares: 1_000_000 },
        { key: 'question', items: 2, sum: 1200, sumSquares: 740_000 },
      ])
    })
  })

  it('measures a reply default since its decision by each reply’s own variant or the default, and a target on found posts only', async () => {
    const t = setup()
    await t.run(async (ctx) => {
      const account = await insertAccount(ctx)
      const since = Date.now() - 20 * DAY
      const at = (days: number) => Date.now() - days * DAY
      const styleId = await startExperiment(ctx, account, styleExperiment())
      await stopExperiment(ctx, styleId, { actor: 'operator' })
      const [, standout] = EXPERIMENT_CATALOG.reply_target
      if (!standout || !question) throw new Error('the reply catalogs lost a variant')
      await ctx.db.patch(account._id, {
        strategy: {
          pillarWeights: [],
          defaults: [
            { kind: 'reply_style', key: question.key, label: question.label, description: question.description, since },
            { kind: 'reply_target', key: standout.key, label: standout.label, description: standout.description, since },
          ],
        },
      })
      const reader = await ctx.db.get(account._id)
      if (!reader) throw new Error('account vanished')
      const measured = { impressions: 1000, follows: 0, status: 'measured' as const }
      await insertPostedReply(ctx, reader, { ...measured, heardAt: at(10) })
      await insertPostedReply(ctx, reader, { ...measured, heardAt: at(9), origin: 'mention' })
      await insertPostedReply(ctx, reader, { ...measured, heardAt: at(8), experimentId: styleId, variantKey: 'question' })
      // Not counted: heard before the default, or its own variant is the tip.
      await insertPostedReply(ctx, reader, { ...measured, heardAt: at(30) })
      await insertPostedReply(ctx, reader, { ...measured, heardAt: at(7), experimentId: styleId, variantKey: 'tip' })
      expect(await variantStatsSince(ctx, reader, 'reply_style', 'question', since, 'reach')).toEqual({
        key: 'question',
        items: 3,
        sum: 3000,
        sumSquares: 3_000_000,
      })
      // A mention has no target to pick, so the target default counts the found posts only.
      expect(await variantStatsSince(ctx, reader, 'reply_target', 'standout', since, 'reach')).toMatchObject({ items: 3, sum: 3000 })
    })
  })
})

describe('a post experiment', () => {
  it('counts clicks per post over its measured posts, each by the variant the planner gave it', async () => {
    const t = setup()
    await t.run(async (ctx) => {
      const account = await insertAccount(ctx)
      const experimentId = await startExperiment(
        ctx,
        account,
        catalogExperiment('call_to_action', ['none', 'question'], {
          name: 'Call to action: Ends with a question vs No question',
          metric: 'clicks',
        })
      )
      const posted = async (variantKey: string, clicks: number) => {
        const post = await insertMeasuredPost(ctx, account, { postedAt: Date.now() - 10 * DAY, impressions: 1000, clicks })
        await ctx.db.patch(post._id, { experimentId, variantKey })
      }
      await posted('none', 2)
      await posted('question', 5)
      await posted('question', 7)
      expect(await variantStatsFor(ctx, await experimentOf(ctx, experimentId))).toEqual([
        { key: 'none', items: 1, sum: 2, sumSquares: 4 },
        { key: 'question', items: 2, sum: 12, sumSquares: 74 },
      ])
    })
  })

  it('counts a posting time test over the posts found near their planned hour, says how many were not, and moves the hour and the ideas once decided', async () => {
    const t = setup()
    await t.run(async (ctx) => {
      const account = await insertAccount(ctx)
      const timing = catalogExperiment('posting_time', ['usual', 'later'], { metric: 'clicks' })
      await expect(
        startExperiment(ctx, account, {
          ...timing,
          variants: timing.variants.map((variant) => (variant.isControl ? variant : { ...variant, key: 'noon', label: 'Noon' })),
        })
      ).rejects.toThrow('"Noon" is no posting time the planner knows; the keys are usual, earlier, later.')
      const experimentId = await startExperiment(ctx, account, timing)
      const posted = async (variantKey: string, minutesOff: number, clicks: number, kind: 'found' | 'linked' = 'found') => {
        const postedAt = Date.now() - 10 * DAY
        const post = await insertMeasuredPost(ctx, account, { postedAt, impressions: 1000, clicks })
        if (post.posted?.kind !== 'linked') throw new Error('the measured post went out without its link')
        const at = { scheduledAt: postedAt - minutesOff * 60_000 }
        const how = kind === 'found' ? { posted: { ...post.posted, kind } } : {}
        await ctx.db.patch(post._id, { experimentId, variantKey, ...at, ...how })
      }
      await posted('usual', 0, 2)
      await posted('later', 30, 5)
      // Posted three hours after its slot: at neither variant's hour, so it tested nothing.
      await posted('later', 180, 40)
      // Marked posted with its link, it went out whenever the operator said so: no hour to count it by.
      await posted('usual', 0, 9, 'linked')
      const experiment = await experimentOf(ctx, experimentId)
      expect(await experimentStats(ctx, experiment)).toEqual({
        stats: [
          { key: 'usual', items: 1, sum: 2, sumSquares: 4 },
          { key: 'later', items: 1, sum: 5, sumSquares: 25 },
        ],
        leftOut: { offHour: 1, unknownHour: 1 },
      })

      // While it runs the hours stay as they are.
      await expect(assertHoursKept(ctx, account, { ...account, publishHour: account.publishHour + 1 })).rejects.toThrow(
        "tests Ada Automates's posting time from its hours; stop it before you change them."
      )
      // An idea planned two hours later goes back to its slot, and moves by the winner like every slot.
      const idea = await insertPost(ctx, account, { status: 'idea', plannedFor: '2026-12-01' })
      const slot = hourAt(idea.scheduledAt, account.timezone)
      await ctx.db.patch(idea._id, {
        experimentId,
        variantKey: 'usual',
      })
      // A decided posting time moves the account's own hour, and keeps no default: the next test moves from there.
      await applyExperimentDecision(ctx, experiment, { winnerKey: 'later', lift: 1.5, confidence: 0.95 }, 'operator', '')
      const after = await ctx.db.get(account._id)
      expect(after?.publishHour).toBe(account.publishHour + 2)
      expect(after?.strategy?.defaults.some((entry) => entry.kind === 'posting_time') ?? false).toBe(false)
      const released = await ctx.db.get(idea._id)
      expect(released?.experimentId).toBeUndefined()
      expect(released === null ? null : hourAt(released.scheduledAt, account.timezone)).toBe(slot + 2)
      const said = await ctx.db.query('messages').collect()
      expect(said.at(-1)?.text).toContain(`From now on I start my posts at ${String(account.publishHour + 2).padStart(2, '0')}:00.`)
    })
  })

  it('takes a post moved to another day out of its posting time test, back at its slot hour', async () => {
    const t = setup()
    await t.run(async (ctx) => {
      const account = await insertAccount(ctx)
      const experimentId = await startExperiment(ctx, account, catalogExperiment('posting_time', ['usual', 'later']))
      const idea = await insertPost(ctx, account, { status: 'idea', plannedFor: '2026-12-01' })
      const slot = hourAt(idea.scheduledAt, account.timezone)
      await ctx.db.patch(idea._id, { experimentId, variantKey: 'later', scheduledAt: idea.scheduledAt + 2 * 3_600_000 })
      await reschedulePost(ctx, idea._id, '2026-12-03')
      const moved = await ctx.db.get(idea._id)
      expect(moved?.plannedFor).toBe('2026-12-03')
      expect([moved?.experimentId, moved?.variantKey]).toEqual([undefined, undefined])
      expect(moved === null ? null : hourAt(moved.scheduledAt, account.timezone)).toBe(slot)
    })
  })

  it('refuses a posting time test where the account reads no posts of its own, or where two hours would leave the day', async () => {
    const t = setup()
    await t.run(async (ctx) => {
      const linkedIn = await insertAccount(ctx, { platform: 'linkedin', handle: 'ada-lovelace' })
      expect(await measurableMetrics(ctx, linkedIn, 'posting_time')).toEqual({
        metrics: [],
        why: "Influstep cannot read the account's own posts on LinkedIn yet. A posting time test could not tell when a post went out.",
      })
      const late = await insertAccount(ctx, { handle: 'ada_late' })
      await ctx.db.patch(late._id, { publishHour: 19, cadence: { ...late.cadence, postsPerDay: 2 } })
      const reloaded = await ctx.db.get(late._id)
      if (!reloaded) throw new Error('account vanished')
      expect(await measurableMetrics(ctx, reloaded, 'posting_time')).toEqual({
        metrics: [],
        why: "Ada Automates's posts run from 19:00 to 22:00, so two hours either way would leave the day. Move its posting hour first.",
      })
    })
  })
})
