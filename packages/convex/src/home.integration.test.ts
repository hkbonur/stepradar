import { describe, expect, it } from 'vitest'
import { api, internal } from './_generated/api'
import { setup } from '../test/setup'

describe('home overview', () => {
  it('leaves what waits to Today, and answers what changed on its own this week and what each account earned', async () => {
    const t = setup()
    await t.mutation(internal.internal.seed.run, { appUrl: 'http://localhost:3300' })
    await t.finishAllScheduledFunctions(() => {})
    const overview = await t.query(api.private.home.overview, {})

    // What waits on the operator is Today: the seed's open checklist and its reply drafts are there.
    const today = await t.query(api.private.today.view, { now: Date.now() })
    expect(today.checklist).toBe((await t.query(api.private.checklist.list, {})).filter((item) => item.status === 'open').length)
    // The seed has no comment rows, so every reply draft is in Today's list, its mention's answer among them.
    const drafts = await t.run(async (ctx) => (await ctx.db.query('replies').collect()).filter((reply) => reply.status === 'draft'))
    expect(today.drafts.total).toBe(drafts.length)
    expect(today.failed.every((post) => post.status === 'failed')).toBe(true)

    // Ada's seeded review six days ago moved pillar weight: a change the analyst made on its own this week.
    expect(overview.changes.count).toBeGreaterThan(0)
    expect(overview.changes.entries.every((entry) => entry.actor !== 'operator')).toBe(true)
    expect(overview.changes.entries.map((entry) => entry.createdAt)).toEqual(
      overview.changes.entries.map((entry) => entry.createdAt).sort((a, b) => b - a)
    )

    // The earnings are the workspace report's rows.
    const report = await t.query(api.private.report.forWorkspace, {})
    expect(overview.earned.accounts.map((row) => [row.account.name, row.value])).toEqual(
      report.accounts.map((row) => [row.account.name, row.funnel.value])
    )
    expect(overview.earned.total).toBe(report.total.value)
  })
})
