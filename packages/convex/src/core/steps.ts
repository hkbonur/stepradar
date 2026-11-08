import {
  EXPERIMENT_MEMORY_MS,
  fellBehind,
  grouped,
  handleOf,
  itemsNoun,
  placeLabel,
  placeOf,
  postedItemOf,
  reachOf,
  staleAt,
  type FunnelStep,
  type WeekPosting,
} from '@influstep/shared'
import type { Doc, Id } from '../_generated/dataModel'
import type { QueryCtx } from '../_generated/server'
import { readableMetrics, variantStatsFor } from './experiments'
import { leakOf, leakText, weekPosting, type AccountLeak } from './growth'
import { wentOutYet } from './posted'
import { whatWorked } from './niche'
import { repliesWithStatus } from './replies'

/**
 * Next steps (docs/plan.md, "Experiments, strategy and next steps"): what the
 * operator does next, derived on read by rules, at most three, each with its
 * numbers and where to do it. Today shows them; the morning digest leads with
 * the first.
 */

type Reader = { db: QueryCtx['db'] }

/** How many steps Today shows. */
export const NEXT_STEPS_SHOWN = 3

/** A draft this close to going stale is worth a step. */
const DRAFT_STALE_SOON_MS = 6 * 3_600_000

/** A reply is taking off when its reach grew at least this much since the read before, and at least doubled. */
const TAKING_OFF_MIN = 100

/** How far back a decision still changes what comes next. */
const DECISION_NEWS_MS = 7 * 24 * 3_600_000

export type NextStep =
  | { kind: 'comments'; accountId: Id<'accounts'>; text: string; url: string; waiting: number }
  | { kind: 'first_post'; accountId: Id<'accounts'>; text: string; url: string }
  | { kind: 'taking_off'; accountId: Id<'accounts'>; text: string; url: string; reach: number; grew: number }
  | { kind: 'draft'; accountId: Id<'accounts'>; text: string; url: string; staleInHours: number }
  | { kind: 'near_decision'; accountId: Id<'accounts'>; text: string; url: string; items: number; minItems: number }
  | { kind: 'decision'; accountId: Id<'accounts'>; text: string; url: string }
  | { kind: 'standout'; accountId: Id<'accounts'>; text: string; url: string }
  | { kind: 'consistency'; accountId: Id<'accounts'>; text: string; url: string; due: number; posted: number }
  | { kind: 'leak'; accountId: Id<'accounts'>; text: string; url: string; step: FunnelStep }

/** The draft that can be a new account's first: a reply, on the account's replies page, or a post, on its own page. */
type FirstDraft = { kind: 'reply' } | { kind: 'post'; postId: Id<'posts'> }

/** What the rules read, gathered once (`nextStepsInput`). */
export interface NextStepsInput {
  comments: { account: Doc<'accounts'>; waiting: number }[]
  /** An account no draft of which went out yet, and the draft it can start with. */
  firstDrafts: { account: Doc<'accounts'>; draft: FirstDraft }[]
  takingOff: { account: Doc<'accounts'>; reply: Doc<'replies'>; reach: number; grew: number }[]
  drafts: { account: Doc<'accounts'>; reply: Doc<'replies'>; staleAt: number }[]
  /** A running experiment's last variant one measured item short of the floor, every other one there. */
  nearDecision: { account: Doc<'accounts'>; experiment: Doc<'experiments'>; variantLabel: string; items: number }[]
  decided: { account: Doc<'accounts'>; experiment: Doc<'experiments'>; winnerLabel: string; description: string; decidedAt: number }[]
  /** An account free to test, with a standout to model posts on, that has not tested posts modeled on what worked lately. */
  standouts: { account: Doc<'accounts'>; title: string }[]
  /** An account that posted less than half of the posts due so far this week (shared `fellBehind`). */
  behind: { account: Doc<'accounts'>; week: WeekPosting }[]
  /** An account whose funnel leaks (core/growth.ts `leakOf`). */
  leaks: { account: Doc<'accounts'>; leak: AccountLeak }[]
}

/**
 * The steps, in the order the plan ranks them, the most pressing of each
 * kind first:
 *
 * 1. comments waiting on the operator;
 * 2. a new account's first post;
 * 3. an account that fell behind its posts this week;
 * 4. a thread the operator took part in that is taking off;
 * 5. a draft about to go stale;
 * 6. where an account's funnel leaks;
 * 7. an experiment one item short of a decision;
 * 8. what the latest decision changes;
 * 9. a test of posts modeled on a thread that did well.
 *
 * Today shows the first NEXT_STEPS_SHOWN.
 */
export function nextSteps(input: NextStepsInput, now: number): NextStep[] {
  const steps: NextStep[] = []
  for (const { account, waiting } of [...input.comments].sort((a, b) => b.waiting - a.waiting)) {
    if (waiting === 0) continue
    steps.push({
      kind: 'comments',
      accountId: account._id,
      text: `Answer ${counted(waiting, 'comment', 'comments')} for ${handleOf(account)}: the drafts wait under each.`,
      url: '/',
      waiting,
    })
  }
  for (const { account, draft } of input.firstDrafts) {
    steps.push({
      kind: 'first_post',
      accountId: account._id,
      text: `No draft of ${handleOf(account)}'s has gone out yet: post one on ${placeLabel(placeOf(account))} yourself, then mark it posted.`,
      url: draft.kind === 'reply' ? `/accounts/${account._id}/replies` : `/posts/${draft.postId}`,
    })
  }
  for (const { account, week } of [...input.behind].sort((a, b) => a.week.posted / a.week.due - b.week.posted / b.week.due)) {
    steps.push({
      kind: 'consistency',
      accountId: account._id,
      text: `${handleOf(account)} posted ${grouped(week.posted)} of the ${grouped(week.due)} posts due this week: an account that posts on schedule keeps growing. Its drafts wait on its page.`,
      url: `/accounts/${account._id}`,
      due: week.due,
      posted: week.posted,
    })
  }
  const [rising] = [...input.takingOff].sort((a, b) => b.grew - a.grew)
  if (rising) {
    steps.push({
      kind: 'taking_off',
      accountId: rising.account._id,
      text: `Your reply on ${rising.reply.thread.title ?? 'a thread'} is taking off: ${grouped(rising.reach)} reach, up ${grouped(rising.grew)} since the read before. Answer what comes in.`,
      url: postedItemOf(rising.reply.posted)?.url ?? rising.reply.thread.url,
      reach: rising.reach,
      grew: rising.grew,
    })
  }
  const [soonest] = input.drafts.filter((draft) => draft.staleAt - now <= DRAFT_STALE_SOON_MS).sort((a, b) => a.staleAt - b.staleAt)
  if (soonest) {
    const hours = Math.max(0, Math.floor((soonest.staleAt - now) / 3_600_000))
    steps.push({
      kind: 'draft',
      accountId: soonest.account._id,
      text: `A draft for ${handleOf(soonest.account)} goes stale ${hours === 0 ? 'within the hour' : `in ${counted(hours, 'hour', 'hours')}`}: post it or let it go.`,
      url: `/accounts/${soonest.account._id}/replies`,
      staleInHours: hours,
    })
  }
  for (const { account, leak } of input.leaks) {
    steps.push({ kind: 'leak', accountId: account._id, text: leakText(account, leak), url: `/reports/${account._id}`, step: leak.step })
  }
  const [closest] = input.nearDecision
  if (closest) {
    const { experiment, variantLabel, items } = closest
    steps.push({
      kind: 'near_decision',
      accountId: closest.account._id,
      text: `"${experiment.name}" can be decided once "${variantLabel}" has one more measured ${itemsNoun(experiment.kind) === 'replies' ? 'reply' : 'post'}: it has ${grouped(items)} of ${grouped(experiment.minItems)}.`,
      url: '/experiments',
      items,
      minItems: experiment.minItems,
    })
  }
  const [latest] = input.decided
    .filter((decision) => now - decision.decidedAt <= DECISION_NEWS_MS)
    .sort((a, b) => b.decidedAt - a.decidedAt)
  if (latest) {
    steps.push({
      kind: 'decision',
      accountId: latest.account._id,
      text: `"${latest.winnerLabel}" won "${latest.experiment.name}": from now on ${handleOf(latest.account)} will ${lowerFirst(latest.description)}`,
      url: '/experiments',
    })
  }
  for (const { account, title } of input.standouts) {
    steps.push({
      kind: 'standout',
      accountId: account._id,
      text: `People answered "${title}" far more than the other threads found in ${handleOf(account)}'s niche: test posts modeled on what worked.`,
      url: '/experiments',
    })
  }
  return steps
}

/** What the next steps read of the accounts, from their indexes. */
export async function nextStepsInput(ctx: Reader, accounts: readonly Doc<'accounts'>[], now: number): Promise<NextStepsInput> {
  const input: NextStepsInput = {
    comments: [],
    firstDrafts: [],
    takingOff: [],
    drafts: [],
    nearDecision: [],
    decided: [],
    standouts: [],
    behind: [],
    leaks: [],
  }
  for (const account of accounts) {
    const comments = await ctx.db
      .query('comments')
      .withIndex('by_account_status', (q) => q.eq('accountId', account._id).eq('status', 'new'))
      .collect()
    input.comments.push({ account, waiting: comments.length })
    const replyDrafts = await repliesWithStatus(ctx, account._id, 'draft')
    for (const reply of replyDrafts) input.drafts.push({ account, reply, staleAt: staleAt(reply) })
    const firstDraft = await firstDraftOf(ctx, account, replyDrafts.length)
    if (firstDraft !== null) input.firstDrafts.push({ account, draft: firstDraft })
    input.takingOff.push(...(await takingOff(ctx, account)))
    const experiments = await ctx.db
      .query('experiments')
      .withIndex('by_account_status', (q) => q.eq('accountId', account._id))
      .collect()
    for (const experiment of experiments) {
      if (experiment.status === 'running') {
        const stats = await variantStatsFor(ctx, experiment)
        const short = stats.filter((stat) => stat.items < experiment.minItems)
        const [last] = short
        if (short.length === 1 && last && experiment.minItems - last.items === 1) {
          const variant = experiment.variants.find((candidate) => candidate.key === last.key)
          if (!variant) throw new Error(`experiment ${experiment._id} has stats for a variant it does not have`)
          input.nearDecision.push({ account, experiment, variantLabel: variant.label, items: last.items })
        }
      }
      const decision = experiment.decision
      if (experiment.status !== 'decided' || !decision) continue
      const winner = experiment.variants.find((variant) => variant.key === decision.winnerKey)
      if (!winner) throw new Error(`experiment ${experiment._id} was decided for a variant it does not have`)
      input.decided.push({ account, experiment, winnerLabel: winner.label, description: winner.description, decidedAt: decision.decidedAt })
    }
    const standout = await standoutToTest(ctx, account, experiments, now)
    if (standout !== null) input.standouts.push({ account, title: standout })
    const week = await weekPosting(ctx, account, now)
    if (fellBehind(week)) input.behind.push({ account, week })
    const leak = await leakOf(ctx, account, now)
    if (leak !== null) input.leaks.push({ account, leak })
  }
  return input
}

/**
 * The title of the standout a post model test would start from, when the
 * account is free to test one: no experiment running (the review's own
 * rule), no post model tested within EXPERIMENT_MEMORY_MS (a stopped one by
 * when it started, which is all a stop keeps), a standout, and a test it
 * could decide (core `readableMetrics`). The review picks dimensions the
 * account knows least about in catalog order, so without this step a new
 * account would meet this one last.
 */
async function standoutToTest(
  ctx: Reader,
  account: Doc<'accounts'>,
  experiments: readonly Doc<'experiments'>[],
  now: number
): Promise<string | null> {
  if (experiments.some((experiment) => experiment.status === 'running')) return null
  const testedLately = (experiment: Doc<'experiments'>) =>
    experiment.kind === 'post_model' && (experiment.decision?.decidedAt ?? experiment.createdAt) >= now - EXPERIMENT_MEMORY_MS
  if (experiments.some(testedLately)) return null
  const [first] = (await whatWorked(ctx, account)).standouts
  if (first === undefined) return null
  if ((await readableMetrics(ctx, account, 'post_model')).metrics.length === 0) return null
  return first.thread.title
}

/**
 * The draft a new account starts with, while nothing of it went out yet: a
 * reply, as replies go stale soonest, else the post due soonest; null when
 * none waits.
 */
async function firstDraftOf(ctx: Reader, account: Doc<'accounts'>, replyDrafts: number): Promise<FirstDraft | null> {
  if (await wentOutYet(ctx, account._id)) return null
  if (replyDrafts > 0) return { kind: 'reply' }
  const posts = await ctx.db
    .query('posts')
    .withIndex('by_account_status', (q) => q.eq('accountId', account._id).eq('status', 'draft'))
    .collect()
  const [soonest] = posts.sort((a, b) => a.scheduledAt - b.scheduledAt)
  return soonest === undefined ? null : { kind: 'post', postId: soonest._id }
}

/**
 * The account's replies in their measurement window whose reach grew between
 * their last two reads by at least TAKING_OFF_MIN and at least doubled: a
 * thread the operator took part in that is taking off.
 */
async function takingOff(ctx: Reader, account: Doc<'accounts'>): Promise<NextStepsInput['takingOff']> {
  const out: NextStepsInput['takingOff'] = []
  for (const reply of await repliesWithStatus(ctx, account._id, 'posted')) {
    const numbers = reply.numbers
    if (numbers?.before === undefined) continue
    const before = reachOf(numbers.before) ?? 0
    const reach = reachOf(numbers.counts) ?? 0
    const grew = reach - before
    if (grew >= TAKING_OFF_MIN && reach >= 2 * before) out.push({ account, reply, reach, grew })
  }
  return out
}

function counted(count: number, one: string, many: string): string {
  return `${grouped(count)} ${count === 1 ? one : many}`
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1)
}
