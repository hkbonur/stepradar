import {
  isWebUrl,
  sponsorProductProblems,
  sponsorProfileProblems,
  tidySponsorProfile,
  type ProfileProposal,
  type SponsorFields,
  type SponsorProblem,
  type SponsorProduct,
} from '@stepradar/shared'
import { v } from 'convex/values'
import { internal } from '../_generated/api'
import { action, mutation, query } from '../_generated/server'
import { requireWorkspace } from '../core/workspace'
import { refusal } from '../lib/errors'
import { sponsorProfileValidator } from '../lib/validators'
import { llmProvider } from '../providers/llm'
import { siteProvider } from '../providers/site'

/**
 * The operator's workspace: the product the accounts promote and where
 * tracked links go. One workspace today; the studio's first-run setup
 * creates it.
 */

const productArgs = {
  sponsorName: v.string(),
  sponsorUrl: v.string(),
  sponsorPitch: v.string(),
}

const sponsorArgs = { ...productArgs, sponsorProfile: sponsorProfileValidator }

/** The workspace; null before the first-run setup made it. */
export const get = query({
  args: {},
  handler: async (ctx) => ctx.db.query('workspaces').first(),
})

/** The first-run setup: the product, and the studio's own origin for tracked links. */
export const create = mutation({
  args: { ...sponsorArgs, appUrl: v.string() },
  handler: async (ctx, args) => {
    if (await ctx.db.query('workspaces').first()) throw refusal('Your product is already set up. Change it on the Providers page.')
    const fields = checked(args)
    return ctx.db.insert('workspaces', {
      name: fields.sponsorName,
      ...fields,
      appUrl: appUrlOf(args.appUrl),
    })
  },
})

export const update = mutation({
  args: { ...sponsorArgs, appUrl: v.string() },
  handler: async (ctx, args) => {
    const workspace = await requireWorkspace(ctx)
    const fields = checked(args)
    await ctx.db.patch(workspace._id, { ...fields, appUrl: appUrlOf(args.appUrl) })
  },
})

/**
 * The writer's proposal for the sponsor's profile, from the product as the
 * form has it and its website, read once. Nothing is stored: the operator
 * edits the proposal and saves the product. The setup asks before a
 * workspace exists, so the product comes as arguments.
 */
export const proposeProfile = action({
  args: productArgs,
  handler: async (ctx, args): Promise<ProfileProposal> => {
    const product = checkedProduct(args)
    const keys = await ctx.runQuery(internal.internal.keys.stored, {})
    const site = await siteProvider().read(product.sponsorUrl)
    const profile = await llmProvider(keys).proposeProfile({ ...product, page: site.read ? site.text : null })
    return { profile, site: site.read ? { read: true } : site }
  },
})

/** The product's fields, trimmed and its profile tidied, refused with the shared words the studio already showed. */
function checked(args: SponsorFields): SponsorFields {
  const product = checkedProduct(args)
  refuseFirst(sponsorProfileProblems(args.sponsorProfile, product.sponsorName))
  return { ...product, sponsorProfile: tidySponsorProfile(args.sponsorProfile) }
}

/** What the product is, trimmed: all a profile is proposed from. */
function checkedProduct(args: SponsorProduct): SponsorProduct {
  refuseFirst(sponsorProductProblems(args))
  return { sponsorName: args.sponsorName.trim(), sponsorUrl: args.sponsorUrl.trim(), sponsorPitch: args.sponsorPitch.trim() }
}

function refuseFirst([problem]: SponsorProblem[]): void {
  if (problem !== undefined) throw refusal(problem.message)
}

/** Tracked links are built from it, so a bad one would break at click time; refuse it here instead. */
function appUrlOf(raw: string): string {
  const value = raw.trim()
  if (!isWebUrl(value)) throw refusal('The app URL must be a full address, such as https://studio.example.com.')
  return value.replace(/\/+$/, '')
}
