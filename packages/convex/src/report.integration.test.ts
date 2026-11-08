import { describe, expect, it } from 'vitest'
import { api, internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { setup } from '../test/setup'

type Test = ReturnType<typeof setup>

async function seeded(): Promise<{ t: Test; adaId: Id<'accounts'>; maxId: Id<'accounts'>; forumId: Id<'accounts'> }> {
  const t = setup()
  await t.mutation(internal.internal.seed.run, { appUrl: 'http://localhost:3300' })
  await t.finishAllScheduledFunctions(() => {})
  const accounts = await t.query(api.private.accounts.list, {})
  const ada = accounts.find((account) => account.handle === 'ada_automates' && account.platform === 'x')
  const max = accounts.find((account) => account.handle === 'max_builds')
  const forum = accounts.find((account) => account.platform === 'forum')
  if (!ada || !max || !forum) throw new Error('the seed has no Ada, Max or forum account')
  return { t, adaId: ada._id, maxId: max._id, forumId: forum._id }
}

describe('workspace report', () => {
  it('adds every account up, the one that earns first, each row the account report’s own funnel', async () => {
    const { t, adaId, maxId, forumId } = await seeded()
    const report = await t.query(api.private.report.forWorkspace, {})

    // Ada brings paying customers; Max brings reach but nothing paid yet; the forum account has posted nothing yet.
    expect(report.accounts.map((row) => row.account._id)).toEqual([adaId, maxId, forumId])
    const [ada, max] = report.accounts
    if (!ada || !max) throw new Error('two rows expected')
    expect(ada.funnel.value).toBeGreaterThan(0)
    expect(max.funnel).toMatchObject({ paid: 0, value: 0 })
    expect(max.funnel.reach).toBeGreaterThan(0)

    // Reach is each platform's own count, so the total leaves it out.
    const sum = (count: (row: (typeof report.accounts)[number]) => number) => report.accounts.reduce((total, row) => total + count(row), 0)
    for (const key of ['items', 'counted', 'demos', 'signups', 'trials', 'paid', 'value'] as const) {
      expect(report.total[key]).toBe(sum((row) => row.funnel[key]))
    }
    expect(report.total.replies).toBe(sum((row) => row.funnel.replies ?? 0))
    expect(report.total.clicks).toBe(sum((row) => row.funnel.clicks ?? 0))
    expect(report.total).not.toHaveProperty('reach')
    // Each row carries the account's followers at the last read.
    expect(ada.reach).toBeGreaterThan(0)

    const adaReport = await t.query(api.private.report.forAccount, { accountId: adaId })
    expect(adaReport?.funnel).toEqual(ada.funnel)
  })

  it('ranks what works over both accounts’ measured posts', async () => {
    const { t } = await seeded()
    const { whatWorks } = await t.query(api.private.report.forWorkspace, {})

    expect(whatWorks.posts).toBeGreaterThan(0)
    // Max's pillars sit next to Ada's: the lists are the workspace's, not one account's.
    expect(whatWorks.pillar.map((group) => group.key)).toEqual(expect.arrayContaining(['n8n tutorials', 'MCP servers']))
    expect(whatWorks.sponsor.reduce((sum, group) => sum + group.posts, 0)).toBe(whatWorks.posts)
    for (const list of [whatWorks.pillar, whatWorks.sponsor]) {
      const ranked = [...list].sort(
        (a, b) =>
          b.valuePerPost - a.valuePerPost || b.signupsPerPost - a.signupsPerPost || (b.clicksPerReach ?? -1) - (a.clicksPerReach ?? -1)
      )
      expect(list.map((group) => group.key)).toEqual(ranked.map((group) => group.key))
    }
  })
})

describe('probable conversions', () => {
  it('reads every platform’s once a day for the workspace, and reports them apart from any account’s funnel', async () => {
    const { t, adaId } = await seeded()
    await t.mutation(internal.internal.schedule.pullMetrics, {})
    const queued = await t.run((ctx) => ctx.db.query('jobs').collect())
    expect(queued.filter((job) => job.kind === 'pull_probable')).toHaveLength(1)
    await t.finishAllScheduledFunctions(() => {})
    // A second read finds the same people, and stores none twice.
    expect(await t.action(internal.internal.analyst.pullProbable, {})).toEqual({ probable: 0 })

    const rows = await t.run((ctx) => ctx.db.query('probableConversions').collect())
    const onX = rows.filter((row) => row.platform === 'x' && row.at >= Date.now() - 28 * 24 * 3_600_000)
    expect(onX.length).toBeGreaterThan(0)
    const report = await t.query(api.private.report.forAccount, { accountId: adaId })
    expect(report?.probable).toMatchObject({
      platform: 'x',
      signups: onX.filter((row) => row.kind === 'signup').length,
      paid: onX.filter((row) => row.kind === 'paid').length,
      mock: true,
    })
    const conversions = await t.run((ctx) => ctx.db.query('conversions').collect())
    expect(conversions.some((conversion) => conversion.distinctId.startsWith('mock-probable'))).toBe(false)
    // Both seeded X accounts show X once; the forum account brings its forum's.
    const probable = (await t.query(api.private.report.forWorkspace, {})).probable
    expect(probable.map((row) => row.platform)).toEqual(['x', 'forum'])
    expect(probable[0]).toEqual(report?.probable)
  })
})
