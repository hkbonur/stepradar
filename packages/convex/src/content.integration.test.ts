import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, internal } from './_generated/api'
import { addDays, dayKey, instantAt, weekStart } from './core/dates'
import { mockLlm } from './providers/llm/mock'
import { TIMEZONE, insertAccount, insertPost, insertSignal } from '../test/fixtures'
import { setup } from '../test/setup'

afterEach(() => {
  vi.restoreAllMocks()
})

const DAY = 86_400_000

describe('content', () => {
  it('plans a post on an open problem however old it is, and never lets its signal age out while it is open', async () => {
    const t = setup()
    const account = await t.run((ctx) => insertAccount(ctx))
    const problem = await t.run((ctx) =>
      insertSignal(ctx, account, {
        title: 'How do I stop a webhook from running twice?',
        source: 'problems',
        score: 95,
        foundAt: Date.now() - 16 * DAY,
        publishedAt: Date.now() - 16 * DAY,
      })
    )
    await t.mutation(internal.internal.schedule.ageOutSignals, {})
    expect(await t.run((ctx) => ctx.db.get(problem._id))).toMatchObject({ status: 'new' })
    const nextWeek = addDays(weekStart(dayKey(Date.now(), TIMEZONE)), 7)
    await t.mutation(internal.internal.writer.planWeek, { accountId: account._id, weekStart: nextWeek })
    const posts = await t.run((ctx) => ctx.db.query('posts').collect())
    expect(posts.filter((post) => post.signalIds.includes(problem._id))).toHaveLength(1)
  })

  it('drops the ideas on days the cadence no longer posts on, and frees the signals they drew on', async () => {
    const t = setup()
    const account = await t.run((ctx) => insertAccount(ctx))
    const signals = await t.run(async (ctx) =>
      Promise.all(
        ['retries', 'webhooks', 'forms'].map((topic) =>
          insertSignal(ctx, account, { title: `How do I fix ${topic}?`, score: 95, foundAt: Date.now() })
        )
      )
    )
    // Two weeks out, so no idea is due to be written while the test runs, whatever today is.
    const later = addDays(weekStart(dayKey(Date.now(), TIMEZONE)), 14)
    await t.mutation(internal.internal.writer.planWeek, { accountId: account._id, weekStart: later })
    const planned = await t.run((ctx) => ctx.db.query('posts').collect())
    expect(new Set(planned.map((post) => post.plannedFor)).size).toBe(7)
    const { _id, _creationTime, workspaceId, handle, platform, paused, createdAt, voice, strategy, forum, ...settings } = account
    await t.mutation(api.private.accounts.update, { accountId: account._id, ...settings, cadence: { ...account.cadence, postDays: 2 } })
    const kept = await t.run((ctx) => ctx.db.query('posts').collect())
    // That week's Tuesday and Thursday keep their ideas, two each; every other day's went.
    expect(kept.map((post) => post.plannedFor).sort()).toEqual([addDays(later, 1), addDays(later, 1), addDays(later, 3), addDays(later, 3)])
    // A signal a dropped idea drew on is new again for a later plan; one a kept idea draws on stays used.
    const keptDraws = new Set(kept.flatMap((post) => post.signalIds))
    const statuses = await t.run(async (ctx) => Promise.all(signals.map(async (signal) => (await ctx.db.get(signal._id))?.status)))
    expect(statuses).toEqual(signals.map((signal) => (keptDraws.has(signal._id) ? 'used' : 'new')))
    expect(planned.some((post) => post.signalIds.length > 0 && !kept.some((other) => other._id === post._id))).toBe(true)
  })

  it("sends a draft carrying another post's tracked link back to the writer to leave it out", async () => {
    const t = setup()
    const post = await t.run(async (ctx) =>
      insertPost(ctx, await insertAccount(ctx), { status: 'idea', plannedFor: addDays(dayKey(Date.now(), TIMEZONE), 1) })
    )
    const write = vi
      .spyOn(mockLlm, 'writePost')
      .mockResolvedValueOnce({ title: 'Retries', parts: ['Retry the step, not the workflow: http://localhost:3300/go/abc1234'] })
      .mockResolvedValueOnce({ title: 'Retries', parts: ['Retry the step, not the workflow. What do you retry first?'] })
    await t.action(internal.internal.writer.writePost, { postId: post._id })
    expect(write.mock.calls[1]?.[0].problems).toContain('Leave out http://localhost:3300/go/abc1234: a post carries no link but its own.')
  })

  it('plans a launch on every account that can announce it, naming the product, and says why the others cannot', async () => {
    const t = setup()
    const { x, hn, reddit } = await t.run(async (ctx) => {
      const x = await insertAccount(ctx)
      const hn = await insertAccount(ctx, { platform: 'hackernews', handle: 'ada_hn' })
      const reddit = await insertAccount(ctx, { platform: 'reddit', handle: 'ada' })
      for (const account of [hn, reddit]) await ctx.db.patch(account._id, { workspaceId: x.workspaceId })
      // Reddit met one subreddit, whose rules forbid self-promotion.
      await ctx.db.insert('communities', {
        accountId: reddit._id,
        name: 'n8n',
        rulesText: 'No advertising.',
        selfPromotion: 'forbidden',
        reason: 'No advertising.',
        weight: 1,
        rulesReadAt: Date.now(),
      })
      return { x, hn, reddit }
    })
    const day = addDays(dayKey(Date.now(), TIMEZONE), 3)
    await expect(t.mutation(api.private.launches.plan, { day, what: ' ' })).rejects.toThrow('Say what shipped, in a line.')
    const outcomes = await t.mutation(api.private.launches.plan, { day, what: 'Forms that resume where the customer stopped' })
    expect(outcomes.map((outcome) => [outcome.account._id, outcome.kind])).toEqual([
      [x._id, 'planned'],
      [hn._id, 'planned'],
      [reddit._id, 'left out'],
    ])
    expect(outcomes.find((outcome) => outcome.account._id === reddit._id)).toMatchObject({
      why: 'No subreddit u/ada met allows self-promotion, so a launch there would break its rules.',
    })
    const posts = await t.run((ctx) => ctx.db.query('posts').collect())
    expect(
      posts.map((post) => [post.accountId, post.intent, post.community ?? null, post.sponsorSegment, post.plannedFor, post.basis])
    ).toEqual([
      [x._id, 'show', null, 'mention', day, { kind: 'launch', what: 'Forms that resume where the customer stopped' }],
      [hn._id, 'show', 'Show HN', 'mention', day, { kind: 'launch', what: 'Forms that resume where the customer stopped' }],
    ])
    // Written, the launch names the product with the account's affiliation line.
    const [xPost] = posts
    if (!xPost) throw new Error('no launch post')
    await t.action(internal.internal.writer.writePost, { postId: xPost._id })
    const written = await t.run((ctx) => ctx.db.get(xPost._id))
    expect(written?.parts?.join('\n')).toContain(x.affiliationLine)
  })

  it("puts a launch in the place and at the hour of the day's unwritten idea, and leaves out an account whose day is taken or whose dial is 0", async () => {
    const t = setup()
    const day = addDays(dayKey(Date.now(), TIMEZONE), 3)
    const { x, busy, quiet, idea } = await t.run(async (ctx) => {
      const x = await insertAccount(ctx)
      const busy = await insertAccount(ctx, { handle: 'ada_busy' })
      const quiet = await insertAccount(ctx, { platform: 'linkedin', handle: 'ada-quiet' })
      await ctx.db.patch(busy._id, { workspaceId: x.workspaceId })
      await ctx.db.patch(quiet._id, { workspaceId: x.workspaceId, sponsorDial: 0 })
      const idea = await insertPost(ctx, x, { status: 'idea', plannedFor: day })
      await ctx.db.patch(idea._id, { scheduledAt: instantAt(day, 15, TIMEZONE) })
      await ctx.db.patch((await insertPost(ctx, busy, { status: 'draft', plannedFor: day }))._id, { title: 'Retries' })
      return { x, busy, quiet, idea }
    })
    const launch = () => t.mutation(api.private.launches.plan, { day, what: 'Forms that resume where the customer stopped' })
    const outcomes = await launch()
    expect(outcomes.map((outcome) => [outcome.account._id, outcome.kind, outcome.kind === 'left out' ? outcome.why : null])).toEqual([
      [x._id, 'planned', null],
      [busy._id, 'left out', expect.stringMatching(/ already holds "Retries", written; move it first\.$/)],
      [quiet._id, 'left out', 'Its sponsor dial is 0, so it never names the product.'],
    ])
    const posts = await t.run((ctx) => ctx.db.query('posts').collect())
    expect(posts.find((post) => post._id === idea._id)?.status).toBe('killed')
    expect(posts.find((post) => post.basis?.kind === 'launch')).toMatchObject({
      accountId: x._id,
      scheduledAt: instantAt(day, 15, TIMEZONE),
    })
    // A day holds one launch.
    expect((await launch())[0]).toMatchObject({ kind: 'left out', why: expect.stringMatching(/ already holds its launch\.$/) })
  })

  it('skips a launch whose community stopped allowing the product before it was written', async () => {
    const t = setup()
    const { reddit, communityId } = await t.run(async (ctx) => {
      const reddit = await insertAccount(ctx, { platform: 'reddit', handle: 'ada' })
      const communityId = await ctx.db.insert('communities', {
        accountId: reddit._id,
        name: 'nocode',
        rulesText: 'Self-promotion on Saturdays.',
        selfPromotion: 'allowed',
        reason: 'Self-promotion on Saturdays.',
        weight: 1,
        rulesReadAt: Date.now(),
      })
      return { reddit, communityId }
    })
    const day = addDays(dayKey(Date.now(), TIMEZONE), 3)
    expect(await t.mutation(api.private.launches.plan, { day, what: 'Forms that resume where the customer stopped' })).toMatchObject([
      { account: { _id: reddit._id }, kind: 'planned' },
    ])
    await t.run((ctx) => ctx.db.patch(communityId, { selfPromotion: 'forbidden', reason: 'No self-promotion.' }))
    const [post] = await t.run((ctx) => ctx.db.query('posts').collect())
    if (!post) throw new Error('no launch post')
    await t.action(internal.internal.writer.writePost, { postId: post._id })
    expect(await t.run((ctx) => ctx.db.get(post._id))).toMatchObject({
      status: 'skipped',
      skipReason: 'A launch that cannot name the product is no launch: nocode no longer allows it.',
    })
  })
})
