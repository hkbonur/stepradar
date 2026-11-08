import type { Doc, Id } from '../_generated/dataModel'
import { query } from '../_generated/server'
import { reportFunnel } from '../core/report'
import { accountRefOf } from '../core/accounts'
import { GROWTH_DAYS, growthLine } from '../core/growth'

/**
 * The bottom of Today: what the accounts changed on their own this week,
 * what each account's last week brought against the week before and what it
 * tests now, and what each earned over the report's window. What waits on
 * the operator is Today itself (core/today.ts).
 */

/** How many of the week's changes are named; the rest are counted. */
const SHOWN = 4
/** The changes of "this week": the last seven days, whatever the account's timezone. */
const WEEK_MS = 7 * 86_400_000
/** The report's window, so the earnings here are the workspace report's own. */
const EARNED_DAYS = 28

export const overview = query({
  args: {},
  handler: async (ctx) => {
    const now = Date.now()
    const accounts = await ctx.db.query('accounts').collect()
    const byId = new Map<Id<'accounts'>, Doc<'accounts'>>(accounts.map((account) => [account._id, account]))
    const who = (accountId: Id<'accounts'>) => {
      const account = byId.get(accountId)
      if (!account) throw new Error(`account ${accountId} not found`)
      return accountRefOf(account)
    }

    // What changed on its own: the journal entries the analyst and the researcher wrote this week, newest first.
    const changes: Doc<'journal'>[] = []
    for (const account of accounts) {
      const entries = await ctx.db
        .query('journal')
        .withIndex('by_account_time', (q) => q.eq('accountId', account._id).gte('createdAt', now - WEEK_MS))
        .collect()
      changes.push(...entries.filter((entry) => entry.actor !== 'operator'))
    }
    changes.sort((a, b) => b.createdAt - a.createdAt)

    // What it earned: each account's value over the window, from the report's own reading.
    const earned = []
    let currency: string | null = null
    for (const account of accounts) {
      const window = await reportFunnel(ctx, account, EARNED_DAYS, now)
      currency = window.currency
      earned.push({ account: who(account._id), value: window.funnel.value, paid: window.funnel.paid, mock: window.funnel.mock })
    }
    earned.sort((a, b) => b.value - a.value || b.paid - a.paid)

    // What the last week brought against the week before, and what each account tests now (core/growth.ts).
    const growth = []
    for (const account of accounts) {
      const running = await ctx.db
        .query('experiments')
        .withIndex('by_account_status', (q) => q.eq('accountId', account._id).eq('status', 'running'))
        .first()
      growth.push({ account: who(account._id), ...(await growthLine(ctx, account, now)), testing: running?.name ?? null })
    }

    return {
      changes: {
        entries: changes.slice(0, SHOWN).map((entry) => ({
          _id: entry._id,
          text: entry.text,
          kind: entry.kind,
          actor: entry.actor,
          createdAt: entry.createdAt,
          account: who(entry.accountId),
        })),
        count: changes.length,
      },
      earned: {
        days: EARNED_DAYS,
        currency,
        accounts: earned,
        total: earned.reduce((sum, row) => sum + row.value, 0),
        mock: earned.some((row) => row.mock),
      },
      growth: { days: GROWTH_DAYS, accounts: growth, mock: growth.some((row) => row.mock) },
    }
  },
})
