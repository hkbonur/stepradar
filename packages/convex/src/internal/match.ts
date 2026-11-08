import { v } from 'convex/values'
import { MATCH_WINDOW_MS, placeOf } from '@influstep/shared'
import { internal } from '../_generated/api'
import { internalAction, internalMutation } from '../_generated/server'
import { storeMatches, type MatchResult } from '../core/match'
import { refusal } from '../lib/errors'
import { providersMode } from '../lib/env'
import { importedPostValidator } from '../lib/validators'
import { cannotRead } from '../providers/platforms'
import { actionReader } from './connections'

/**
 * The analyst's match: it reads what the account posted within
 * MATCH_WINDOW_MS through its platform reader, then finds and stores which
 * reply or post each item came from (core/match.ts). Reading only; nothing
 * is posted.
 */
export const match = internalAction({
  args: { accountId: v.id('accounts') },
  handler: async (ctx, args): Promise<MatchResult> => {
    const accountId = args.accountId
    const { account, connection } = await ctx.runQuery(internal.internal.data.getAccount, { accountId })
    const activity = actionReader(ctx, account, connection).activity
    if (!activity) throw refusal(cannotRead(placeOf(account), 'activity'))
    const now = Date.now()
    const items = await activity({
      handle: account.handle,
      since: now - MATCH_WINDOW_MS,
      niche: account.niche,
      pillars: account.pillars,
      now,
    })
    return ctx.runMutation(internal.internal.match.store, { accountId, items, mock: providersMode() === 'mock' })
  },
})

export const store = internalMutation({
  args: { accountId: v.id('accounts'), items: v.array(importedPostValidator), mock: v.boolean() },
  handler: async (ctx, args): Promise<MatchResult> => {
    const account = await ctx.db.get(args.accountId)
    if (!account) throw new Error(`account ${args.accountId} not found`)
    return storeMatches(ctx, account, args.items, { source: args.mock ? 'mock' : 'api', now: Date.now() })
  },
})
