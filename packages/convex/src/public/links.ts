import { v } from 'convex/values'
import { BIO_CAMPAIGN, buildAttributedUrl, placeOf, utmMediumOf } from '@influstep/shared'
import type { Doc } from '../_generated/dataModel'
import { mutation, type MutationCtx } from '../_generated/server'
import { workspaceOf } from '../core/workspace'

/** Tracked links (ADR 0003). Unauthenticated: the worker calls this for every reader who clicks. */

/** Counts the click and returns where to send the reader, with UTM parameters. */
export const click = mutation({
  args: {
    slug: v.string(),
    referrer: v.optional(v.string()),
    country: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ target: string } | null> => {
    const link = await ctx.db
      .query('links')
      .withIndex('by_slug', (q) => q.eq('slug', args.slug))
      .first()
    if (!link) return null
    const account = await ctx.db.get(link.accountId)
    if (!account) return null
    const to = await clickTarget(ctx, link, account)
    if (to === null) return null
    await ctx.db.patch(link._id, { clicks: link.clicks + 1 })
    await ctx.db.insert('linkClicks', {
      linkId: link._id,
      accountId: account._id,
      postId: link.kind === 'post' ? link.postId : undefined,
      at: Date.now(),
      referrer: args.referrer,
      country: args.country,
    })
    return {
      target: buildAttributedUrl(to.url, {
        accountHandle: account.handle,
        medium: utmMediumOf(placeOf(account)),
        postSlug: to.campaign,
        variantKey: to.variantKey,
      }),
    }
  },
})

/**
 * Where a click goes before its UTM parameters: a post's link to the website
 * as it was when the post was written, under the post's slug; the bio link
 * (core/links.ts `bioLinkOf`) to the website as it is now, under the bio
 * campaign. Null when the post is gone.
 */
async function clickTarget(
  ctx: MutationCtx,
  link: Doc<'links'>,
  account: Doc<'accounts'>
): Promise<{ url: string; campaign: string; variantKey: string | undefined } | null> {
  if (link.kind === 'bio') return { url: (await workspaceOf(ctx, account)).sponsorUrl, campaign: BIO_CAMPAIGN, variantKey: undefined }
  const post = await ctx.db.get(link.postId)
  return post === null ? null : { url: link.target, campaign: post.slug, variantKey: post.variantKey }
}
