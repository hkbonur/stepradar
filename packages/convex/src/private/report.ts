import { v } from 'convex/values'
import { variantRate } from '@stepradar/shared'
import { query } from '../_generated/server'
import { REPORT_DAYS, WHAT_WORKS_DAYS, latestReach, reportFunnel, reportWindow, sumFunnels, whatWorks } from '../core/report'
import { requireWorkspace } from '../core/workspace'
import { variantStatsFor } from '../core/experiments'
import { accountRefOf } from '../core/accounts'
import { leakOf, leakText, postingWeeks } from '../core/growth'

/** How many weeks of posting the account report shows, the current one so far last. */
const POSTING_WEEKS = 4

/**
 * One screen per account (CONTEXT.md, "Report"): its reach line, the funnel
 * and trend of the window, its open experiments, and what it posted with
 * what each brought back.
 */
export const forAccount = query({
  args: { accountId: v.id('accounts') },
  handler: async (ctx, args) => {
    const account = await ctx.db.get(args.accountId)
    if (!account) return null
    const now = Date.now()
    // The window's funnel is the one the workspace report's row for this account shows.
    const window = await reportWindow(ctx, account, REPORT_DAYS, now)
    const leak = await leakOf(ctx, account, now)

    const experiments = []
    for (const experiment of await ctx.db
      .query('experiments')
      .withIndex('by_account_status', (q) => q.eq('accountId', account._id))
      .collect()) {
      const stats = await variantStatsFor(ctx, experiment)
      experiments.push({ ...experiment, stats: stats.map((stat) => ({ ...stat, rate: variantRate(stat) })) })
    }

    return {
      account,
      windowDays: REPORT_DAYS,
      funnel: window.funnel,
      trend: window.trend,
      reachLine: window.reachLine,
      reads: window.reads,
      experiments,
      posted: window.posted,
      // How it posted as planned, week by week (core/growth.ts), and where its funnel leaks now.
      posting: await postingWeeks(ctx, account, now, POSTING_WEEKS),
      leak: leak === null ? null : { ...leak, text: leakText(account, leak) },
    }
  },
})

/**
 * The workspace report: every account's funnel over the window added up but
 * for reach, which each platform counts its own way, one row per account
 * with its own reach and its karma or followers at the last read, the
 * accounts that bring the most clicks first, and what works across them. Each
 * row is the account report's own funnel (core `reportFunnel`), so a
 * drill-down never shows another number.
 */
export const forWorkspace = query({
  args: {},
  handler: async (ctx) => {
    const workspace = await requireWorkspace(ctx)
    const now = Date.now()
    const accounts = await ctx.db
      .query('accounts')
      .withIndex('by_workspace', (q) => q.eq('workspaceId', workspace._id))
      .collect()
    const rows = []
    for (const account of accounts) {
      const { funnel } = await reportFunnel(ctx, account, REPORT_DAYS, now)
      // The account's karma or followers at the last read; null before the first.
      const reach = await latestReach(ctx, account._id)
      rows.push({ account: { ...accountRefOf(account), paused: account.paused }, funnel, reach })
    }
    rows.sort((a, b) => (b.funnel.clicks ?? 0) - (a.funnel.clicks ?? 0) || b.funnel.counted - a.funnel.counted)
    return {
      windowDays: REPORT_DAYS,
      total: sumFunnels(rows.map((row) => row.funnel)),
      accounts: rows,
      whatWorks: await whatWorks(ctx, accounts, now),
      whatWorksDays: WHAT_WORKS_DAYS,
    }
  },
})
