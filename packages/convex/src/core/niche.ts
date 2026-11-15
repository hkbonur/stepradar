import { asksSomething, isThreadSource, namesSponsor, roundupOf, standouts } from '@stepradar/shared'
import type { Doc } from '../_generated/dataModel'
import type { QueryCtx } from '../_generated/server'
import type { BasisThread } from '../lib/validators'
import { matchedPillar, pillarFor, type PlannerRoundup, type PlannerStandout } from './planner'
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
