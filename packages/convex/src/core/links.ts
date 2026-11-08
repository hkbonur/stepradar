import { BIO_CAMPAIGN, SPONSOR_LINKS, buildAttributedUrl, makeSlug, placeOf, trackedLinkUrl, utmMediumOf } from '@influstep/shared'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'

type Reader = { db: QueryCtx['db'] }

/**
 * A sponsored post's link to the sponsor (CONTEXT.md, "Tracked link"): made
 * when the writer writes the post, and kept on it as the draft carries it.
 * On X and LinkedIn it is a tracked link, one `links` row per post that the
 * worker counts and redirects with the UTM parameters (public/links.ts); on
 * Reddit and Hacker News it is the sponsor's website with them in the link
 * itself (shared SPONSOR_LINKS).
 */

/** How long a tracked link's slug is. */
const SLUG_LENGTH = 7

/** A sponsored post's link: a tracked link, with its row, or the sponsor's website with the UTM parameters in it. */
export type SponsorLink = { kind: 'tracked'; url: string; linkId: Id<'links'> } | { kind: 'direct'; url: string }

/** The link a sponsored post carries; a rewrite of the post keeps its tracked link, and the clicks it counted. */
export async function sponsorLinkOf(
  ctx: MutationCtx,
  post: Pick<Doc<'posts'>, '_id' | 'slug' | 'variantKey'>,
  account: Doc<'accounts'>,
  workspace: Doc<'workspaces'>
): Promise<SponsorLink> {
  if (SPONSOR_LINKS[account.platform].kind === 'direct') {
    const medium = utmMediumOf(placeOf(account))
    const attribution = { accountHandle: account.handle, medium, postSlug: post.slug, variantKey: post.variantKey }
    return { kind: 'direct', url: buildAttributedUrl(workspace.sponsorUrl, attribution) }
  }
  const existing = await ctx.db
    .query('links')
    .withIndex('by_post', (q) => q.eq('postId', post._id))
    .first()
  if (existing) return { kind: 'tracked', url: trackedLinkUrl(workspace.appUrl, existing.slug), linkId: existing._id }
  const slug = await freeSlug(ctx)
  const linkId = await ctx.db.insert('links', {
    kind: 'post',
    slug,
    accountId: account._id,
    postId: post._id,
    target: workspace.sponsorUrl,
    clicks: 0,
    createdAt: Date.now(),
  })
  return { kind: 'tracked', url: trackedLinkUrl(workspace.appUrl, slug), linkId }
}

/**
 * The account's bio link: the one the operator puts on the account's profile,
 * so a visit from the profile that turns into a signup counts for the
 * account. It names no post. Where the platform's posts carry tracked links
 * it is one too, a `links` row of kind bio whose clicks are counted and which
 * sends readers to the sponsor's website as it is when they click; elsewhere
 * it is the sponsor's website with the UTM parameters and `utm_campaign=bio`
 * in the link itself.
 */
export type BioLink = { kind: 'tracked'; url: string; clicks: number } | { kind: 'direct'; url: string }

/** The account's bio link, or null where it is a tracked link not made yet (`makeBioLink`). */
export async function bioLinkOf(ctx: Reader, account: Doc<'accounts'>, workspace: Doc<'workspaces'>): Promise<BioLink | null> {
  if (SPONSOR_LINKS[account.platform].kind === 'direct') {
    const attribution = { accountHandle: account.handle, medium: utmMediumOf(placeOf(account)), postSlug: BIO_CAMPAIGN }
    return { kind: 'direct', url: buildAttributedUrl(workspace.sponsorUrl, attribution) }
  }
  const link = await ctx.db
    .query('links')
    .withIndex('by_account_kind', (q) => q.eq('accountId', account._id).eq('kind', 'bio'))
    .first()
  return link === null ? null : { kind: 'tracked', url: trackedLinkUrl(workspace.appUrl, link.slug), clicks: link.clicks }
}

/** The account's bio link, made the first time it is asked for. */
export async function makeBioLink(ctx: MutationCtx, account: Doc<'accounts'>, workspace: Doc<'workspaces'>): Promise<BioLink> {
  const made = await bioLinkOf(ctx, account, workspace)
  if (made !== null) return made
  const slug = await freeSlug(ctx)
  await ctx.db.insert('links', { kind: 'bio', slug, accountId: account._id, clicks: 0, createdAt: Date.now() })
  return { kind: 'tracked', url: trackedLinkUrl(workspace.appUrl, slug), clicks: 0 }
}

/** A slug no tracked link has yet. */
async function freeSlug(ctx: MutationCtx): Promise<string> {
  for (;;) {
    const slug = makeSlug(SLUG_LENGTH)
    const taken = await ctx.db
      .query('links')
      .withIndex('by_slug', (q) => q.eq('slug', slug))
      .first()
    if (!taken) return slug
  }
}
