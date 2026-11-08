import {
  SPONSOR_SEGMENT_LABELS,
  accountReachOf,
  countsClicks,
  reachOf,
  type ConversionKind,
  type ItemRead,
  type Platform,
  type ProbableBasis,
} from '@influstep/shared'
import type { Doc, Id } from '../_generated/dataModel'
import type { QueryCtx } from '../_generated/server'
import { capabilitiesOf } from '../providers/platforms'
import { accountReader } from './connections'
import { addDays, dayKey } from './dates'
import type { ItemRef } from './measure'
import { countConversions, postedItems, postedSince, shownClicks, type ConversionLike, type PostedItem, type PostedRows } from './posted'
import { workspaceOf } from './workspace'

/**
 * The reports (CONTEXT.md, "Report"): the workspace's funnel over every
 * account, each account's reach line, funnel and trend from the numbers the
 * analyst read, the clicks and the conversions, and what works across
 * accounts. Counting rules live here so the queries, the strategy review and
 * the tests agree.
 */

type Reader = { db: QueryCtx['db'] }

const DAY_MS = 86_400_000

/** The report's window: what an account's report, the account header and a leak read. */
export const REPORT_DAYS = 28

/**
 * The window's funnel (CONTEXT.md, "Report"): what the account's posts and
 * replies posted in it earned on their platform, summed over the ones the
 * analyst read, then the tracked-link clicks and the conversions in it.
 * Reach is counted as the account's platform counts it (shared `reachOf`), so
 * only one account's funnel has it. A number no item carries is null, never
 * a zero: a platform that does not count it, or nothing read yet.
 */
export interface Funnel {
  /** Posts and replies posted in the window, and how many of them have numbers read. */
  items: number
  counted: number
  /** Reach summed over the items that carry it, and how many do; a Hacker News comment has none. */
  reach: number | null
  reached: number
  /** The comments under the items whose platform counts them. */
  replies: number | null
  /** The tracked links' clicks; null where the posts link to the sponsor directly (shared `countsClicks`), so no click is counted. */
  clicks: number | null
  demos: number
  signups: number
  trials: number
  paid: number
  /** Paid times the workspace's value per paid conversion. */
  value: number
  /** True when any input was mock data, so the report can say so. */
  mock: boolean
}

/**
 * Funnels of accounts on different platforms added up: everything but reach,
 * which each platform counts its own way. The clicks are the counted ones
 * only, so where some accounts' are not counted the signups are no share of
 * them (`everyClickCounted`).
 */
export type FunnelTotal = Omit<Funnel, 'reach' | 'reached'> & { everyClickCounted: boolean }

export interface TrendPoint {
  day: string
  reach: number
  /** Null where no click is counted, as in the funnel. */
  clicks: number | null
  signups: number
}

/** The sum of the numbers that are there, or null when none is: a missing number is no zero. */
function sumKnown(values: readonly (number | null)[]): number | null {
  const known = values.flatMap((value) => (value === null ? [] : [value]))
  return known.length === 0 ? null : known.reduce((sum, value) => sum + value, 0)
}

/** The funnel of the posts and replies posted in a window, each with the analyst's last read of it, or none yet. */
export function buildFunnel(args: {
  items: readonly { numbers?: ItemRead }[]
  clicks: number | null
  conversions: readonly ConversionLike[]
  valuePerPaid: number
}): Funnel {
  const read = args.items.flatMap((item) => (item.numbers === undefined ? [] : [item.numbers]))
  const reaches = read.map((numbers) => reachOf(numbers.counts))
  return {
    items: args.items.length,
    counted: read.length,
    reach: sumKnown(reaches),
    reached: reaches.filter((reach) => reach !== null).length,
    replies: sumKnown(read.map((numbers) => numbers.counts.replies)),
    clicks: args.clicks,
    ...countConversions(args.conversions, args.valuePerPaid),
    mock: read.some((numbers) => numbers.mock) || args.conversions.some((conversion) => conversion.mock),
  }
}

type Summed = Exclude<keyof FunnelTotal, 'mock' | 'replies' | 'clicks' | 'everyClickCounted'>

/** Funnels added up: every count but reach. The workspace report's total over its accounts. */
export function sumFunnels(funnels: readonly Funnel[]): FunnelTotal {
  const sum = (key: Summed) => funnels.reduce((total, funnel) => total + funnel[key], 0)
  return {
    items: sum('items'),
    counted: sum('counted'),
    replies: sumKnown(funnels.map((funnel) => funnel.replies)),
    clicks: sumKnown(funnels.map((funnel) => funnel.clicks)),
    everyClickCounted: funnels.every((funnel) => funnel.clicks !== null),
    demos: sum('demos'),
    signups: sum('signups'),
    trials: sum('trials'),
    paid: sum('paid'),
    value: sum('value'),
    mock: funnels.some((funnel) => funnel.mock),
  }
}

/** The key a snapshot's item is grouped by. */
function itemKey(item: ItemRef): string {
  return item.kind === 'post' ? item.postId : item.replyId
}

/**
 * Reach per day over the window: what each item's reach grew by since its
 * last read. Only the items the funnel counts, posted in the window, so each
 * starts from nothing and the trend adds up to the funnel's reach.
 */
export function buildTrend(args: {
  days: string[]
  snapshots: Doc<'metricSnapshots'>[]
  /** The items posted in the window, by `itemKey`. */
  items: ReadonlySet<string>
  /** Null where no click is counted. */
  clicks: { day: string }[] | null
  conversions: { day: string; kind: Doc<'conversions'>['kind'] }[]
  snapshotDay: (snapshot: Doc<'metricSnapshots'>) => string
}): TrendPoint[] {
  const reachByDay = new Map<string, number>()
  const byItem = new Map<string, Doc<'metricSnapshots'>[]>()
  for (const snapshot of args.snapshots) {
    const key = itemKey(snapshot.item)
    if (!args.items.has(key)) continue
    byItem.set(key, [...(byItem.get(key) ?? []), snapshot])
  }
  for (const series of byItem.values()) {
    const ordered = [...series].sort((a, b) => a.takenAt - b.takenAt)
    let previous = 0
    for (const snapshot of ordered) {
      const reach = reachOf(snapshot.counts) ?? 0
      const day = args.snapshotDay(snapshot)
      reachByDay.set(day, (reachByDay.get(day) ?? 0) + Math.max(0, reach - previous))
      previous = reach
    }
  }
  return args.days.map((day) => ({
    day,
    reach: reachByDay.get(day) ?? 0,
    clicks: args.clicks === null ? null : args.clicks.filter((click) => click.day === day).length,
    signups: args.conversions.filter((conversion) => conversion.day === day && conversion.kind === 'signup').length,
  }))
}

/** An account's reach line (CONTEXT.md, "Report"): its karma or followers at the last read of each day of the window. */
export interface ReachLine {
  points: { day: string; value: number }[]
  /** At the last read, and how far it moved since the first read in the window. */
  latest: number
  change: number
  mock: boolean
}

export function buildReachLine(snapshots: Doc<'accountSnapshots'>[], dayOf: (at: number) => string): ReachLine | null {
  const ordered = [...snapshots].sort((a, b) => a.takenAt - b.takenAt)
  const first = ordered[0]
  const last = ordered.at(-1)
  if (!first || !last) return null
  const byDay = new Map<string, number>()
  for (const snapshot of ordered) byDay.set(dayOf(snapshot.takenAt), accountReachOf(snapshot.reach))
  return {
    points: [...byDay].map(([day, value]) => ({ day, value })),
    latest: accountReachOf(last.reach),
    change: accountReachOf(last.reach) - accountReachOf(first.reach),
    mock: ordered.some((snapshot) => snapshot.mock),
  }
}

/**
 * What the report reads of an account over a window, once: what went out in
 * it, its clicks, null where its posts link to the sponsor directly (shared
 * `countsClicks`), and its conversions.
 */
interface WindowRows {
  posted: PostedRows
  clicks: Doc<'linkClicks'>[] | null
  conversions: Doc<'conversions'>[]
}

async function windowRows(ctx: Reader, account: Doc<'accounts'>, since: number): Promise<WindowRows> {
  const posted = await postedSince(ctx, account._id, since)
  const clicks = countsClicks(account.platform)
    ? await ctx.db
        .query('linkClicks')
        .withIndex('by_account_time', (q) => q.eq('accountId', account._id).gte('at', since))
        .collect()
    : null
  const conversions = await ctx.db
    .query('conversions')
    .withIndex('by_account_time', (q) => q.eq('accountId', account._id).gte('at', since))
    .collect()
  return { posted, clicks, conversions }
}

function funnelOf(rows: WindowRows, valuePerPaid: number): Funnel {
  return buildFunnel({
    items: [...rows.posted.posts, ...rows.posted.replies],
    clicks: rows.clicks === null ? null : rows.clicks.length,
    conversions: rows.conversions,
    valuePerPaid,
  })
}

/** The account's funnel over the last `days` days, today included: what the home page, the account header and the chat read. */
export async function reportFunnel(ctx: Reader, account: Doc<'accounts'>, days: number, now: number) {
  const workspace = await workspaceOf(ctx, account)
  const rows = await windowRows(ctx, account, now - days * DAY_MS)
  return { days, funnel: funnelOf(rows, workspace.valuePerPaid), currency: workspace.currency }
}

/** The account's karma or followers at the last read, or null before the first. */
export async function latestReach(ctx: Reader, accountId: Id<'accounts'>): Promise<number | null> {
  const read = await ctx.db
    .query('accountSnapshots')
    .withIndex('by_account_time', (q) => q.eq('accountId', accountId))
    .order('desc')
    .first()
  return read === null ? null : accountReachOf(read.reach)
}

/** The account report over the last `days` days, today included, in the account's own timezone. */
export interface ReportWindow {
  days: number
  funnel: Funnel
  /** One point per day of the window, oldest first. */
  trend: TrendPoint[]
  /** Null when the account's reach was never read in the window. */
  reachLine: ReachLine | null
  /** What went out in the window, newest first. */
  posted: PostedItem[]
  /** What the account's reader reads: a number it cannot read is explained, never shown as zero. */
  reads: { counts: boolean; account: boolean }
  currency: string
}

/** The account report's whole reading of a window: the funnel, the trend, the reach line and what went out. */
export async function reportWindow(ctx: Reader, account: Doc<'accounts'>, days: number, now: number): Promise<ReportWindow> {
  const workspace = await workspaceOf(ctx, account)
  const since = now - days * DAY_MS
  const rows = await windowRows(ctx, account, since)
  const snapshots = await ctx.db
    .query('metricSnapshots')
    .withIndex('by_account_time', (q) => q.eq('accountId', account._id).gte('takenAt', since))
    .collect()
  const reachReads = await ctx.db
    .query('accountSnapshots')
    .withIndex('by_account_time', (q) => q.eq('accountId', account._id).gte('takenAt', since))
    .collect()
  const today = dayKey(now, account.timezone)
  const trend = buildTrend({
    days: Array.from({ length: days }, (_, index) => addDays(today, index - days + 1)),
    snapshots,
    items: new Set([...rows.posted.posts.map((post) => post._id), ...rows.posted.replies.map((reply) => reply._id)]),
    clicks: rows.clicks === null ? null : rows.clicks.map((click) => ({ day: dayKey(click.at, account.timezone) })),
    conversions: rows.conversions.map((conversion) => ({ day: dayKey(conversion.at, account.timezone), kind: conversion.kind })),
    snapshotDay: (snapshot) => dayKey(snapshot.takenAt, account.timezone),
  })
  const reads = capabilitiesOf(await accountReader(ctx, account))
  return {
    days,
    funnel: funnelOf(rows, workspace.valuePerPaid),
    trend,
    reachLine: buildReachLine(reachReads, (at) => dayKey(at, account.timezone)),
    posted: await postedItems(ctx, account, rows.posted, rows.conversions, workspace.valuePerPaid),
    reads: { counts: reads.includes('counts'), account: reads.includes('account') },
    currency: workspace.currency,
  }
}

/**
 * A platform's probable conversions over a window (shared probable.ts): each
 * kind counted, and how many people said where they heard of the sponsor
 * against came from the platform's domain. They name the platform, never an
 * account or a post, so the report shows them apart from the funnel and no
 * experiment or strategy rule reads them.
 */
export interface ProbableCounts extends ReturnType<typeof countConversions> {
  platform: Platform
  /** The people behind them, by what their conversion rests on. */
  heard: number
  referred: number
  mock: boolean
}

/** A platform's probable conversions over the last `days` days, today included, like the funnel beside them. */
export async function probableCounts(
  ctx: Reader,
  platform: Platform,
  days: number,
  now: number,
  valuePerPaid: number
): Promise<ProbableCounts> {
  const rows = await ctx.db
    .query('probableConversions')
    .withIndex('by_platform_time', (q) => q.eq('platform', platform).gte('at', now - days * DAY_MS))
    .collect()
  const people = (basis: ProbableBasis) => new Set(rows.filter((row) => row.basis === basis).map((row) => row.distinctId)).size
  return {
    platform,
    ...countConversions(rows, valuePerPaid),
    heard: people('heard_about_us'),
    referred: people('referrer'),
    mock: rows.some((row) => row.mock),
  }
}

/**
 * Measured posts posted in this many days make the report's "what works"
 * lists and score the strategy review's pillars, so both read the same facts.
 */
export const WHAT_WORKS_DAYS = 28

/** The posts measured and posted since `since`: what the "what works" lists and the pillar scores count. */
export function measuredPostsSince(posts: readonly Doc<'posts'>[], since: number): Doc<'posts'>[] {
  return posts.filter((post) => post.status === 'measured' && post.posted !== undefined && post.posted.at >= since)
}

/**
 * What one measured post brought: its reach at the latest read (none when
 * not read), its clicks, null where its platform's posts link to the sponsor
 * directly (core/posted.ts `shownClicks`), and its signups and paid
 * conversions with their value.
 */
export interface PostOutcome {
  post: Doc<'posts'>
  reach: number
  clicks: number | null
  signups: number
  paid: number
  value: number
}

export async function postOutcomes(
  ctx: Reader,
  platform: Platform,
  posts: readonly Doc<'posts'>[],
  conversions: readonly Pick<Doc<'conversions'>, 'kind' | 'postId'>[],
  valuePerPaid: number
): Promise<PostOutcome[]> {
  const out: PostOutcome[] = []
  for (const post of posts) {
    const count = (kind: ConversionKind) =>
      conversions.filter((conversion) => conversion.kind === kind && conversion.postId === post._id).length
    const reach = post.numbers === undefined ? null : reachOf(post.numbers.counts)
    const paid = count('paid')
    out.push({
      post,
      reach: reach ?? 0,
      clicks: await shownClicks(ctx, platform, post._id),
      signups: count('signup'),
      paid,
      value: paid * valuePerPaid,
    })
  }
  return out
}

/**
 * One group of a "what works" list: the posts that share a pillar or a
 * sponsor segment, added up. Its clicks per reach count only the posts whose
 * clicks are counted, and are null when none of them are.
 */
export interface GroupOutcome {
  key: string
  label: string
  posts: number
  reach: number
  clicks: number | null
  paid: number
  value: number
  valuePerPost: number
  signupsPerPost: number
  clicksPerReach: number | null
  postIds: Id<'posts'>[]
}

/**
 * The posts grouped by `groupOf`, ranked by value per post, then signups per
 * post, which every platform counts, then clicks per reach, then by label so
 * equal groups keep one order. A post `groupOf` places in no group is left
 * out.
 */
export function rankGroups(
  outcomes: readonly PostOutcome[],
  groupOf: (post: Doc<'posts'>) => { key: string; label: string } | null
): GroupOutcome[] {
  const members = new Map<string, { group: { key: string; label: string }; outcomes: PostOutcome[] }>()
  for (const outcome of outcomes) {
    const group = groupOf(outcome.post)
    if (!group) continue
    const entry = members.get(group.key) ?? { group, outcomes: [] }
    entry.outcomes.push(outcome)
    members.set(group.key, entry)
  }
  return [...members.values()]
    .map(({ group, outcomes: grouped }) => {
      const sum = (pick: (outcome: PostOutcome) => number) => grouped.reduce((total, outcome) => total + pick(outcome), 0)
      const clicked = grouped.flatMap((outcome) => (outcome.clicks === null ? [] : [{ clicks: outcome.clicks, reach: outcome.reach }]))
      const clickedReach = clicked.reduce((total, outcome) => total + outcome.reach, 0)
      const clicks = clicked.length === 0 ? null : clicked.reduce((total, outcome) => total + outcome.clicks, 0)
      const value = sum((outcome) => outcome.value)
      return {
        ...group,
        posts: grouped.length,
        reach: sum((outcome) => outcome.reach),
        clicks,
        paid: sum((outcome) => outcome.paid),
        value,
        valuePerPost: value / grouped.length,
        signupsPerPost: sum((outcome) => outcome.signups) / grouped.length,
        clicksPerReach: clicks === null ? null : clickedReach === 0 ? 0 : clicks / clickedReach,
        postIds: grouped.map((outcome) => outcome.post._id),
      }
    })
    .sort(
      (a, b) =>
        b.valuePerPost - a.valuePerPost ||
        b.signupsPerPost - a.signupsPerPost ||
        (b.clicksPerReach ?? -1) - (a.clicksPerReach ?? -1) ||
        a.label.localeCompare(b.label)
    )
}

export interface WhatWorks {
  pillar: GroupOutcome[]
  sponsor: GroupOutcome[]
  /** Measured posts the lists count. */
  posts: number
}

/** The two "what works" lists over every account's measured posts of the last WHAT_WORKS_DAYS days. */
export async function whatWorks(ctx: Reader, accounts: readonly Doc<'accounts'>[], valuePerPaid: number, now: number): Promise<WhatWorks> {
  const since = now - WHAT_WORKS_DAYS * DAY_MS
  const outcomes: PostOutcome[] = []
  for (const account of accounts) {
    const posts = await ctx.db
      .query('posts')
      .withIndex('by_account', (q) => q.eq('accountId', account._id))
      .collect()
    const conversions = await ctx.db
      .query('conversions')
      .withIndex('by_account_time', (q) => q.eq('accountId', account._id))
      .collect()
    outcomes.push(...(await postOutcomes(ctx, account.platform, measuredPostsSince(posts, since), conversions, valuePerPaid)))
  }
  return {
    pillar: rankGroups(outcomes, (post) => (post.pillar === undefined ? null : { key: post.pillar, label: post.pillar })),
    sponsor: rankGroups(outcomes, (post) => ({ key: post.sponsorSegment, label: SPONSOR_SEGMENT_LABELS[post.sponsorSegment] })),
    posts: outcomes.length,
  }
}
