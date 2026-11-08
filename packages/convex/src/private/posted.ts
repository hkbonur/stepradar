import { v } from 'convex/values'
import { COMMENT_WINDOW_MS } from '@influstep/shared'
import { query } from '../_generated/server'
import { accountRefOf } from '../core/accounts'
import { accountReader } from '../core/connections'
import { itemsWithoutDraft, postedItems, postedSince } from '../core/posted'
import { workspaceOf } from '../core/workspace'
import { capabilitiesOf } from '../providers/platforms'

/**
 * The Posted page (docs/plan.md, "Studio screens"): what the account posted
 * within the comment window, newest first, each with its numbers, its edit
 * share and the comments under it, with where their answers stand. What the
 * operator posted without a draft is listed too, with no numbers. A comment
 * notification opens the page at the item the comment is under.
 */
export const forAccount = query({
  args: { accountId: v.id('accounts') },
  handler: async (ctx, args) => {
    const account = await ctx.db.get(args.accountId)
    if (!account) return null
    const workspace = await workspaceOf(ctx, account)
    const since = Date.now() - COMMENT_WINDOW_MS
    const rows = await postedSince(ctx, account._id, since)
    const conversions = await ctx.db
      .query('conversions')
      .withIndex('by_account_time', (q) => q.eq('accountId', account._id).gte('at', since))
      .collect()
    const posted = [
      ...(await postedItems(ctx, account, rows, conversions, workspace.valuePerPaid)),
      ...(await itemsWithoutDraft(ctx, account._id, since, rows)),
    ].sort((a, b) => b.postedAt - a.postedAt)
    const items = []
    for (const item of posted) {
      const parent = item.externalId
      const comments =
        parent === null
          ? []
          : await ctx.db
              .query('comments')
              .withIndex('by_account_parent', (q) => q.eq('accountId', account._id).eq('inReplyTo', parent))
              .collect()
      items.push({ item, comments: comments.sort((a, b) => a.postedAt - b.postedAt) })
    }
    return {
      account: accountRefOf(account),
      days: COMMENT_WINDOW_MS / 86_400_000,
      // Whether the account's reader reads numbers: it says why an item has none, never shows zeros.
      readsCounts: capabilitiesOf(await accountReader(ctx, account)).includes('counts'),
      items,
    }
  },
})
