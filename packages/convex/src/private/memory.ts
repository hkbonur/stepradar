import { v } from 'convex/values'
import type { Id } from '../_generated/dataModel'
import { mutation, query } from '../_generated/server'
import { memoryView, rememberFromOperator, retireMemory } from '../core/memory'
import { refusal } from '../lib/errors'
import { operatorMemoryKindValidator } from '../lib/validators'

/** What the memory page reads: every entry of the account with what its evidence names. */
export const list = query({
  args: { accountId: v.id('accounts') },
  handler: async (ctx, args) => {
    const account = await ctx.db.get(args.accountId)
    if (!account) return null
    return memoryView(ctx, account)
  },
})

/** The operator adds a fact or a rule on the memory page; the chat adds one through core/chat.ts. */
export const add = mutation({
  args: { accountId: v.id('accounts'), kind: operatorMemoryKindValidator, text: v.string() },
  handler: async (ctx, args): Promise<Id<'memories'>> => {
    const account = await ctx.db.get(args.accountId)
    if (!account) throw new Error(`account ${args.accountId} not found`)
    const outcome = await rememberFromOperator(ctx, account, { kind: args.kind, text: args.text, now: Date.now() })
    switch (outcome.status) {
      case 'invalid':
        throw refusal(outcome.problem)
      case 'known':
        throw refusal(`${account.name} already remembers that: "${outcome.text}"`)
      case 'stored':
        return outcome.memoryId
    }
  },
})

/** Forget a fact or a rule, or mark a problem resolved. The entry stays on the page, retired. */
export const retire = mutation({
  args: { memoryId: v.id('memories') },
  handler: async (ctx, args): Promise<void> => {
    await retireMemory(ctx, args.memoryId, Date.now())
  },
})
