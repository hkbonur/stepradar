import { isWebUrl, sponsorProblems } from '@influstep/shared'
import { v } from 'convex/values'
import { mutation, query } from '../_generated/server'
import { requireWorkspace } from '../core/workspace'
import { refusal } from '../lib/errors'

/**
 * The operator's workspace: the product the accounts promote, where tracked
 * links go, and what one paid conversion is worth so the report can put a
 * value on a post. One workspace today; the studio's first-run setup
 * creates it.
 */

const sponsorArgs = {
  sponsorName: v.string(),
  sponsorUrl: v.string(),
  sponsorPitch: v.string(),
  valuePerPaid: v.number(),
  currency: v.string(),
}

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

/** The product's fields, trimmed, refused with the shared words the studio already showed. */
function checked(args: { sponsorName: string; sponsorUrl: string; sponsorPitch: string; valuePerPaid: number; currency: string }) {
  const [problem] = sponsorProblems(args)
  if (problem !== undefined) throw refusal(problem.message)
  return {
    sponsorName: args.sponsorName.trim(),
    sponsorUrl: args.sponsorUrl.trim(),
    sponsorPitch: args.sponsorPitch.trim(),
    valuePerPaid: args.valuePerPaid,
    currency: args.currency,
  }
}

/** Tracked links are built from it, so a bad one would break at click time; refuse it here instead. */
function appUrlOf(raw: string): string {
  const value = raw.trim()
  if (!isWebUrl(value)) throw refusal('The app URL must be a full address, such as https://studio.example.com.')
  return value.replace(/\/+$/, '')
}
