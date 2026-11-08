import { httpRouter } from 'convex/server'
import { internal } from './_generated/api'
import { httpAction } from './_generated/server'
import { exchangeCode, redditUsername } from './providers/platforms/reddit/oauth'

const http = httpRouter()

/**
 * Reddit sends the operator back here from its consent page. A state the
 * backend did not hand out, or one past its window, is refused. A declined
 * consent changes nothing; a granted one is exchanged and stored
 * (core/connections.ts), and a failed exchange is stored as the reason. Every
 * known state ends on the account's page in the studio.
 */
http.route({
  path: '/oauth/reddit/callback',
  method: 'GET',
  handler: httpAction(async (ctx, request) => {
    const params = new URL(request.url).searchParams
    const state = params.get('state')
    const pending = state === null ? null : await ctx.runQuery(internal.internal.connections.pendingByState, { state })
    if (pending === null) {
      return new Response('This Reddit connection is unknown or has expired. Start it again from the account in Influstep.', {
        status: 400,
      })
    }
    const code = params.get('code')
    if (code !== null && params.get('error') === null) {
      try {
        const granted = await exchangeCode(code)
        const username = await redditUsername(granted.accessToken)
        await ctx.runMutation(internal.internal.connections.finish, {
          accountId: pending.accountId,
          refreshToken: granted.refreshToken,
          scopes: granted.scopes,
          username,
        })
      } catch (caught) {
        const error = caught instanceof Error ? caught.message : String(caught)
        await ctx.runMutation(internal.internal.connections.fail, { accountId: pending.accountId, error })
      }
    }
    return Response.redirect(pending.back, 302)
  }),
})

export default http
