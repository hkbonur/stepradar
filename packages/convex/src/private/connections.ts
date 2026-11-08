import { needsConnection, type ConnectedPlatform, placeLabel, placeOf } from '@influstep/shared'
import { v } from 'convex/values'
import { internal } from '../_generated/api'
import { action } from '../_generated/server'
import { refusal } from '../lib/errors'
import { providersMode } from '../lib/env'
import { authorizeUrl } from '../providers/platforms/reddit/oauth'

/** Each connected platform's consent page for a state; a platform added to shared `CONNECTED_PLATFORMS` needs one. */
const CONSENT_PAGES: Record<ConnectedPlatform, (state: string) => string> = { reddit: authorizeUrl }

/**
 * Connect an account to a platform that reads it only once the operator lets
 * it. In real mode the studio sends the operator to the consent page this
 * returns, and the callback (http.ts) stores the grant; in mock mode the
 * account connects at once, so the flow can be rehearsed without keys.
 */
export const connect = action({
  args: { accountId: v.id('accounts') },
  handler: async (ctx, args): Promise<{ kind: 'connected' } | { kind: 'authorize'; url: string }> => {
    const { account } = await ctx.runQuery(internal.internal.data.getAccount, { accountId: args.accountId })
    if (!needsConnection(account.platform)) {
      throw refusal(`${placeLabel(placeOf(account))} needs no connection: Influstep reads it by the handle.`)
    }
    if (providersMode() === 'mock') {
      await ctx.runMutation(internal.internal.connections.connectMock, { accountId: account._id })
      return { kind: 'connected' }
    }
    const state = crypto.randomUUID()
    const url = CONSENT_PAGES[account.platform](state)
    await ctx.runMutation(internal.internal.connections.start, { accountId: account._id, state })
    return { kind: 'authorize', url }
  },
})
