import { afterEach, describe, expect, it, vi } from 'vitest'
import { EXPERIMENT_CATALOG } from '@influstep/shared'
import { api, internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import type { MutationCtx } from './_generated/server'
import { addDays, dayKey, weekStart } from './core/dates'
import { variantStatsSince } from './core/experiments'
import { whatWorked } from './core/niche'
import { mockLlm } from './providers/llm/mock'
import { TIMEZONE, insertAccount, insertMeasuredPost, insertPost } from '../test/fixtures'
import { setup } from '../test/setup'

afterEach(() => {
  vi.restoreAllMocks()
})

/** A thread the researcher found for the account, as `signalOf` keeps it. */
async function found(
  ctx: MutationCtx,
  account: Doc<'accounts'>,
  thread: { title: string; source?: Doc<'signals'>['source']; score: number; topics?: string[] }
): Promise<Id<'signals'>> {
  return ctx.db.insert('signals', {
    accountId: account._id,
    source: thread.source ?? 'reddit',
    externalId: thread.title,
    title: thread.title,
    url: `https://www.reddit.com/r/n8n/comments/${thread.title.length}/`,
    summary: `n8n, ${thread.score} points. What people said.`,
    score: thread.score,
    topics: thread.topics ?? ['n8n tutorials'],
    status: 'new',
    foundAt: Date.now(),
    publishedAt: Date.now(),
    mock: true,
  })
}

/** A signal as a post keeps the thread it is drawn from. */
async function threadOf(ctx: MutationCtx, signalId: Id<'signals'>) {
  const signal = await ctx.db.get(signalId)
  if (!signal) throw new Error('no signal')
  return { signalId, title: signal.title, summary: signal.summary, url: signal.url }
}

describe('what worked', () => {
  it("finds the standouts among the account's unused threads, and the round-up its questions on one pillar make", async () => {
    const t = setup()
    const { standoutId, questionIds } = await t.run(async (ctx) => {
      const account = await insertAccount(ctx)
      const standoutId = await found(ctx, account, { title: 'I replaced three tools with one n8n flow', score: 400 })
      // A thread about the sponsor stood out too, but it is one to answer: a post drawn from it would plant the question.
      await found(ctx, account, { title: 'Has anyone here tried Formstep?', score: 390 })
      await found(ctx, account, { title: 'My weekly n8n setup', score: 40 })
      await found(ctx, account, { title: 'n8n release notes', score: 30 })
      const questionIds = []
      for (const [index, title] of [
        'How do you retry a webhook?',
        'Why does my webhook run twice?',
        'Where do webhook errors go?',
        'Which webhook node do you use?',
      ].entries()) {
        questionIds.push(await found(ctx, account, { title, score: 20 + index, topics: ['webhooks'] }))
      }
      // A suggestion is no thread, and a used signal was drawn on already.
      await found(ctx, account, { title: 'n8n webhook tutorial', source: 'search', score: 900 })
      const used = await found(ctx, account, { title: 'A thread a post already reacted to', score: 900 })
      await ctx.db.patch(used, { status: 'used' })
      await ctx.db.patch(account._id, { pillars: ['n8n tutorials', 'webhooks'] })
      return { standoutId, questionIds }
    })
    const worked = await t.run(async (ctx) => {
      const [account] = await ctx.db.query('accounts').collect()
      if (!account) throw new Error('no account')
      return whatWorked(ctx, account)
    })
    expect(worked.standouts.map((standout) => standout.thread.signalId)).toEqual([standoutId])
    expect(worked.roundup?.pillar).toBe('webhooks')
    expect(worked.roundup?.questions.map((question) => question.signalId)).toEqual([...questionIds].reverse())
  })

  it('writes a post modeled on a standout in its own words, and refuses a draft that copies it', async () => {
    const t = setup()
    const postId = await t.run(async (ctx) => {
      const account = await insertAccount(ctx)
      const signalId = await found(ctx, account, { title: 'I replaced three tools with one n8n flow', score: 400 })
      const post = await insertPost(ctx, account, {
        status: 'idea',
        plannedFor: addDays(dayKey(Date.now(), TIMEZONE), 1),
        pillar: 'n8n tutorials',
      })
      await ctx.db.patch(post._id, { basis: { kind: 'model', thread: await threadOf(ctx, signalId) }, length: 'medium' })
      return post._id
    })
    const write = vi.spyOn(mockLlm, 'writePost')
    await t.action(internal.internal.writer.writePost, { postId })
    expect(write.mock.calls[0]?.[0].basis).toEqual({
      kind: 'model',
      thread: {
        signalId: expect.any(String),
        title: 'I replaced three tools with one n8n flow',
        summary: 'n8n, 400 points. What people said.',
        url: expect.any(String),
      },
    })
    expect(await t.run((ctx) => ctx.db.get(postId))).toMatchObject({ status: 'draft' })

    // A model that hands back the thread's own words gets one try more, then the post fails with the reason.
    write.mockResolvedValue({ title: 'Tools', parts: ['I replaced three tools with one n8n flow, and here is how.'] })
    await t.run((ctx) => ctx.db.patch(postId, { status: 'idea' }))
    await expect(t.action(internal.internal.writer.writePost, { postId })).rejects.toThrow('The draft repeats the thread it is modeled on.')
  })

  it('writes a round-up from the questions it gathers', async () => {
    const t = setup()
    const postId = await t.run(async (ctx) => {
      const account = await insertAccount(ctx)
      const signalIds = []
      for (const title of [
        'How do you retry a webhook?',
        'Why does my webhook run twice?',
        'Where do webhook errors go?',
        'Which webhook node do you use?',
      ]) {
        signalIds.push(await found(ctx, account, { title, score: 20, topics: ['webhooks'] }))
      }
      const post = await insertPost(ctx, account, {
        status: 'idea',
        plannedFor: addDays(dayKey(Date.now(), TIMEZONE), 1),
        pillar: 'webhooks',
      })
      const questions = await Promise.all(signalIds.map((signalId) => threadOf(ctx, signalId)))
      await ctx.db.patch(post._id, { basis: { kind: 'roundup', pillar: 'webhooks', questions }, kind: 'thread', length: 'long' })
      return post._id
    })
    const write = vi.spyOn(mockLlm, 'writePost')
    await t.action(internal.internal.writer.writePost, { postId })
    const basis = write.mock.calls[0]?.[0].basis
    expect(basis?.kind === 'roundup' ? basis.questions.map((question) => question.title) : null).toEqual([
      'How do you retry a webhook?',
      'Why does my webhook run twice?',
      'Where do webhook errors go?',
      'Which webhook node do you use?',
    ])
    expect(await t.run((ctx) => ctx.db.get(postId))).toMatchObject({
      status: 'draft',
      title: expect.stringContaining('4 questions people asked about webhooks'),
    })
  })

  it('tests posts modeled on what worked only once something stood out, and models the modeled posts on the standouts', async () => {
    const t = setup()
    const account = await t.run((ctx) => insertAccount(ctx))
    const start = () =>
      t.mutation(api.private.experiments.create, {
        accountId: account._id,
        name: 'Post model: Modeled on what worked vs As planned',
        hypothesis: 'Posts on what people answered most bring more.',
        kind: 'post_model',
        metric: 'reach',
        variants: [...EXPERIMENT_CATALOG.post_model],
        minItems: 15,
        minConfidence: 0.9,
      })
    await expect(start()).rejects.toThrow("No thread found in Ada Automates's niche lately drew at least 2 times what the others did")

    const standoutId = await t.run(async (ctx) => {
      const standoutId = await found(ctx, account, { title: 'I replaced three tools with one n8n flow', score: 400 })
      await found(ctx, account, { title: 'My weekly n8n setup', score: 40 })
      await found(ctx, account, { title: 'n8n release notes', score: 30 })
      return standoutId
    })
    // Today proposes the test while the account is free to run it, and no more once it runs.
    const proposed = async () =>
      (await t.query(api.private.today.view, { now: Date.now() })).nextSteps
        .filter((step) => step.kind === 'standout')
        .map((step) => step.text)
    expect(await proposed()).toEqual([
      `People answered "I replaced three tools with one n8n flow" far more than the other threads found in @ada_automates's niche: test posts modeled on what worked.`,
    ])
    await start()
    expect(await proposed()).toEqual([])
    const nextWeek = addDays(weekStart(dayKey(Date.now(), TIMEZONE)), 7)
    await t.mutation(internal.internal.writer.planWeek, { accountId: account._id, weekStart: nextWeek })
    const posts = await t.run((ctx) => ctx.db.query('posts').collect())
    const modeled = posts.filter((post) => post.variantKey === 'modeled')
    expect(modeled.map((post) => (post.basis?.kind === 'model' ? post.basis.thread.signalId : null))).toEqual([standoutId])
    expect(posts.filter((post) => post.variantKey === 'planned').length).toBeGreaterThan(0)
    expect(await t.run((ctx) => ctx.db.get(standoutId))).toMatchObject({ status: 'used' })
  })

  it('plans one round-up a week from the questions people asked, and draws on each question once', async () => {
    const t = setup()
    const account = await t.run((ctx) => insertAccount(ctx, { platform: 'linkedin', handle: 'ada' }))
    const questionIds = await t.run(async (ctx) => {
      const ids = []
      for (const title of [
        'How do you retry a webhook?',
        'Why does my webhook run twice?',
        'Where do webhook errors go?',
        'Which webhook node do you use?',
      ]) {
        ids.push(await found(ctx, account, { title, source: 'forum', score: 20 }))
      }
      return ids
    })
    const nextWeek = addDays(weekStart(dayKey(Date.now(), TIMEZONE)), 7)
    await t.mutation(internal.internal.writer.planWeek, { accountId: account._id, weekStart: nextWeek })
    const roundups = async () => (await t.run((ctx) => ctx.db.query('posts').collect())).filter((post) => post.basis?.kind === 'roundup')
    expect(
      (await roundups()).map((post) =>
        post.basis?.kind === 'roundup' ? [post.basis.pillar, post.basis.questions.map((question) => question.signalId)] : null
      )
    ).toEqual([['n8n tutorials', questionIds]])
    const signals = await t.run((ctx) => Promise.all(questionIds.map((id) => ctx.db.get(id))))
    expect(signals.every((signal) => signal?.status === 'used')).toBe(true)

    // Four more questions the same week wait for the next: a week has one round-up.
    await t.run(async (ctx) => {
      for (const title of [
        'Do you log webhook bodies?',
        'Is a webhook queue worth it?',
        'How long do you keep webhook logs?',
        'Who alerts you on a webhook error?',
      ]) {
        await found(ctx, account, { title, source: 'forum', score: 20 })
      }
      for (const post of await ctx.db.query('posts').collect()) if (post.basis === undefined) await ctx.db.delete(post._id)
    })
    await t.mutation(internal.internal.writer.planWeek, { accountId: account._id, weekStart: nextWeek })
    expect(await roundups()).toHaveLength(1)
  })

  it('rounds up only questions that name a pillar, and takes a short title as the topic, not a copy', async () => {
    const t = setup()
    const account = await t.run((ctx) => insertAccount(ctx))
    await t.run(async (ctx) => {
      // Found by the account's niche alone, these are about no pillar of its own.
      for (const title of [
        'Is automation worth it?',
        'Why automate at all?',
        'Who automates their inbox?',
        'What did you automate first?',
      ]) {
        await found(ctx, account, { title, score: 20, topics: ['automation'] })
      }
    })
    expect((await t.run((ctx) => whatWorked(ctx, account))).roundup).toBeNull()

    const postId = await t.run(async (ctx) => {
      const signalId = await found(ctx, account, { title: 'Self-hosting n8n', score: 400 })
      const post = await insertPost(ctx, account, {
        status: 'idea',
        plannedFor: addDays(dayKey(Date.now(), TIMEZONE), 1),
        pillar: 'n8n tutorials',
      })
      await ctx.db.patch(post._id, { basis: { kind: 'model', thread: await threadOf(ctx, signalId) }, length: 'medium' })
      return post._id
    })
    vi.spyOn(mockLlm, 'writePost').mockResolvedValue({
      title: 'Self-hosting',
      parts: ['Self-hosting n8n took me one evening and saved a bill every month. Here is the part that broke first, and the fix.'],
    })
    await t.action(internal.internal.writer.writePost, { postId })
    expect(await t.run((ctx) => ctx.db.get(postId))).toMatchObject({ status: 'draft' })
  })

  it('refuses a post model test on variants the planner does not know, and stops one that stalled', async () => {
    const t = setup()
    const account = await t.run((ctx) => insertAccount(ctx))
    await t.run(async (ctx) => {
      await found(ctx, account, { title: 'I replaced three tools with one n8n flow', score: 400 })
      await found(ctx, account, { title: 'My weekly n8n setup', score: 40 })
      await found(ctx, account, { title: 'n8n release notes', score: 30 })
    })
    const start = (variants: typeof EXPERIMENT_CATALOG.post_model) =>
      t.mutation(api.private.experiments.create, {
        accountId: account._id,
        name: 'Post model',
        hypothesis: 'Posts on what people answered most bring more.',
        kind: 'post_model',
        metric: 'reach',
        variants: [...variants],
        minItems: 15,
        minConfidence: 0.9,
      })
    const [planned] = EXPERIMENT_CATALOG.post_model
    if (!planned) throw new Error('no control')
    await expect(
      start([planned, { key: 'copied', label: 'Copied', description: 'Post the same thread.', isControl: false }])
    ).rejects.toThrow('"Copied" is no post model the planner knows; the keys are planned, modeled.')
    const experimentId = await start(EXPERIMENT_CATALOG.post_model)

    // Fifteen days on, nothing stands out any more and no modeled post was planned: the test could never be decided.
    await t.run(async (ctx) => {
      await ctx.db.patch(experimentId, { createdAt: Date.now() - 15 * 24 * 3_600_000 })
      for (const signal of await ctx.db.query('signals').collect()) await ctx.db.patch(signal._id, { status: 'used' })
    })
    expect(await t.mutation(internal.internal.analyst.evaluateExperiments, { accountId: account._id })).toEqual({ decided: 0 })
    expect(await t.run((ctx) => ctx.db.get(experimentId))).toMatchObject({ status: 'stopped' })
  })

  it('counts a post under the post model it is, not the default it was planned under', async () => {
    const t = setup()
    const stats = await t.run(async (ctx) => {
      const account = await insertAccount(ctx)
      // "Modeled on what worked" won, yet only one of the two posts since had a standout left to be modeled on.
      await ctx.db.patch(account._id, {
        strategy: {
          pillarWeights: [],
          defaults: [
            { kind: 'post_model', key: 'modeled', label: 'Modeled on what worked', description: 'Post on what worked.', since: 0 },
          ],
        },
      })
      const signalId = await found(ctx, account, { title: 'I replaced three tools with one n8n flow', score: 400 })
      const postedAt = Date.now() - 10 * 24 * 3_600_000
      const modeled = await insertMeasuredPost(ctx, account, { postedAt, impressions: 900, clicks: 9 })
      await ctx.db.patch(modeled._id, { basis: { kind: 'model', thread: await threadOf(ctx, signalId) } })
      await insertMeasuredPost(ctx, account, { postedAt, impressions: 100, clicks: 1 })
      const latest = await ctx.db.get(account._id)
      if (!latest) throw new Error('no account')
      const since = postedAt - 3_600_000
      return {
        modeled: await variantStatsSince(ctx, latest, 'post_model', 'modeled', since, 'clicks'),
        planned: await variantStatsSince(ctx, latest, 'post_model', 'planned', since, 'clicks'),
      }
    })
    expect([stats.modeled.items, stats.planned.items]).toEqual([1, 1])
  })
})
