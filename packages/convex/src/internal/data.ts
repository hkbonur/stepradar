import { v } from 'convex/values'
import { placeOf, type Forum } from '@influstep/shared'
import type { Doc } from '../_generated/dataModel'
import { internalMutation, internalQuery } from '../_generated/server'
import { internal } from '../_generated/api'
import { deleteHistoryPage as deleteHistoryPageRule } from '../core/history'
import { workspaceOf } from '../core/workspace'
import { readerConnectionFor } from '../core/connections'
import type { ReaderConnection } from '../providers/platforms'

/**
 * Internal reads that more than one agent module uses, and the pages of Clear
 * history the scheduler runs. A read or write only one module needs lives in
 * that module. Domain rules stay in core/.
 */

/** The workspace's forums, each once: what every niche search reads, and where a forum's visitors come from. */
export const forums = internalQuery({
  args: {},
  handler: async (ctx): Promise<Forum[]> => {
    const accounts = await ctx.db
      .query('accounts')
      .withIndex('by_platform', (q) => q.eq('platform', 'forum'))
      .collect()
    const byOrigin = new Map<string, Forum>()
    for (const account of accounts) {
      const place = placeOf(account)
      if (place.platform === 'forum') byOrigin.set(place.forum.origin, place.forum)
    }
    return [...byOrigin.values()]
  },
})

export const getAccount = internalQuery({
  args: { accountId: v.id('accounts') },
  handler: async (ctx, args): Promise<{ account: Doc<'accounts'>; workspace: Doc<'workspaces'>; connection: ReaderConnection | null }> => {
    const account = await ctx.db.get(args.accountId)
    if (!account) throw new Error(`account ${args.accountId} not found`)
    const workspace = await workspaceOf(ctx, account)
    // What the account's platform reader reads with; internal, so the grant never reaches the studio.
    return { account, workspace, connection: await readerConnectionFor(ctx, account._id) }
  },
})

/**
 * The pages of Clear history after the first (private/history.ts,
 * clearHistory): each deletes one page in its own mutation, so a history of
 * any size stays inside a mutation's write limit, and queues the next until
 * none is left.
 */
export const deleteHistoryPage = internalMutation({
  args: { accountId: v.id('accounts') },
  handler: async (ctx, args): Promise<void> => {
    const page = await deleteHistoryPageRule(ctx, args.accountId)
    if (page.more) await ctx.scheduler.runAfter(0, internal.internal.data.deleteHistoryPage, { accountId: args.accountId })
  },
})
