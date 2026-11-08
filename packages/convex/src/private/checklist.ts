import { v } from 'convex/values'
import { mutation, query } from '../_generated/server'
import { accountRefOf, endsWait, planTwoWeeks } from '../core/accounts'
import { ticksOffByHand } from '@influstep/shared'
import { lookedAt } from '../core/communities'
import { refusal } from '../lib/errors'

export const list = query({
  args: {},
  handler: async (ctx) => {
    const open = await ctx.db
      .query('checklistItems')
      .withIndex('by_status', (q) => q.eq('status', 'open'))
      .collect()
    const done = await ctx.db
      .query('checklistItems')
      .withIndex('by_status', (q) => q.eq('status', 'done'))
      .order('desc')
      .take(10)
    const out = []
    for (const item of [...open, ...done]) {
      const account = await ctx.db.get(item.accountId)
      if (!account) throw new Error(`account ${item.accountId} of checklist item ${item._id} not found`)
      out.push({ ...item, account: accountRefOf(account) })
    }
    return out.sort((a, b) => (a.status === b.status ? b.createdAt - a.createdAt : a.status === 'open' ? -1 : 1))
  },
})

export const complete = mutation({
  args: { itemId: v.id('checklistItems') },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId)
    if (!item) throw new Error('checklist item not found')
    if (item.status === 'done') return
    if (!ticksOffByHand(item)) throw refusal('Connect the account to tick this off; it closes once the account is connected.')
    const now = Date.now()
    await ctx.db.patch(item._id, { status: 'done', doneAt: now })
    // A removal's item: the operator looked, so the community is taken back, and an account that had no other plans again.
    const communityId = item.communityId
    if (communityId === undefined) return
    const account = await ctx.db.get(item.accountId)
    if (!account) throw new Error(`account ${item.accountId} of checklist item ${item._id} not found`)
    if (await endsWait(ctx, account, () => lookedAt(ctx, communityId))) await planTwoWeeks(ctx, account, now)
  },
})
