import { providerKeyProblem } from '@stepradar/shared'
import { v } from 'convex/values'
import { mutation } from '../_generated/server'
import { refusal } from '../lib/errors'
import { providerKeyValidator } from '../lib/validators'

/**
 * The operator's provider keys (ADR 0005): set or replaced from the setup
 * and the Providers page, and removed. Write-only: no function the studio
 * calls returns a key; the Providers page's status shows each one's last
 * characters (core/keys.ts `keyStatuses`).
 */

export const set = mutation({
  args: { name: providerKeyValidator, value: v.string() },
  handler: async (ctx, args) => {
    const problem = providerKeyProblem(args.name, args.value)
    if (problem !== null) throw refusal(problem)
    const value = args.value.trim()
    const existing = await ctx.db
      .query('providerKeys')
      .withIndex('by_name', (q) => q.eq('name', args.name))
      .first()
    if (existing === null) await ctx.db.insert('providerKeys', { name: args.name, value, setAt: Date.now() })
    else await ctx.db.patch(existing._id, { value, setAt: Date.now() })
  },
})

export const remove = mutation({
  args: { name: providerKeyValidator },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('providerKeys')
      .withIndex('by_name', (q) => q.eq('name', args.name))
      .first()
    if (existing !== null) await ctx.db.delete(existing._id)
  },
})
