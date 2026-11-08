import { COMMUNITY_RULES_TTL_MS, communityLabel, handleOf, postedItemOf, postsToMetCommunity, type SelfPromotion } from '@influstep/shared'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'

type Reader = { db: QueryCtx['db'] }

/** The account's communities, by name. */
export async function communitiesOf(ctx: Reader, accountId: Id<'accounts'>): Promise<Doc<'communities'>[]> {
  return ctx.db
    .query('communities')
    .withIndex('by_account_name', (q) => q.eq('accountId', accountId))
    .collect()
}

/** Whether two names are one community: a subreddit's name has no case (r/N8N is r/n8n). */
export function sameCommunity(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

/** The communities among `names` whose rules were never read, or not within the week. */
export async function communitiesToRead(ctx: Reader, accountId: Id<'accounts'>, names: string[], now: number): Promise<string[]> {
  const known = await communitiesOf(ctx, accountId)
  return names.filter((name) => {
    const community = known.find((candidate) => sameCommunity(candidate.name, name))
    return community === undefined || now - community.rulesReadAt > COMMUNITY_RULES_TTL_MS
  })
}

/** A community's rules as just read, and what they say of self-promotion; met for the first time, it weighs 1. */
export async function storeCommunityRules(
  ctx: MutationCtx,
  accountId: Id<'accounts'>,
  read: { name: string; rulesText: string; selfPromotion: SelfPromotion; reason: string },
  now: number
): Promise<void> {
  const existing = (await communitiesOf(ctx, accountId)).find((community) => sameCommunity(community.name, read.name))
  if (existing) {
    await ctx.db.patch(existing._id, {
      rulesText: read.rulesText,
      selfPromotion: read.selfPromotion,
      reason: read.reason,
      rulesReadAt: now,
    })
    return
  }
  await ctx.db.insert('communities', { accountId, ...read, weight: 1, rulesReadAt: now })
}

/** The communities the account takes part in: the ones it met that have not removed one of its items, or that the operator looked at since. */
export function activeCommunities<C extends { removedAt?: number }>(communities: readonly C[]): C[] {
  return communities.filter((community) => community.removedAt === undefined)
}

/** How many of the account's communities its search keeps to at most, the heaviest first. */
const SEARCHED_COMMUNITIES_MAX = 10

/** The communities the account's Reddit or forum search keeps to: the ones it takes part in, weighted above zero, the heaviest first. */
export function searchedCommunities(communities: readonly Doc<'communities'>[]): string[] {
  return activeCommunities(communities)
    .filter((community) => community.weight > 0)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, SEARCHED_COMMUNITIES_MAX)
    .map((community) => community.name)
}

/**
 * A sweep's threads when the account has communities of its own to keep to
 * (`searchedCommunities`): half from those and the rest from everywhere, so
 * it still meets new ones; what one half lacks the other fills, and a thread
 * found by both counts once, as its own community's.
 */
export function mixSweep<T extends { externalId: string }>(inOwn: readonly T[], everywhere: readonly T[], limit: number): T[] {
  const elsewhere = everywhere.filter((thread) => !inOwn.some((found) => found.externalId === thread.externalId))
  const ownShare = Math.max(Math.ceil(limit / 2), limit - elsewhere.length)
  return [...inOwn.slice(0, ownShare), ...elsewhere].slice(0, limit)
}

/** What a removal is said of: a post or a reply. */
type RemovedItem = { kind: 'post'; row: Doc<'posts'> } | { kind: 'reply'; row: Doc<'replies'> }

/**
 * A community removed one of the account's items, as its reader read it
 * (CONTEXT.md, "Community"): the analyst reads the item no more, and the
 * community is left out, by the planner on Reddit and forums, where posts go by
 * community, and by the listener everywhere, until the operator ticks off
 * the checklist item that asks them to look (`lookedAt`). Once per item.
 */
export async function recordRemoval(ctx: MutationCtx, account: Doc<'accounts'>, item: RemovedItem, now: number): Promise<void> {
  if (item.row.removedAt !== undefined) return
  await ctx.db.patch(item.row._id, { removedAt: now })
  const name = item.kind === 'post' ? item.row.community : item.row.thread.community
  if (name === undefined || name === null) return
  const community = (await communitiesOf(ctx, account._id)).find((candidate) => sameCommunity(candidate.name, name))
  const label = communityLabel(account.platform, name)
  const what = item.kind === 'post' ? 'post' : 'reply'
  const leftOut = postsToMetCommunity(account.platform) ? 'no more posts or replies' : 'no more replies'
  if (community !== undefined && community.removedAt === undefined) {
    await ctx.db.patch(community._id, { removedAt: now })
    await ctx.db.insert('journal', {
      accountId: account._id,
      kind: 'community_weights',
      actor: 'analyst',
      text: `${label} gets ${leftOut} until you look.`,
      reason: `${label} removed a ${what} of ${handleOf(account)}.`,
      evidence: { postIds: item.kind === 'post' ? [item.row._id] : [], signalIds: [], numbers: [] },
      createdAt: now,
    })
  }
  const removedUrl = postedItemOf(item.row.posted)?.url
  await ctx.db.insert('checklistItems', {
    accountId: account._id,
    ...(item.kind === 'post' ? { postId: item.row._id } : {}),
    ...(community === undefined ? {} : { communityId: community._id }),
    title: `Look at why ${label} removed your ${what}`,
    why: `${label} gets ${leftOut} until you tick this off. Read its rules again, and if the removal was a mistake, ask its moderators.`,
    status: 'open',
    ...(removedUrl === undefined ? {} : { action: { kind: 'visit' as const, url: removedUrl } }),
    createdAt: now,
  })
}

/** The operator looked at a community that removed one of the account's items: the plan and the listener take it back. */
export async function lookedAt(ctx: MutationCtx, communityId: Id<'communities'>): Promise<void> {
  await ctx.db.patch(communityId, { removedAt: undefined })
}
