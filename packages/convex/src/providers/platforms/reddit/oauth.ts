import { z } from 'zod'
import { refusal } from '../../../lib/errors'
import { requireEnv } from '../../../lib/env'
import { ConnectionRevoked } from '../types'

/**
 * Reddit's OAuth for a web app (docs/plan.md, slice 3): the consent page,
 * the code exchanged for a refresh token, and who consented. Only the
 * refresh token is stored; an access token lives for one read.
 */

/** What the reader asks for: who the account is, reading posts and comments, its own history, and its inbox of answers. */
export const REDDIT_SCOPES = ['identity', 'read', 'history', 'privatemessages']

export const REDDIT_KEYS = ['REDDIT_CLIENT_ID', 'REDDIT_CLIENT_SECRET', 'REDDIT_USER_AGENT'] as const

/** Where Reddit sends the operator back: the backend's own callback route, which must match the app's settings exactly. */
export function redirectUri(): string {
  return `${requireEnv('CONVEX_SITE_URL')}/oauth/reddit/callback`
}

/** The consent page, for a permanent grant the reader can refresh. */
export function authorizeUrl(state: string): string {
  const url = new URL('https://www.reddit.com/api/v1/authorize')
  url.searchParams.set('client_id', requireEnv('REDDIT_CLIENT_ID'))
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('state', state)
  url.searchParams.set('redirect_uri', redirectUri())
  url.searchParams.set('duration', 'permanent')
  url.searchParams.set('scope', REDDIT_SCOPES.join(' '))
  return url.toString()
}

const tokenSchema = z.object({ access_token: z.string(), refresh_token: z.string(), scope: z.string() })

/** Reddit's token endpoint, as the OAuth app: a code exchanged, or a grant refreshed. */
function tokenRequest(body: Record<string, string>): Promise<Response> {
  return fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${requireEnv('REDDIT_CLIENT_ID')}:${requireEnv('REDDIT_CLIENT_SECRET')}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': requireEnv('REDDIT_USER_AGENT'),
    },
    body: new URLSearchParams(body),
  })
}

/** The consent's code, exchanged for the tokens and the scopes Reddit granted. */
export async function exchangeCode(code: string): Promise<{ accessToken: string; refreshToken: string; scopes: string[] }> {
  const response = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri() })
  if (!response.ok) throw new Error(`Reddit refused the code: ${response.status} ${response.statusText}`)
  const parsed = tokenSchema.parse(await response.json())
  return { accessToken: parsed.access_token, refreshToken: parsed.refresh_token, scopes: parsed.scope.split(' ') }
}

const meSchema = z.object({ name: z.string() })

/** The username of whoever the token belongs to. */
export async function redditUsername(accessToken: string): Promise<string> {
  const response = await fetch('https://oauth.reddit.com/api/v1/me', {
    headers: { Authorization: `Bearer ${accessToken}`, 'User-Agent': requireEnv('REDDIT_USER_AGENT') },
  })
  if (!response.ok) throw new Error(`Reddit did not say who consented: ${response.status} ${response.statusText}`)
  return meSchema.parse(await response.json()).name
}

/** Reads through the OAuth API as one account, with an access token refreshed once per session. */
export interface RedditSession {
  get(path: string): Promise<unknown>
}

/** As one account, refreshing its grant. */
export function redditSession(refreshToken: string): RedditSession {
  return sessionWith(() => refreshAccess(refreshToken))
}

/** As the OAuth app itself, for what any account may read: search. */
export function redditAppSession(): RedditSession {
  return sessionWith(appAccess)
}

function sessionWith(token: () => Promise<string>): RedditSession {
  let accessToken: Promise<string> | null = null
  return {
    async get(path) {
      accessToken ??= token()
      const response = await fetch(`https://oauth.reddit.com${path}`, {
        headers: { Authorization: `Bearer ${await accessToken}`, 'User-Agent': requireEnv('REDDIT_USER_AGENT') },
      })
      if (response.status === 401) throw new ConnectionRevoked('Reddit refused the access token')
      if (!response.ok) throw new Error(`Reddit read failed: ${response.status} ${response.statusText}`)
      return response.json()
    },
  }
}

const refreshedSchema = z.union([z.object({ access_token: z.string() }), z.object({ error: z.string() })])

/** The app's own access token (client credentials): no account's grant, so nothing to revoke. */
async function appAccess(): Promise<string> {
  const response = await tokenRequest({ grant_type: 'client_credentials' })
  if (response.status === 401) {
    throw refusal('Reddit refused the OAuth app: check REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET on the Convex deployment.')
  }
  if (!response.ok) throw new Error(`Reddit app token failed: ${response.status} ${response.statusText}`)
  const parsed = refreshedSchema.parse(await response.json())
  if ('error' in parsed) throw new Error(`Reddit would not give the app a token: ${parsed.error}`)
  return parsed.access_token
}

/** A fresh access token for the grant; a grant Reddit no longer accepts is revoked. */
async function refreshAccess(refreshToken: string): Promise<string> {
  const response = await tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken })
  // Reddit answers a refused app with 401 and a refused grant with 400 and its reason; only the grant is the account's to renew.
  if (response.status === 401) {
    throw refusal('Reddit refused the OAuth app: check REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET on the Convex deployment.')
  }
  if (!response.ok && response.status !== 400) throw new Error(`Reddit token refresh failed: ${response.status} ${response.statusText}`)
  const parsed = refreshedSchema.parse(await response.json())
  if (!('error' in parsed)) return parsed.access_token
  if (parsed.error === 'invalid_grant') throw new ConnectionRevoked('Reddit no longer accepts the grant')
  throw new Error(`Reddit would not refresh the grant: ${parsed.error}`)
}
