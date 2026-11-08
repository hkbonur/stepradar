import { asksSomething, isThreadSource, namesSponsor, placeLabel, placeOf, postedItemOf, roundupOf, standouts } from '@influstep/shared'
import type { Doc } from '../_generated/dataModel'
import type { QueryCtx } from '../_generated/server'
import type { BasisThread } from '../lib/validators'
import { matchedPillar, pillarFor, type PlannerRework, type PlannerRoundup, type PlannerStandout } from './planner'
import { WHAT_WORKS_DAYS, measuredPostsSince } from './report'
import { workspaceOf } from './workspace'

/**
 * What worked in the account's niche, as the planner draws on it (shared
 * what-worked.ts): the standouts among the threads the researcher found and
 * nobody used yet, and the round-up its questions make. A question a round-up
 * takes is no standout of the same plan. A thread that names the sponsor is
 * one to answer, never to draw a post from: a post modeled on "has anyone
 * tried <the sponsor>?" would be a planted question (docs/plan.md, ground
 * rule 5), and a round-up the dial leaves without the sponsor could not
 * answer it.
 */

type Reader = { db: QueryCtx['db'] }

export async function whatWorked(
  ctx: Reader,
  account: Doc<'accounts'>
): Promise<{ standouts: PlannerStandout[]; roundup: PlannerRoundup | null }> {
  const { sponsorName } = await workspaceOf(ctx, account)
  const threads = (
    await ctx.db
      .query('signals')
      .withIndex('by_account_status', (q) => q.eq('accountId', account._id).eq('status', 'new'))
      .collect()
  ).filter((signal) => isThreadSource(signal.source) && !namesSponsor(`${signal.title}\n${signal.summary}`, sponsorName))
  // A round-up is about a pillar its questions name; a question found by the niche alone names none.
  const asked = threads.flatMap((signal) => {
    const pillar = asksSomething(signal.title) ? matchedPillar(signal.topics, account.pillars) : null
    return pillar === null ? [] : [{ signal, pillar, score: signal.score }]
  })
  const roundup = roundupOf(asked)
  const rounded = new Set(roundup?.questions.map(({ signal }) => signal._id))
  return {
    standouts: standouts(threads)
      .filter((signal) => !rounded.has(signal._id))
      .map((signal) => ({ thread: threadOf(signal), pillar: pillarFor(signal.topics, account.pillars) })),
    roundup:
      roundup === null
        ? null
        : { kind: 'roundup', pillar: roundup.pillar, questions: roundup.questions.map(({ signal }) => threadOf(signal)) },
  }
}

/** A signal as a post keeps the thread it is drawn from. */
function threadOf(signal: Doc<'signals'>): BasisThread {
  return { signalId: signal._id, title: signal.title, summary: signal.summary, url: signal.url }
}

const DAY_MS = 86_400_000

/**
 * The post of another of the operator's accounts, on another platform, that
 * brought the most users in the last WHAT_WORKS_DAYS: the most paid, then
 * the most signups, one at least. Never a post that was itself reworked from
 * another, nor one this account reworked already. Null when none brought any.
 */
export async function bestToRework(ctx: Reader, account: Doc<'accounts'>, now: number): Promise<PlannerRework | null> {
  const since = now - WHAT_WORKS_DAYS * DAY_MS
  const reworked = new Set(
    (
      await ctx.db
        .query('posts')
        .withIndex('by_account', (q) => q.eq('accountId', account._id))
        .collect()
    ).flatMap((post) => (post.basis?.kind === 'rework' ? [post.basis.post.postId] : []))
  )
  const others = (await ctx.db.query('accounts').collect()).filter(
    (other) => other.workspaceId === account.workspaceId && other.platform !== account.platform
  )
  let best: { post: Doc<'posts'>; from: Doc<'accounts'>; paid: number; signups: number } | null = null
  for (const other of others) {
    const conversions = await ctx.db
      .query('conversions')
      .withIndex('by_account_time', (q) => q.eq('accountId', other._id).gte('at', since))
      .collect()
    const measured = await ctx.db
      .query('posts')
      .withIndex('by_account_status', (q) => q.eq('accountId', other._id).eq('status', 'measured'))
      .collect()
    for (const post of measuredPostsSince(measured, since)) {
      if (post.basis?.kind === 'rework' || reworked.has(post._id)) continue
      const count = (kind: 'signup' | 'paid') =>
        conversions.filter((conversion) => conversion.postId === post._id && conversion.kind === kind).length
      const paid = count('paid')
      const signups = count('signup')
      if (paid + signups === 0) continue
      if (best === null || paid > best.paid || (paid === best.paid && signups > best.signups)) best = { post, from: other, paid, signups }
    }
  }
  if (best === null) return null
  const { post, from } = best
  const { sponsorName } = await workspaceOf(ctx, account)
  return {
    kind: 'rework',
    post: {
      postId: post._id,
      placeName: placeLabel(placeOf(from)),
      title: post.title,
      text: withoutSponsor((post.parts ?? []).join('\n\n'), sponsorName),
      url: postedItemOf(post.posted)?.url ?? null,
    },
  }
}

/**
 * A post's words without what made it the other account's sponsored post:
 * every link, and every sentence that names the sponsor (its mention and
 * the other account's affiliation line). The reworked post names the
 * sponsor only as its own slot allows, with its own line and link.
 */
function withoutSponsor(text: string, sponsorName: string): string {
  return text
    .split('\n')
    .map((line) =>
      line
        .split(/(?<=[.!?])\s+/)
        .filter((sentence) => !namesSponsor(sentence, sponsorName))
        .join(' ')
        .replace(/https?:\/\/\S+/g, '')
        .trim()
    )
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
