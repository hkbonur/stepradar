import { LAUNCH_WHAT_MAX, MET_COMMUNITY_NOUNS, handleOf, placeOf, postsToMetCommunity, shortDayLabel } from '@influstep/shared'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'
import { refusal } from '../lib/errors'
import { accountRefOf, activeAccounts, type AccountRef } from './accounts'
import { activeCommunities, communitiesOf } from './communities'
import { hourAt, instantAt } from './dates'
import { placePost, planWaits } from './planner'
import { createIdea, killPost } from './posts'

/**
 * A launch (CONTEXT.md, "Launch"): when the sponsor ships something, every
 * account announces it on the day the operator picks, each in its platform's
 * shape and place, naming the sponsor with its affiliation line. On Hacker
 * News it is a Show HN; on Reddit and a forum it goes only to a community the
 * listener met whose rules allow self-promotion. An account where it cannot
 * go is left out, with why.
 */

/** What became of one account's launch post. */
export type LaunchOutcome = { account: AccountRef } & ({ kind: 'planned'; postId: Id<'posts'> } | { kind: 'left out'; why: string })

export async function planLaunch(ctx: MutationCtx, args: { day: string; what: string; now: number }): Promise<LaunchOutcome[]> {
  const what = args.what.trim()
  if (what === '') throw refusal('Say what shipped, in a line.')
  if (what.length > LAUNCH_WHAT_MAX) throw refusal(`Say what shipped in at most ${LAUNCH_WHAT_MAX} characters.`)
  const accounts = await activeAccounts(ctx)
  if (accounts.length === 0) throw refusal('No account is working to announce it.')
  const outcomes: LaunchOutcome[] = []
  for (const account of accounts) {
    const placed = await launchPlace(ctx, account, args.day, args.now)
    if (placed.kind === 'left out') {
      outcomes.push({ account: accountRefOf(account), kind: 'left out', why: placed.why })
      continue
    }
    // The launch takes the day's unwritten idea's place and hour, so the day keeps one post at that hour.
    if (placed.replaces !== null) await killPost(ctx, placed.replaces._id)
    const postId = await createIdea(ctx, account, {
      ...placed.shape,
      intent: 'show',
      plannedFor: args.day,
      publishHour: placed.replaces === null ? account.publishHour : hourAt(placed.replaces.scheduledAt, account.timezone),
      concept: `Launch: ${what}`,
      ...(account.pillars[0] === undefined ? {} : { pillar: account.pillars[0] }),
      ...(placed.community === null ? {} : { community: placed.community }),
      sponsorSegment: 'mention',
      signalIds: [],
      basis: { kind: 'launch', what },
    })
    outcomes.push({ account: accountRefOf(account), kind: 'planned', postId })
  }
  return outcomes
}

type LaunchPlace =
  | {
      kind: 'placed'
      shape: { kind: 'text' | 'thread'; length: 'medium' | 'long' }
      community: string | null
      /** The day's unwritten idea the launch takes the place of, or null when the day holds none. */
      replaces: Doc<'posts'> | null
    }
  | { kind: 'left out'; why: string }

/**
 * Where the account's launch post goes, in what shape and in place of which
 * idea, or why it has no place to go: an account whose sponsor dial is 0
 * never names the product, and a day that holds the account's launch or a
 * written post keeps it. A launch is the operator's own call, so a new
 * account's unsponsored ramp does not hold it back.
 */
async function launchPlace(ctx: MutationCtx, account: Doc<'accounts'>, day: string, now: number): Promise<LaunchPlace> {
  if (account.sponsorDial === 0) return { kind: 'left out', why: 'Its sponsor dial is 0, so it never names the product.' }
  const live = (
    await ctx.db
      .query('posts')
      .withIndex('by_account_day', (q) => q.eq('accountId', account._id).eq('plannedFor', day))
      .collect()
  )
    .filter((post) => post.status !== 'killed' && post.status !== 'skipped')
    .sort((a, b) => a.scheduledAt - b.scheduledAt)
  if (live.some((post) => post.basis?.kind === 'launch'))
    return { kind: 'left out', why: `${shortDayLabel(day)} already holds its launch.` }
  const written = live.find((post) => post.status !== 'idea')
  if (written !== undefined)
    return { kind: 'left out', why: `${shortDayLabel(day)} already holds "${written.title}", written; move it first.` }
  const replaces = live[0] ?? null
  const hour = replaces === null ? account.publishHour : hourAt(replaces.scheduledAt, account.timezone)
  if (instantAt(day, hour, account.timezone) <= now)
    return { kind: 'left out', why: `Its posting hour on ${shortDayLabel(day)} has passed.` }
  const communities = await communitiesOf(ctx, account._id)
  const waits = planWaits(placeOf(account), communities)
  if (waits !== null) return { kind: 'left out', why: waits }
  // On X a launch is a thread where the cadence has threads; everywhere else a full post.
  const shape: Extract<LaunchPlace, { kind: 'placed' }>['shape'] =
    account.platform === 'x' && account.cadence.kinds.includes('thread')
      ? { kind: 'thread', length: 'long' }
      : { kind: 'text', length: 'medium' }
  const [allowed] = activeCommunities(communities)
    .filter((community) => community.selfPromotion === 'allowed')
    .sort((a, b) => b.weight - a.weight)
  if (postsToMetCommunity(account.platform) && allowed === undefined) {
    return {
      kind: 'left out',
      why: `No ${MET_COMMUNITY_NOUNS[account.platform].one} ${handleOf(account)} met allows self-promotion, so a launch there would break its rules.`,
    }
  }
  const met = allowed === undefined ? null : { name: allowed.name, selfPromotion: allowed.selfPromotion, weight: allowed.weight }
  const placed = placePost({ platform: account.platform, shape: { ...shape, intent: 'show' }, sponsorWanted: true, met })
  // A show of full length, where a community allows self-promotion or none is needed, always carries the sponsor.
  if (placed.sponsorSegment !== 'mention') throw new Error(`a launch on ${account._id} was placed without the sponsor`)
  return { kind: 'placed', shape, community: placed.community, replaces }
}
