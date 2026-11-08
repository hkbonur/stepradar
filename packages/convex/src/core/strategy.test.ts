import { EXPERIMENT_CATALOG, type ExperimentKind } from '@influstep/shared'
import { describe, expect, it } from 'vitest'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'
import { TIMEZONE, insertPost, insertMeasuredPost, insertAccount, insertPostedReply } from '../../test/fixtures'
import { setup } from '../../test/setup'
import { dayKey } from './dates'
import { applyExperimentDecision, startExperiment, stopExperiment } from './experiments'
import { goalNoteText, reviewStrategy } from './strategy'

const DAY = 24 * 60 * 60 * 1000

async function reload(ctx: MutationCtx, accountId: Id<'accounts'>): Promise<Doc<'accounts'>> {
  const account = await ctx.db.get(accountId)
  if (!account) throw new Error('account vanished')
  return account
}

async function journalOf(ctx: MutationCtx, accountId: Id<'accounts'>): Promise<Doc<'journal'>[]> {
  return ctx.db
    .query('journal')
    .withIndex('by_account_time', (q) => q.eq('accountId', accountId))
    .collect()
}

async function memoriesOf(ctx: MutationCtx, accountId: Id<'accounts'>, kind: Doc<'memories'>['kind']): Promise<Doc<'memories'>[]> {
  const rows = await ctx.db
    .query('memories')
    .withIndex('by_account_kind_status', (q) => q.eq('accountId', accountId).eq('kind', kind))
    .collect()
  return rows.sort((a, b) => a.createdAt - b.createdAt)
}

async function messagesOf(ctx: MutationCtx, accountId: Id<'accounts'>): Promise<string[]> {
  const messages = await ctx.db
    .query('messages')
    .withIndex('by_account', (q) => q.eq('accountId', accountId))
    .collect()
  return messages.map((message) => message.text)
}

/** Two variants of a dimension from the catalog, the first as the control. */
function variantsOf(kind: ExperimentKind, keys: [string, string]) {
  return keys.map((key, index) => {
    const variant = EXPERIMENT_CATALOG[kind].find((candidate) => candidate.key === key)
    if (!variant) throw new Error(`the ${kind} catalog has no "${key}"`)
    return { ...variant, isControl: index === 0 }
  })
}

/** A running experiment the review leaves alone, so a test sees only the step it is about. */
async function holdExperiments(ctx: MutationCtx, account: Doc<'accounts'>): Promise<Id<'experiments'>> {
  return startExperiment(ctx, account, {
    name: 'Reply target: Where a reply stands out vs Most reach',
    hypothesis: 'Standing out brings more reach.',
    kind: 'reply_target',
    metric: 'reach',
    variants: variantsOf('reply_target', ['reach', 'standout']),
    minItems: 15,
    minConfidence: 0.9,
    createdBy: 'operator',
    reason: 'Holding the experiment slot.',
  })
}

/** "Question back" decided over "Tip" 30 days ago on reach per item, 2,000 against 1,000, with `minItems` per variant. */
async function decidedQuestionBack(ctx: MutationCtx, account: Doc<'accounts'>, minItems: number, now: number) {
  const experimentId = await startExperiment(
    ctx,
    account,
    {
      name: 'Reply style: Question back vs Tip',
      hypothesis: 'Question back beats tip.',
      kind: 'reply_style',
      metric: 'reach',
      variants: variantsOf('reply_style', ['tip', 'question']),
      minItems,
      minConfidence: 0.9,
      createdBy: 'analyst',
      reason: 'Reply style was never tested.',
    },
    now - 60 * DAY
  )
  const experiment = await ctx.db.get(experimentId)
  if (!experiment) throw new Error('experiment vanished')
  await applyExperimentDecision(
    ctx,
    experiment,
    { winnerKey: 'question', lift: 1, confidence: 0.99, winnerRate: 2000, runnerUpRate: 1000, runnerUpKey: 'tip' },
    'analyst',
    'Question back leads.',
    now - 30 * DAY
  )
  return experimentId
}

const REPLY_GOAL = 'It aims at reach per reply: a reply carries no link, so reach is the step toward the goal it moves.'

/** `count` replies heard after the default, past their window, each with `impressions`. */
async function measuredSince(ctx: MutationCtx, account: Doc<'accounts'>, count: number, impressions: number, now: number) {
  for (let index = 0; index < count; index += 1)
    await insertPostedReply(ctx, account, { heardAt: now - (20 - index) * DAY, impressions, follows: 0, status: 'measured' })
}

describe('reviewStrategy', () => {
  it('moves pillar weight to the pillar that made more per measured post, and says why', async () => {
    const t = setup()
    await t.run(async (ctx) => {
      const inserted = await insertAccount(ctx)
      await ctx.db.patch(inserted._id, { pillars: ['n8n tutorials', 'Automation fails'] })
      const account = await reload(ctx, inserted._id)
      await holdExperiments(ctx, account)
      const now = Date.now()
      const paid = async (post: Doc<'posts'>, count: number) => {
        for (let index = 0; index < count; index += 1) {
          await ctx.db.insert('conversions', {
            accountId: account._id,
            postId: post._id,
            kind: 'paid',
            distinctId: Math.random().toString(36),
            at: now - DAY,
            mock: true,
          })
        }
      }
      for (const daysAgo of [5, 7]) {
        await paid(
          await insertMeasuredPost(ctx, account, {
            postedAt: now - daysAgo * DAY,
            impressions: 1000,
            clicks: 30,
            pillar: 'Automation fails',
          }),
          2
        )
        await paid(
          await insertMeasuredPost(ctx, account, { postedAt: now - daysAgo * DAY, impressions: 1000, clicks: 10, pillar: 'n8n tutorials' }),
          1
        )
      }
      // Out of the 28 days: it would put "n8n tutorials" ahead if it counted.
      await paid(
        await insertMeasuredPost(ctx, account, { postedAt: now - 40 * DAY, impressions: 1000, clicks: 10, pillar: 'n8n tutorials' }),
        10
      )

      const outcome = await reviewStrategy(ctx, account, now)

      expect(outcome).toEqual({ changes: 1, goalNoteId: expect.any(String) })
      const after = await reload(ctx, account._id)
      expect(after.strategy?.pillarWeights).toEqual([
        { pillar: 'n8n tutorials', weight: expect.closeTo(0.4) },
        { pillar: 'Automation fails', weight: expect.closeTo(0.6) },
      ])
      expect(after.strategy?.reviewedAt).toBe(now)
      const entry = (await journalOf(ctx, account._id)).find((candidate) => candidate.kind === 'pillar_weights')
      expect(entry).toMatchObject({
        actor: 'analyst',
        text: '"Automation fails" gets 60% of the evergreen plan, up from 50%, and "n8n tutorials" 40%, down from 50%.',
        reason: 'Over the last 28 days "Automation fails" made 58 EUR per measured post over 2 posts, and "n8n tutorials" 29 EUR over 2.',
        createdAt: now,
      })
      expect(entry?.evidence.postIds).toHaveLength(4)
      expect(entry?.evidence.numbers).toEqual([
        { label: '"Automation fails" value per post (EUR)', value: 58 },
        { label: '"n8n tutorials" value per post (EUR)', value: 29 },
        { label: '"Automation fails" signups per post', value: 0 },
        { label: '"n8n tutorials" signups per post', value: 0 },
        { label: '"Automation fails" weight (%)', value: 60 },
        { label: '"n8n tutorials" weight (%)', value: 40 },
      ])
      const [learning, ...others] = await memoriesOf(ctx, account._id, 'learning')
      expect(others).toEqual([])
      expect(learning).toMatchObject({
        actor: 'analyst',
        key: 'pillars',
        status: 'active',
        text:
          'Over the last 28 days "Automation fails" made 58 EUR per measured post over 2 posts, and "n8n tutorials" 29 EUR over 2. ' +
          'So "Automation fails" gets 60% of the evergreen plan and "n8n tutorials" 40%.',
        createdAt: now,
      })
      expect(await messagesOf(ctx, account._id)).toEqual([
        'I reviewed my strategy: I gave "Automation fails" more of the plan and "n8n tutorials" less. The Strategy page has the reasons.',
      ])
    })
  })

  it('writes nothing but the review time when nothing changes', async () => {
    const t = setup()
    await t.run(async (ctx) => {
      const account = await insertAccount(ctx)
      await holdExperiments(ctx, account)
      const before = await journalOf(ctx, account._id)
      const now = Date.now()

      const outcome = await reviewStrategy(ctx, account, now)

      expect(outcome).toEqual({ changes: 0, goalNoteId: expect.any(String) })
      expect((await reload(ctx, account._id)).strategy).toEqual({ pillarWeights: [], defaults: [], reviewedAt: now })
      expect(await journalOf(ctx, account._id)).toEqual(before)
      expect(await messagesOf(ctx, account._id)).toEqual([])
      expect(await memoriesOf(ctx, account._id, 'learning')).toEqual([])
    })
  })

  it('starts the experiment on the dimension it knows least about, a reply one aimed at reach', async () => {
    const t = setup()
    await t.run(async (ctx) => {
      const account = await insertAccount(ctx)
      const outcome = await reviewStrategy(ctx, account, Date.now())

      expect(outcome.changes).toBe(1)
      if (!outcome.startedExperimentId) throw new Error('the review started no experiment')
      const experiment = await ctx.db.get(outcome.startedExperimentId)
      expect(experiment).toMatchObject({
        name: 'Reply style: Question back vs Tip',
        hypothesis:
          '"Question back" (answer with a short question back that keeps the conversation going) gets more reach per item than "Tip" (answer with one concrete tip from my own work).',
        kind: 'reply_style',
        metric: 'reach',
        status: 'running',
        minItems: 15,
        minConfidence: 0.9,
        createdBy: 'analyst',
      })
      expect(experiment?.variants.map((variant) => [variant.key, variant.isControl])).toEqual([
        ['tip', true],
        ['question', false],
      ])
      expect(experiment?.retestOf).toBeUndefined()
      const [entry] = await journalOf(ctx, account._id)
      expect(entry).toMatchObject({ kind: 'experiment_started', actor: 'analyst', reason: `Reply style was never tested. ${REPLY_GOAL}` })
      expect(await messagesOf(ctx, account._id)).toEqual([
        'I reviewed my strategy: I started "Reply style: Question back vs Tip". The Strategy page has the reasons.',
      ])
    })
  })

  it('starts a post experiment for an account that answers nobody, on the rung its posts brought enough of', async () => {
    const t = setup()
    await t.run(async (ctx) => {
      const account = await insertAccount(ctx)
      await ctx.db.patch(account._id, { cadence: { ...account.cadence, repliesPerDay: 0 } })
      const quiet = await reviewStrategy(ctx, await reload(ctx, account._id), Date.now())
      if (!quiet.startedExperimentId) throw new Error('the review started no experiment')
      // Nothing clicked or converted yet: the post experiment aims at reach.
      expect(await ctx.db.get(quiet.startedExperimentId)).toMatchObject({
        kind: 'post_kind',
        name: 'Post kind: Question vs How-to',
        metric: 'reach',
      })
      const entry = (await journalOf(ctx, account._id)).find((candidate) => candidate.kind === 'experiment_started')
      expect(entry?.reason).toBe(
        'Post kind was never tested. It aims at reach per post: the posts brought too few clicks, signups or paid customers in the last 28 days to test on.'
      )
    })
  })

  it('starts nothing where no reader reads reach and the posts brought too few clicks to test on', async () => {
    const t = setup()
    await t.run(async (ctx) => {
      const account = await insertAccount(ctx, { platform: 'linkedin', handle: 'ada-lovelace' })
      const outcome = await reviewStrategy(ctx, account, Date.now())
      expect(outcome.startedExperimentId).toBeUndefined()
      expect((await ctx.db.get(outcome.goalNoteId))?.text).toMatch(/Next: nothing new to test this week\.$/)
    })
  })

  it('tests a default again against the variant it beat when later numbers no longer back it', async () => {
    const t = setup()
    await t.run(async (ctx) => {
      const account = await insertAccount(ctx)
      const now = Date.now()
      const experimentId = await decidedQuestionBack(ctx, account, 15, now)
      // Since the decision the default reached 900 per reply over 15 replies, under the 1,000 "Tip" had.
      await measuredSince(ctx, account, 15, 900, now)

      const outcome = await reviewStrategy(ctx, await reload(ctx, account._id), now)

      if (!outcome.startedExperimentId) throw new Error('the review started no experiment')
      const retest = await ctx.db.get(outcome.startedExperimentId)
      expect(retest).toMatchObject({
        kind: 'reply_style',
        name: 'Reply style: Tip vs Question back',
        retestOf: experimentId,
        createdBy: 'analyst',
      })
      expect(retest?.variants.map((variant) => [variant.key, variant.isControl])).toEqual([
        ['question', true],
        ['tip', false],
      ])
      const entry = (await journalOf(ctx, account._id)).find(
        (candidate) => candidate.kind === 'experiment_started' && candidate.evidence.experimentId === retest?._id
      )
      expect(entry?.reason).toBe(
        '"Question back" became the reply style default by beating "Tip" 2,000 to 1,000 on reach per item. ' +
          'Since then it got 900 over 15 replies, no better than "Tip" had, so the two are tested again. ' +
          REPLY_GOAL
      )
      const messages = await messagesOf(ctx, account._id)
      expect(messages[messages.length - 1]).toBe(
        'I reviewed my strategy: I started testing "Question back" against "Tip" again, because later numbers no longer back it. The Strategy page has the reasons.'
      )
    })
  })

  it('doubts a default only once it has the review’s minimum items, not the experiment’s own', async () => {
    const t = setup()
    await t.run(async (ctx) => {
      const account = await insertAccount(ctx)
      const now = Date.now()
      // The operator's quick experiment: 5 replies per variant were enough to decide it.
      const experimentId = await decidedQuestionBack(ctx, account, 5, now)
      // 10 replies since at 900: past the experiment's 5, short of the review's 15.
      await measuredSince(ctx, account, 10, 900, now)
      const first = await reviewStrategy(ctx, await reload(ctx, account._id), now)
      if (!first.startedExperimentId) throw new Error('the review started no experiment')
      const fresh = await ctx.db.get(first.startedExperimentId)
      expect(fresh?.retestOf).toBeUndefined()
      expect(fresh?.kind).toBe('reply_target')
      await stopExperiment(ctx, first.startedExperimentId, { actor: 'operator' })

      // Five more at the same reach: 15 since, and the default is tested again.
      await measuredSince(ctx, account, 5, 900, now)
      const second = await reviewStrategy(ctx, await reload(ctx, account._id), now)
      if (!second.startedExperimentId) throw new Error('the review started no experiment')
      expect(await ctx.db.get(second.startedExperimentId)).toMatchObject({ kind: 'reply_style', retestOf: experimentId })
    })
  })
})

describe('community weights', () => {
  /** A community the account met, with its weight. */
  const met = (ctx: MutationCtx, account: Doc<'accounts'>, name: string, weight: number) =>
    ctx.db.insert('communities', {
      accountId: account._id,
      name,
      rulesText: 'Be kind.',
      selfPromotion: 'allowed',
      reason: 'the rules say so',
      weight,
      rulesReadAt: Date.now(),
    })

  it('sends more posts to the subreddit whose posts bring more signups, and leaves out one that removed a post', async () => {
    const t = setup()
    await t.run(async (ctx) => {
      const account = await insertAccount(ctx, { platform: 'reddit', handle: 'nora' })
      // A post test on signups holds the experiment slot: it needs no reader of numbers.
      await startExperiment(ctx, account, {
        name: 'Hook: Question vs Plain statement',
        hypothesis: 'A question opens more signups.',
        kind: 'hook',
        metric: 'signups',
        variants: variantsOf('hook', ['statement', 'question']),
        minItems: 15,
        minConfidence: 0.9,
        createdBy: 'operator',
        reason: 'Holding the experiment slot.',
      })
      const now = Date.now()
      const n8nId = await met(ctx, account, 'n8n', 1)
      const zapierId = await met(ctx, account, 'zapier', 1)
      const removedId = await met(ctx, account, 'make', 1)
      await ctx.db.patch(removedId, { removedAt: now - DAY })
      // A Reddit post links to the sponsor directly: what it brought is the signups its link's UTM parameters name it in.
      const inCommunity = async (community: string, signups: number) => {
        const post = await insertMeasuredPost(ctx, account, { postedAt: now - 5 * DAY, impressions: 1000, clicks: 0 })
        await ctx.db.patch(post._id, { community })
        for (let index = 0; index < signups; index += 1) {
          await ctx.db.insert('conversions', {
            accountId: account._id,
            postId: post._id,
            kind: 'signup',
            distinctId: `${post._id}-${index}`,
            at: now - 4 * DAY,
            mock: false,
          })
        }
      }
      for (const signups of [4, 2]) await inCommunity('n8n', signups)
      for (const signups of [1, 0]) await inCommunity('zapier', signups)
      await inCommunity('make', 30)

      const outcome = await reviewStrategy(ctx, account, now)
      expect(outcome.changes).toBe(1)
      const weights = await Promise.all([n8nId, zapierId, removedId].map(async (id) => (await ctx.db.get(id))?.weight))
      expect(weights).toEqual([0.6, 0.4, 1])
      const entry = (await journalOf(ctx, account._id)).find((candidate) => candidate.kind === 'community_weights')
      expect(entry?.text).toBe('r/n8n gets 60% of the posts, and r/zapier 40%.')
      expect(entry?.reason).toBe(
        'Over the last 28 days r/n8n brought 3.00 signups per post over 2 and r/zapier 0.50 over 2, reach per post breaking a tie.'
      )
      expect((await messagesOf(ctx, account._id)).at(-1)).toContain('sent more posts to r/n8n and fewer to r/zapier')
    })
  })

  it('weighs no communities on Hacker News, where a post goes by its kind', async () => {
    const t = setup()
    await t.run(async (ctx) => {
      const account = await insertAccount(ctx, { platform: 'hackernews', handle: 'nora' })
      await met(ctx, account, 'Show HN', 1)
      await met(ctx, account, 'Ask HN', 1)
      await reviewStrategy(ctx, account, Date.now())
      expect((await journalOf(ctx, account._id)).some((entry) => entry.kind === 'community_weights')).toBe(false)
    })
  })
})

describe('goal notes', () => {
  it('leaves one every review, naming paid customers against the span before and what runs next, and retires the one before', async () => {
    const t = setup()
    await t.run(async (ctx) => {
      const account = await insertAccount(ctx)
      const experimentId = await holdExperiments(ctx, account)
      const now = Date.now()
      const post = await insertPost(ctx, account, { status: 'measured', plannedFor: dayKey(now - 3 * DAY, TIMEZONE) })
      for (const [index, daysAgo] of [3, 10, 40].entries()) {
        await ctx.db.insert('conversions', {
          accountId: account._id,
          postId: post._id,
          kind: 'paid',
          distinctId: `buyer-${index}`,
          at: now - daysAgo * DAY,
          mock: true,
        })
      }

      const first = await reviewStrategy(ctx, account, now - DAY)
      const second = await reviewStrategy(ctx, await reload(ctx, account._id), now)

      const notes = await memoriesOf(ctx, account._id, 'goal_note')
      expect(notes.map((note) => [note._id, note.status])).toEqual([
        [first.goalNoteId, 'superseded'],
        [second.goalNoteId, 'active'],
      ])
      expect(notes[0]?.supersededBy).toBe(second.goalNoteId)
      expect(notes[1]).toMatchObject({
        actor: 'analyst',
        text: '2 paid customers in the last 28 days, worth 58 EUR, up from 1 (29 EUR) in the 28 days before. Next: testing "Reply target: Where a reply stands out vs Most reach".',
        evidence: { experimentId, postIds: [post._id], signalIds: [] },
        createdAt: now,
      })
    })
  })

  it('says the trend in every direction and what comes next', () => {
    const standing = { windowDays: 28, valuePerPaid: 29, currency: 'EUR', testing: null }
    expect(goalNoteText({ ...standing, paid: 0, previousPaid: 0 })).toBe(
      'No paid customers yet in the last 28 days, nor in the 28 days before. Next: nothing new to test this week.'
    )
    expect(goalNoteText({ ...standing, paid: 0, previousPaid: 2 })).toBe(
      'No paid customers in the last 28 days, down from 2 (58 EUR) in the 28 days before. Next: nothing new to test this week.'
    )
    expect(goalNoteText({ ...standing, paid: 1, previousPaid: 1 })).toBe(
      '1 paid customer in the last 28 days, worth 29 EUR, the same as in the 28 days before. Next: nothing new to test this week.'
    )
    expect(goalNoteText({ ...standing, paid: 3, previousPaid: 0 })).toBe(
      '3 paid customers in the last 28 days, worth 87 EUR, up from none in the 28 days before. Next: nothing new to test this week.'
    )
    expect(goalNoteText({ ...standing, paid: 1, previousPaid: 4, testing: 'Reply style: Question back vs Tip' })).toBe(
      '1 paid customer in the last 28 days, worth 29 EUR, down from 4 (116 EUR) in the 28 days before. Next: testing "Reply style: Question back vs Tip".'
    )
  })
})
