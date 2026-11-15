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
  it('adds every account up, the one with the most clicks first, each row the account report’s own funnel', async () => {
    const { t, adaId, maxId, forumId } = await seeded()
    const report = await t.query(api.private.report.forWorkspace, {})

    // Ada's sponsored posts bring clicks; the forum account has posted nothing yet.
    const ranked = [...report.accounts].sort(
      (a, b) => (b.funnel.clicks ?? 0) - (a.funnel.clicks ?? 0) || b.funnel.counted - a.funnel.counted
    )
    expect(report.accounts.map((row) => row.account._id)).toEqual(ranked.map((row) => row.account._id))
    expect(report.accounts.map((row) => row.account._id)).toEqual(expect.arrayContaining([adaId, maxId, forumId]))
    const ada = report.accounts.find((row) => row.account._id === adaId)
    const max = report.accounts.find((row) => row.account._id === maxId)
    if (!ada || !max) throw new Error('two rows expected')
    expect(ada.funnel.clicks).toBeGreaterThan(0)
    expect(max.funnel.reach).toBeGreaterThan(0)

    // Reach is each platform's own count, so the total leaves it out.
    const sum = (count: (row: (typeof report.accounts)[number]) => number) => report.accounts.reduce((total, row) => total + count(row), 0)
    for (const key of ['items', 'counted'] as const) {
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
          (b.clicksPerReach ?? -1) - (a.clicksPerReach ?? -1) ||
          (b.reachPerPost ?? -1) - (a.reachPerPost ?? -1) ||
          a.label.localeCompare(b.label)
      )
      expect(list.map((group) => group.key)).toEqual(ranked.map((group) => group.key))
    }
  })
})
