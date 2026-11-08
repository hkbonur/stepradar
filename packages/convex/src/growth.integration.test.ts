import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, internal } from './_generated/api'
import type { Doc } from './_generated/dataModel'
import type { MutationCtx } from './_generated/server'
import { instantAt } from './core/dates'
import { TIMEZONE, insertAccount, insertMeasuredPost, insertPost } from '../test/fixtures'
import { setup } from '../test/setup'

afterEach(() => {
  vi.useRealTimers()
})

const DAY = 86_400_000

/** Thursday noon where the accounts are: Monday to Thursday of the week are due. */
const THURSDAY = instantAt('2026-10-22', 12, TIMEZONE)

/** A post that carried a tracked link, read at `reach` impressions with `clicks` clicks on its link. */
async function linkedPost(ctx: MutationCtx, account: Doc<'accounts'>, postedAt: number, reach: number, clicks: number) {
  const post = await insertMeasuredPost(ctx, account, { postedAt, impressions: reach, clicks })
  await ctx.db.patch(post._id, { sponsorLink: 'http://localhost:3300/go/abc' })
}

describe('growth', () => {
  it("asks an account that fell behind its week's posts to post, and counts a skipped post as due", async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(THURSDAY)
    const t = setup()
    const account = await t.run(async (ctx) => {
      const account = await insertAccount(ctx)
      for (const [day, status] of [
        ['2026-10-19', 'posted'],
        ['2026-10-20', 'skipped'],
        ['2026-10-21', 'draft'],
        ['2026-10-22', 'draft'],
        // Killed was never due; Friday is not due yet.
        ['2026-10-21', 'killed'],
        ['2026-10-23', 'idea'],
      ] as const) {
        const post = await insertPost(ctx, account, { status, plannedFor: day })
        if (status === 'posted') await ctx.db.patch(post._id, { posted: { kind: 'said', at: Date.now() } })
      }
      return account
    })
    const page = await t.query(api.private.accounts.get, { accountId: account._id })
    // Thursday's post is due at its hour, not before.
    expect(page?.numbers.posting).toEqual({ weekStart: '2026-10-19', due: 3, posted: 1 })
    const steps = (await t.query(api.private.today.view, { now: THURSDAY })).nextSteps
    expect(steps.find((step) => step.kind === 'consistency')?.text).toBe(
      '@ada_automates posted 1 of the 3 posts due this week: an account that posts on schedule keeps growing. Its drafts wait on its page.'
    )
  })

  it('finds where fewer of the people reached click through, says so, and aims the next test at it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(THURSDAY)
    const t = setup()
    const account = await t.run(async (ctx) => {
      const account = await insertAccount(ctx)
      // Four weeks ago, 1% of 10,000 clicked through; in the last four weeks 0.2% of 20,000 did: still 40 clicks, enough to
      // decide a test on clicks.
      for (const back of [40, 45]) await linkedPost(ctx, account, THURSDAY - back * DAY, 5_000, 50)
      for (const back of [5, 10]) await linkedPost(ctx, account, THURSDAY - back * DAY, 10_000, 20)
      return account
    })
    const report = await t.query(api.private.report.forAccount, { accountId: account._id })
    expect(report?.leak).toMatchObject({ step: 'click', rate: 0.002, before: 0.01 })
    expect(report?.leak?.text).toBe(
      "0.20% of the people @ada_automates's linked posts reached in 28 days clicked through against 1.00% in the 28 days before. The strategy review tests how its posts open and end on that next. Mock numbers."
    )
    const review = await t.mutation(internal.internal.analyst.reviewStrategy, { accountId: account._id })
    const startedId = review.startedExperimentId
    if (startedId === undefined) throw new Error('the review started no experiment')
    const started = await t.run((ctx) => ctx.db.get(startedId))
    expect(['hook', 'call_to_action']).toContain(started?.kind)
    expect(started?.metric).not.toBe('reach')
  })

  it('reads only the paid step where posts link straight to the sponsor, and says the leak is the product', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(THURSDAY)
    const t = setup()
    const reddit = await t.run(async (ctx) => {
      const reddit = await insertAccount(ctx, { platform: 'reddit', handle: 'ada' })
      const conversion = (kind: 'signup' | 'paid', at: number, index: number) =>
        ctx.db.insert('conversions', { accountId: reddit._id, kind, distinctId: `${kind}-${at}-${index}`, at, mock: false })
      // Six of twenty signups paid four weeks ago; one of twenty did since.
      for (let index = 0; index < 20; index += 1) {
        await conversion('signup', THURSDAY - 40 * DAY, index)
        await conversion('signup', THURSDAY - 5 * DAY, index)
      }
      for (let index = 0; index < 6; index += 1) await conversion('paid', THURSDAY - 40 * DAY, index)
      await conversion('paid', THURSDAY - 5 * DAY, 0)
      return reddit
    })
    const report = await t.query(api.private.report.forAccount, { accountId: reddit._id })
    expect(report?.leak).toMatchObject({ step: 'paid', rate: 0.05, before: 0.3, mock: false })
    expect(report?.leak?.text).toBe(
      '5.00% of the signups from u/ada in 28 days paid against 30.00% in the 28 days before: the leak is in the product after signing up, not in the posts.'
    )
  })

  it('shows what the last week brought against the week before', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(THURSDAY)
    const t = setup()
    await t.run(async (ctx) => {
      const account = await insertAccount(ctx)
      const conversion = (kind: 'signup' | 'paid', at: number) =>
        ctx.db.insert('conversions', { accountId: account._id, kind, distinctId: `${kind}-${at}`, at, mock: true })
      await conversion('signup', THURSDAY - DAY)
      await conversion('paid', THURSDAY - 2 * DAY)
      await conversion('signup', THURSDAY - 8 * DAY)
      await conversion('signup', THURSDAY - 9 * DAY)
    })
    const overview = await t.query(api.private.home.overview, {})
    expect(overview.growth.accounts).toMatchObject([{ signups: 1, paid: 1, before: { signups: 2, paid: 0 }, testing: null }])
  })
})
