import { v } from 'convex/values'
import {
  SPONSOR_RAMP_POSTS,
  forumAddress,
  identityProblems,
  namedAccountProblems,
  placeLabel,
  placeOf,
  proposalProblems,
  type AccountIdentity,
  type AccountProposal,
  type Forum,
} from '@influstep/shared'
import type { Infer } from 'convex/values'
import { internal } from '../_generated/api'
import type { Doc, Id } from '../_generated/dataModel'
import { action, internalQuery, mutation, query, type QueryCtx } from '../_generated/server'
import { createAccount, planTwoWeeks, accountRefOf } from '../core/accounts'
import { requireWorkspace } from '../core/workspace'
import { refusal } from '../lib/errors'
import { formatFields, forumValidator, platformValidator } from '../lib/validators'
import { llmProvider } from '../providers/llm'
import { forumAt } from '../providers/platforms'

/**
 * Onboarding: the flow that adds the operator's own accounts on the first run
 * and one at a time after it. The operator names the account; the writer
 * proposes how it sounds from its niche and audience; the operator edits it
 * in place, sets the cadence, the sponsor dial and the hour, and creating it
 * plans its first weeks.
 */

/** The product a proposal names and the roster so far. The first-run setup made the workspace before any account. */
async function rosterOf(ctx: QueryCtx): Promise<{ sponsorName: string; sponsorPitch: string; accounts: Doc<'accounts'>[] }> {
  const workspace = await requireWorkspace(ctx)
  return { sponsorName: workspace.sponsorName, sponsorPitch: workspace.sponsorPitch, accounts: await ctx.db.query('accounts').collect() }
}

/**
 * What the flow starts from: the roster so far, its names and handles, and
 * the product a proposal names; null before the first-run setup, which the
 * studio sends the operator to.
 */
export const start = query({
  args: {},
  handler: async (ctx) => {
    if (!(await ctx.db.query('workspaces').first())) return null
    const { sponsorName, accounts } = await rosterOf(ctx)
    return {
      sponsorName,
      roster: accounts.map(accountRefOf),
    }
  },
})

/** What the writer reads before it proposes: the product, and the roster it must not repeat. */
export const proposalContext = internalQuery({
  args: {},
  handler: async (ctx) => {
    const { sponsorName, sponsorPitch, accounts } = await rosterOf(ctx)
    return {
      sponsorName,
      sponsorPitch,
      roster: accounts.map((account) => ({ ...placeOf(account), name: account.name, handle: account.handle, niche: account.niche })),
    }
  },
})

/** The account as the operator names it: what a proposal starts from and what creating it checks again. On a forum, the forum `checkForum` found. */
const identityFields = {
  platform: platformValidator,
  forum: v.optional(forumValidator),
  handle: v.string(),
  name: v.string(),
  niche: v.string(),
  audience: v.string(),
}

const identityValidator = v.object(identityFields)

/** The identity the args name, its place read as a row's (shared `placeOf`); a forum's origin is its address as the operator gave it. */
function identityOf(args: Infer<typeof identityValidator>): AccountIdentity {
  if (args.platform === 'forum' && args.forum === undefined) throw refusal('Give the forum’s address, and Influstep finds the forum there.')
  if (args.forum !== undefined) {
    const address = forumAddress(args.forum.origin)
    if (address.kind === 'invalid' || address.origin !== args.forum.origin) throw refusal(`${args.forum.origin} is no forum's address.`)
  }
  return { ...placeOf(args), handle: args.handle, name: args.name, niche: args.niche, audience: args.audience }
}

/**
 * The forum at the address the operator gives (any of its pages will do):
 * its origin, its name, and whether Influstep reads it or the operator
 * pastes its links by hand (providers/platforms `forumAt`).
 */
export const checkForum = action({
  args: { address: v.string() },
  handler: async (_ctx, args): Promise<Forum> => {
    const address = forumAddress(args.address)
    if (address.kind === 'invalid') throw refusal(address.problem)
    return forumAt(address.origin)
  },
})

/**
 * The writer's proposal for the account the operator names. Nothing is
 * stored: the operator edits it and creates the account. A handle another
 * account has, or one its platform does not allow, is refused before the
 * writer reads anything.
 */
export const propose = action({
  args: identityFields,
  handler: async (ctx, args): Promise<AccountProposal> => {
    const context = await ctx.runQuery(internal.private.onboarding.proposalContext, {})
    const identity = identityOf(args)
    const problems = namedAccountProblems(identity, context.roster)
    if (problems.length > 0) throw refusal(problems.join(' '))
    return llmProvider().proposeAccount({
      platform: identity.platform,
      placeName: placeLabel(identity),
      name: args.name.trim(),
      niche: args.niche.trim(),
      audience: args.audience.trim(),
      ...context,
    })
  },
})

/** Creates one account of the flow and plans its first weeks, in the workspace the first-run setup made. */
export const create = mutation({
  args: {
    ...identityFields,
    tone: v.string(),
    pillars: v.array(v.string()),
    bio: v.string(),
    bible: v.string(),
    affiliationLine: v.string(),
    ...formatFields,
    sponsorDial: v.number(),
    timezone: v.string(),
  },
  handler: async (ctx, args): Promise<Id<'accounts'>> => {
    const workspace = await requireWorkspace(ctx)
    // A taken handle is refused where every account is created (core/accounts.ts `createAccount`).
    const problems = [...identityProblems(identityOf(args)), ...proposalProblems(args, workspace.sponsorName)]
    if (problems.length > 0) throw refusal(problems.join(' '))
    if (!(args.sponsorDial >= 0 && args.sponsorDial <= 1)) throw refusal('The sponsor dial is between 0 and 1.')
    const account = await createAccount(ctx, workspace, {
      ...args,
      name: args.name.trim(),
      niche: args.niche.trim(),
      audience: args.audience.trim(),
      tone: args.tone.trim(),
      bio: args.bio.trim(),
      bible: args.bible.trim(),
      affiliationLine: args.affiliationLine.trim(),
      sponsorRampPosts: SPONSOR_RAMP_POSTS,
    })
    await planTwoWeeks(ctx, account, Date.now())
    return account._id
  },
})
