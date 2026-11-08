import { v } from 'convex/values'
import { placeOf, postsToMetCommunity, signalFreshness, type SignalStatus } from '@influstep/shared'
import type { Doc } from '../_generated/dataModel'
import { mutation, query, type QueryCtx } from '../_generated/server'
import { createIdea } from '../core/posts'
import { refusal } from '../lib/errors'
import { activeCommunities, communitiesOf } from '../core/communities'
import { planWaits, PILLAR_HISTORY_DAYS, pillarFor, placePost, signalConcept, communitiesFor, type PlannerCommunity } from '../core/planner'
import { addDays, dayKey } from '../core/dates'
import { sponsorSegmentValidator } from '../lib/validators'
import { accountRefOf } from '../core/accounts'

/** How many signals the Signals page lists: the freshest, so the page never hides one fresher than a row it shows. */
const LIST_LIMIT = 200

/** The statuses the Signals page lists: a dismissed signal is gone from it. */
const LISTED_STATUSES = ['new', 'used'] as const satisfies readonly SignalStatus[]

/**
 * The Signals page: the account's signals, or every account's, that were not
 * dismissed, freshest first (shared `signalFreshness`, the rank the planner
 * and the last check use), newest found first among equals. Ranked before the
 * cut, so a signal found again this hour, whose first find is days old, is
 * listed by how fresh it is now.
 */
export const list = query({
  args: { accountId: v.optional(v.id('accounts')) },
  handler: async (ctx, args) => {
    const accounts = await ctx.db.query('accounts').collect()
    const listed = args.accountId === undefined ? accounts : accounts.filter((account) => account._id === args.accountId)
    const signals: Doc<'signals'>[] = []
    for (const account of listed) {
      for (const status of LISTED_STATUSES) {
        signals.push(
          ...(await ctx.db
            .query('signals')
            .withIndex('by_account_status', (q) => q.eq('accountId', account._id).eq('status', status))
            .collect())
        )
      }
    }
    const now = Date.now()
    return signals
      .map((signal) => ({ signal, freshness: signalFreshness(signal, now) }))
      .sort((a, b) => b.freshness - a.freshness || b.signal.foundAt - a.signal.foundAt)
      .slice(0, LIST_LIMIT)
      .map(({ signal }) => {
        const account = listed.find((candidate) => candidate._id === signal.accountId)
        if (!account) throw new Error(`signal ${signal._id} was read for account ${signal.accountId}, which is not listed`)
        return { ...signal, account: accountRefOf(account) }
      })
  },
})

export const dismiss = mutation({
  args: { signalId: v.id('signals') },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.signalId, { status: 'dismissed' })
  },
})

/** One click from a signal to an idea at the day's first slot, a text post when the cadence has them; the writer picks it up the day before it is due (core `queueWriteIfDue`). */
export const makePost = mutation({
  args: { signalId: v.id('signals'), plannedFor: v.string(), sponsorSegment: v.optional(sponsorSegmentValidator) },
  handler: async (ctx, args) => {
    const signal = await ctx.db.get(args.signalId)
    if (!signal) throw new Error('signal not found')
    const account = await ctx.db.get(signal.accountId)
    if (!account) throw new Error('account not found')
    // assertFormat keeps every cadence's kinds and intents non-empty, so a missing one is a bug.
    const [intent] = account.cadence.intents
    if (intent === undefined) throw new Error(`account ${account._id} has an X cadence without intents`)
    // A text post when the cadence has them, else a thread on X; a thread is always long (core/posts.ts) and X's alone.
    const kind = account.platform === 'x' && !account.cadence.kinds.includes('text') ? 'thread' : 'text'
    const shape = { intent, kind, length: kind === 'thread' ? 'long' : 'medium' } as const
    const placed = placePost({
      platform: account.platform,
      shape,
      sponsorWanted: (args.sponsorSegment ?? 'none') !== 'none',
      met: postsToMetCommunity(account.platform) ? await metCommunityOf(ctx, account) : null,
    })
    return createIdea(ctx, account, {
      ...shape,
      intent: placed.intent,
      publishHour: account.publishHour,
      plannedFor: args.plannedFor,
      concept: signalConcept(signal.title),
      pillar: pillarFor(signal.topics, account.pillars),
      ...(placed.community === null ? {} : { community: placed.community }),
      sponsorSegment: placed.sponsorSegment,
      signalIds: [signal._id],
    })
  },
})

/**
 * The community one more Reddit or forum post goes to, by the planner's rule
 * (core `communitiesFor`); refused while the account plans no post (core `planWaits`).
 */
async function metCommunityOf(ctx: QueryCtx, account: Doc<'accounts'>): Promise<PlannerCommunity> {
  const all = await communitiesOf(ctx, account._id)
  const waits = planWaits(placeOf(account), all)
  if (waits !== null) throw refusal(waits)
  const communities = activeCommunities(all)
  const posts = await ctx.db
    .query('posts')
    .withIndex('by_account', (q) => q.eq('accountId', account._id))
    .collect()
  const since = addDays(dayKey(Date.now(), account.timezone), -PILLAR_HISTORY_DAYS)
  const [met] = communitiesFor(
    communities.map(({ name, selfPromotion, weight }) => ({ name, selfPromotion, weight })),
    posts,
    1,
    since
  )
  if (!met) throw new Error('the planner allocated no community')
  return met
}
