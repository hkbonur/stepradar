import {
  MEASUREMENT_WINDOW_MS,
  accountReachOf,
  countsClicks,
  clickLeak,
  handleOf,
  reachOf,
  type Leak,
  type ClickFlow,
  type WeekPosting,
} from '@stepradar/shared'
import type { Doc } from '../_generated/dataModel'
import type { QueryCtx } from '../_generated/server'
import { addDays, dayKey, instantAt, weekStart } from './dates'
import { percentText } from './experiments'
import { REPORT_DAYS } from './report'

/**
 * What moves users next, read per account (shared growth.ts): whether it
 * posts as planned, where its funnel leaks, and what a span brought against
 * the span before. Today, the digest, the report and the strategy review
 * read them.
 */

type Reader = { db: QueryCtx['db'] }

const DAY_MS = 86_400_000

/** A leak is read over the report's window, against the same span before it. */
export const LEAK_DAYS = REPORT_DAYS

/** The growth line's span, against the same span before it. */
export const GROWTH_DAYS = 7

/** A week's posting, by the Monday it starts on. */
export type PostingWeek = WeekPosting & { weekStart: string }

/**
 * The posts of the account's week due by now, and how many went out
 * (CONTEXT.md, "Consistency"): a post is due once its hour came, or once it
 * went out early. A post the operator skipped, or whose day passed before it
 * was written, was due and did not go out; a killed one never was.
 */
export async function weekPosting(ctx: Reader, account: Doc<'accounts'>, now: number): Promise<PostingWeek> {
  const today = dayKey(now, account.timezone)
  const start = weekStart(today)
  return { weekStart: start, ...(await postingBetween(ctx, account, start, today, now)) }
}

/** The account's posting in each of its last `weeks` weeks, oldest first, the current one so far. */
export async function postingWeeks(ctx: Reader, account: Doc<'accounts'>, now: number, weeks: number): Promise<PostingWeek[]> {
  const current = await weekPosting(ctx, account, now)
  const past: PostingWeek[] = []
  for (let back = weeks - 1; back >= 1; back -= 1) {
    const start = addDays(current.weekStart, -7 * back)
    past.push({ weekStart: start, ...(await postingBetween(ctx, account, start, addDays(start, 6), now)) })
  }
  return [...past, current]
}

async function postingBetween(ctx: Reader, account: Doc<'accounts'>, from: string, to: string, now: number): Promise<WeekPosting> {
  const posts = await ctx.db
    .query('posts')
    .withIndex('by_account_day', (q) => q.eq('accountId', account._id).gte('plannedFor', from).lte('plannedFor', to))
    .collect()
  const due = posts.filter((post) => post.status !== 'killed' && (post.scheduledAt <= now || post.posted !== undefined))
  return { due: due.length, posted: due.filter((post) => post.posted !== undefined).length }
}

/** Where an account's funnel leaks, with whether any number it read was mock. */
export type AccountLeak = Leak & { mock: boolean }

/**
 * Whether the account's clicks leak (shared `clickLeak`): its last LEAK_DAYS
 * days against the LEAK_DAYS before, read once over both and split.
 *
 * Only a post that carries a tracked link can be clicked through, so the
 * leak reads the reach of those posts and every click on their links,
 * each post in the window it went out in, never a reply's reach or the bio's
 * clicks. A platform whose posts link straight to the sponsor counts no
 * click, so nothing there can leak.
 */
export async function leakOf(ctx: Reader, account: Doc<'accounts'>, now: number): Promise<AccountLeak | null> {
  if (!countsClicks(account.platform)) return null
  const span = LEAK_DAYS * DAY_MS
  const since = now - 2 * span
  const split = now - span
  // A click on a post comes within its measurement window: reading them from the earliest post's start covers them all.
  const clicks = await ctx.db
    .query('linkClicks')
    .withIndex('by_account_time', (q) => q.eq('accountId', account._id).gte('at', since))
    .collect()
  const linked = (
    await ctx.db
      .query('posts')
      .withIndex('by_account_posted', (q) => q.eq('accountId', account._id).gte('posted.at', since - MEASUREMENT_WINDOW_MS))
      .collect()
  ).filter((post) => post.sponsorLink !== undefined && post.posted !== undefined && post.posted.at >= since)
  const flow = (from: number, to: number): ClickFlow => {
    const posts = linked.filter((post) => post.posted !== undefined && post.posted.at >= from && post.posted.at < to)
    const ids = new Set(posts.map((post) => post._id))
    return {
      reached: posts.reduce((sum, post) => sum + (post.numbers === undefined ? 0 : (reachOf(post.numbers.counts) ?? 0)), 0),
      clicked: clicks.filter((click) => click.postId !== undefined && ids.has(click.postId)).length,
    }
  }
  const leak = clickLeak(flow(split, now + 1), flow(since, split))
  if (leak === null) return null
  return { ...leak, mock: linked.some((post) => post.numbers?.mock === true) }
}

/** Where an account's funnel leaks, in words: fewer clicks is the posts', which the strategy review tests next. */
export function leakText(account: Pick<Doc<'accounts'>, 'platform' | 'handle'>, leak: AccountLeak): string {
  const handle = handleOf(account)
  // A dry step let nothing through, which no rate before makes better or worse.
  const share = leak.rate === 0 ? 'None' : percentText(leak.rate)
  const was = leak.before === null || leak.rate === 0 ? '' : ` against ${percentText(leak.before)} in the ${LEAK_DAYS} days before`
  const mock = leak.mock ? ' Mock numbers.' : ''
  return `${share} of the people ${handle}'s linked posts reached in ${LEAK_DAYS} days clicked through${was}. The strategy review tests how its posts open and end on that next.${mock}`
}

/** Why the strategy review aimed its next test at a leak, as its journal says it. */
export function leakReason(leak: AccountLeak): string {
  return `${percentText(leak.rate)} of the people the account's linked posts reached clicked through in the last ${LEAK_DAYS} days${leak.before === null ? '' : `, against ${percentText(leak.before)} before`}, and this dimension moves that.`
}

/**
 * What a span brought, and the same span before it: the karma or followers
 * the account gained (shared `accountReachOf`), from the last read before the
 * span (or its first read, when none came before) to its last read, null
 * when nothing was read in the span; and the clicks on its tracked links,
 * null where its posts link to the sponsor directly (shared `countsClicks`).
 */
export interface GrowthLine {
  gained: number | null
  clicks: number | null
  before: { gained: number | null; clicks: number | null }
  mock: boolean
}

/** The account's last `days` days against the `days` before: GROWTH_DAYS at the bottom of Today, a month in the goal note. */
export async function growthOver(ctx: Reader, account: Doc<'accounts'>, now: number, days: number): Promise<GrowthLine> {
  const span = days * DAY_MS
  return growthBetween(ctx, account, { since: now - 2 * span, split: now - span, until: now + 1 })
}

/**
 * The account's last calendar week, Monday to Sunday where it is, against
 * the week before: what the Monday digest says.
 */
export async function lastWeekLine(ctx: Reader, account: Doc<'accounts'>, now: number): Promise<GrowthLine> {
  const thisMonday = weekStart(dayKey(now, account.timezone))
  const at = (day: string) => instantAt(day, 0, account.timezone)
  return growthBetween(ctx, account, { since: at(addDays(thisMonday, -14)), split: at(addDays(thisMonday, -7)), until: at(thisMonday) })
}

/** The reach gained and the clicks of [since, until), the ones from `split` on against the ones before it. */
async function growthBetween(
  ctx: Reader,
  account: Doc<'accounts'>,
  bounds: { since: number; split: number; until: number }
): Promise<GrowthLine> {
  const reads = await ctx.db
    .query('accountSnapshots')
    .withIndex('by_account_time', (q) => q.eq('accountId', account._id).gte('takenAt', bounds.since).lt('takenAt', bounds.until))
    .collect()
  // The read before the first span, so what moved between it and the span's first read counts too.
  const earlier = await ctx.db
    .query('accountSnapshots')
    .withIndex('by_account_time', (q) => q.eq('accountId', account._id).lt('takenAt', bounds.since))
    .order('desc')
    .first()
  const ordered = [...(earlier === null ? [] : [earlier]), ...reads].sort((a, b) => a.takenAt - b.takenAt)
  const gained = (from: number, to: number) => {
    const upTo = ordered.filter((read) => read.takenAt < to)
    const last = upTo.at(-1)
    if (last === undefined || last.takenAt < from) return null
    const start = upTo.filter((read) => read.takenAt < from).at(-1) ?? upTo.find((read) => read.takenAt >= from)
    if (start === undefined || start === last) return null
    return accountReachOf(last.reach) - accountReachOf(start.reach)
  }
  const clicks = countsClicks(account.platform)
    ? await ctx.db
        .query('linkClicks')
        .withIndex('by_account_time', (q) => q.eq('accountId', account._id).gte('at', bounds.since).lt('at', bounds.until))
        .collect()
    : null
  const clicked = (from: number, to: number) =>
    clicks === null ? null : clicks.filter((click) => click.at >= from && click.at < to).length
  return {
    gained: gained(bounds.split, bounds.until),
    clicks: clicked(bounds.split, bounds.until),
    before: { gained: gained(bounds.since, bounds.split), clicks: clicked(bounds.since, bounds.split) },
    mock: ordered.some((read) => read.mock),
  }
}
