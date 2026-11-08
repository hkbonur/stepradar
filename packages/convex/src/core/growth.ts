import {
  MEASUREMENT_WINDOW_MS,
  countsClicks,
  funnelLeak,
  handleOf,
  reachOf,
  type Leak,
  type StepFlows,
  type WeekPosting,
} from '@influstep/shared'
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
 * Where the account's funnel leaks (shared `funnelLeak`): its last LEAK_DAYS
 * days against the LEAK_DAYS before, read once over both and split.
 *
 * Only a post that carries a tracked link can be clicked through, so the
 * click step reads the reach of those posts and every click on their links,
 * each post in the window it went out in, never a reply's reach or the bio's
 * clicks. The signup step reads every counted click of the window, the
 * bio's included, since a signup after either counts; the paid step reads
 * the signups. A platform whose posts link straight to the sponsor counts no
 * click, so it has no click or signup step.
 */
export async function leakOf(ctx: Reader, account: Doc<'accounts'>, now: number): Promise<AccountLeak | null> {
  const span = LEAK_DAYS * DAY_MS
  const since = now - 2 * span
  const split = now - span
  const conversions = await ctx.db
    .query('conversions')
    .withIndex('by_account_time', (q) => q.eq('accountId', account._id).gte('at', since))
    .collect()
  const converted = (from: number, to: number, kind: 'signup' | 'paid') =>
    conversions.filter((conversion) => conversion.kind === kind && conversion.at >= from && conversion.at < to).length
  const paidStep = (from: number, to: number) => ({ from: converted(from, to, 'signup'), to: converted(from, to, 'paid') })
  const mockConversions = conversions.some((conversion) => conversion.mock)
  if (!countsClicks(account.platform)) {
    const leak = funnelLeak(
      { click: null, signup: null, paid: paidStep(split, now + 1) },
      { click: null, signup: null, paid: paidStep(since, split) }
    )
    return leak === null ? null : { ...leak, mock: mockConversions }
  }
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
  const flows = (from: number, to: number): StepFlows => {
    const posts = linked.filter((post) => post.posted !== undefined && post.posted.at >= from && post.posted.at < to)
    const ids = new Set(posts.map((post) => post._id))
    const windowClicks = clicks.filter((click) => click.at >= from && click.at < to).length
    return {
      click: {
        from: posts.reduce((sum, post) => sum + (post.numbers === undefined ? 0 : (reachOf(post.numbers.counts) ?? 0)), 0),
        to: clicks.filter((click) => click.postId !== undefined && ids.has(click.postId)).length,
      },
      signup: { from: windowClicks, to: converted(from, to, 'signup') },
      paid: paidStep(from, to),
    }
  }
  const leak = funnelLeak(flows(split, now + 1), flows(since, split))
  if (leak === null) return null
  return { ...leak, mock: mockConversions || linked.some((post) => post.numbers?.mock === true) }
}

/**
 * Where an account's funnel leaks, in words, with whose it is to fix: fewer
 * clicks is the posts', which the strategy review tests next; fewer signups
 * after a click, or fewer paying after a signup, is the product's page and
 * the product, which no post fixes.
 */
export function leakText(account: Pick<Doc<'accounts'>, 'platform' | 'handle'>, leak: AccountLeak): string {
  const handle = handleOf(account)
  // A dry step let nothing through, which no rate before makes better or worse.
  const share = leak.rate === 0 ? 'None' : percentText(leak.rate)
  const was = leak.before === null || leak.rate === 0 ? '' : ` against ${percentText(leak.before)} in the ${LEAK_DAYS} days before`
  const mock = leak.mock ? ' Mock numbers.' : ''
  switch (leak.step) {
    case 'click':
      return `${share} of the people ${handle}'s linked posts reached in ${LEAK_DAYS} days clicked through${was}. The strategy review tests how its posts open and end on that next.${mock}`
    case 'signup':
      return `${share} of the clicks from ${handle} in ${LEAK_DAYS} days became signups${was}: the page they land on loses them, not the posts.${mock}`
    case 'paid':
      return `${share} of the signups from ${handle} in ${LEAK_DAYS} days paid${was}: the leak is in the product after signing up, not in the posts.${mock}`
  }
}

/** Why the strategy review aimed its next test at a leak, as its journal says it. */
export function leakReason(leak: AccountLeak): string {
  return `${percentText(leak.rate)} of the people the account's linked posts reached clicked through in the last ${LEAK_DAYS} days${leak.before === null ? '' : `, against ${percentText(leak.before)} before`}, and this dimension moves that.`
}

/** The signups and paid conversions of a span, and of the same span before it. */
export interface GrowthLine {
  signups: number
  paid: number
  before: { signups: number; paid: number }
  mock: boolean
}

/** The account's last GROWTH_DAYS days against the GROWTH_DAYS before: what the bottom of Today shows. */
export async function growthLine(ctx: Reader, account: Doc<'accounts'>, now: number): Promise<GrowthLine> {
  const span = GROWTH_DAYS * DAY_MS
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

/** The conversions of [since, until), the ones from `split` on against the ones before it. */
async function growthBetween(
  ctx: Reader,
  account: Doc<'accounts'>,
  bounds: { since: number; split: number; until: number }
): Promise<GrowthLine> {
  const conversions = await ctx.db
    .query('conversions')
    .withIndex('by_account_time', (q) => q.eq('accountId', account._id).gte('at', bounds.since).lt('at', bounds.until))
    .collect()
  const count = (kind: 'signup' | 'paid', recent: boolean) =>
    conversions.filter((conversion) => conversion.kind === kind && conversion.at >= bounds.split === recent).length
  return {
    signups: count('signup', true),
    paid: count('paid', true),
    before: { signups: count('signup', false), paid: count('paid', false) },
    mock: conversions.some((conversion) => conversion.mock),
  }
}
