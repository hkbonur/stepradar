import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { CONNECT_WINDOW_MS, openConnectItem } from './core/connections'
import { cannotRead } from './providers/platforms'
import { insertAccount } from '../test/fixtures'
import { setup } from '../test/setup'

type Test = ReturnType<typeof setup>

const SITE = 'http://127.0.0.1:3221'

async function redditAccount(t: Test): Promise<Id<'accounts'>> {
  return t.run(async (ctx) => {
    const account = await insertAccount(ctx, { platform: 'reddit', handle: 'Nora_Builds' })
    await openConnectItem(ctx, account, Date.now())
    return account._id
  })
}

async function connectionOf(t: Test, accountId: Id<'accounts'>) {
  const page = await t.query(api.private.accounts.get, { accountId })
  return page?.connection
}

async function openConnectItems(t: Test, accountId: Id<'accounts'>) {
  const items = await t.run((ctx) => ctx.db.query('checklistItems').collect())
  return items.filter((item) => item.accountId === accountId && item.status === 'open' && item.action?.kind === 'connect_account')
}

/** Real mode with an OAuth app's keys, and Reddit's answers to the code exchange and the identity read. */
function realReddit(username: string) {
  vi.stubEnv('PROVIDERS_MODE', 'real')
  vi.stubEnv('REDDIT_CLIENT_ID', 'client-id')
  vi.stubEnv('REDDIT_CLIENT_SECRET', 'client-secret')
  vi.stubEnv('REDDIT_USER_AGENT', 'web:influstep:test (by /u/nora_builds)')
  vi.stubEnv('CONVEX_SITE_URL', SITE)
  const fetch = vi.fn(async (input: string | URL, _init?: RequestInit) => {
    const url = String(input)
    if (url === 'https://www.reddit.com/api/v1/access_token') {
      return Response.json({ access_token: 'access', refresh_token: 'refresh', scope: 'identity read history privatemessages' })
    }
    if (url === 'https://oauth.reddit.com/api/v1/me') return Response.json({ name: username })
    throw new Error(`unexpected fetch ${url}`)
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

/** Starts the connection in real mode and returns the state the consent page would bring back. */
async function startConnect(t: Test, accountId: Id<'accounts'>): Promise<string> {
  const outcome = await t.action(api.private.connections.connect, { accountId })
  if (outcome.kind !== 'authorize') throw new Error('real mode sends the operator to the consent page')
  const url = new URL(outcome.url)
  expect(`${url.origin}${url.pathname}`).toBe('https://www.reddit.com/api/v1/authorize')
  expect(Object.fromEntries(url.searchParams)).toMatchObject({
    client_id: 'client-id',
    response_type: 'code',
    duration: 'permanent',
    scope: 'identity read history privatemessages',
    redirect_uri: `${SITE}/oauth/reddit/callback`,
  })
  const state = url.searchParams.get('state')
  if (!state) throw new Error('the consent page carries a state')
  return state
}

describe('connecting a Reddit account', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('connects at once in mock mode, and ticks off the checklist item that asked for it', async () => {
    const t = setup()
    const accountId = await redditAccount(t)
    expect(await connectionOf(t, accountId)).toEqual({ kind: 'missing' })
    expect(await openConnectItems(t, accountId)).toHaveLength(1)

    const [item] = await openConnectItems(t, accountId)
    if (!item) throw new Error('no connect item')
    await expect(t.mutation(api.private.checklist.complete, { itemId: item._id })).rejects.toThrow(
      'Connect the account to tick this off; it closes once the account is connected.'
    )
    expect(await t.action(api.private.connections.connect, { accountId })).toEqual({ kind: 'connected' })
    expect(await connectionOf(t, accountId)).toMatchObject({ kind: 'connected', username: 'Nora_Builds', mock: true })
    expect(await openConnectItems(t, accountId)).toEqual([])
  })

  it('opens the checklist item when the setup creates a Reddit account', async () => {
    const t = setup()
    await t.mutation(api.private.workspace.create, {
      sponsorName: 'Formstep',
      sponsorUrl: 'https://formstep.io',
      sponsorPitch: 'Forms that workflows and AI agents send to one customer.',
      valuePerPaid: 29,
      currency: 'EUR',
      appUrl: 'http://localhost:3300',
    })
    const identity = { platform: 'reddit' as const, handle: 'Nora_Builds', name: 'Nora', niche: 'n8n', audience: 'ops leads' }
    const proposal = await t.action(api.private.onboarding.propose, identity)
    const accountId = await t.mutation(api.private.onboarding.create, {
      ...identity,
      ...proposal,
      publishHour: 15,
      cadence: { postsPerDay: 1, kinds: ['text'], intents: ['ask'], repliesPerDay: 3 },
      sponsorDial: 0.3,
      timezone: 'Europe/Oslo',
    })
    expect((await openConnectItems(t, accountId)).map((item) => item.title)).toEqual(['Connect your Reddit account'])
  })

  it('needs no connection on a platform read by its handle', async () => {
    const t = setup()
    const account = await t.run((ctx) => insertAccount(ctx, { platform: 'hackernews', handle: 'nora' }))
    expect(await connectionOf(t, account._id)).toEqual({ kind: 'needless' })
    await expect(t.action(api.private.connections.connect, { accountId: account._id })).rejects.toThrow(
      'Hacker News needs no connection: Influstep reads it by the handle.'
    )
  })

  it('refuses in real mode until the deployment has the OAuth app, naming the key', async () => {
    const t = setup()
    const accountId = await redditAccount(t)
    vi.stubEnv('PROVIDERS_MODE', 'real')
    vi.stubEnv('CONVEX_SITE_URL', SITE)
    await expect(t.action(api.private.connections.connect, { accountId })).rejects.toThrow(
      'REDDIT_CLIENT_ID is not set on this deployment. The Providers page lists the keys each provider needs.'
    )
  })

  it("stores the grant when Reddit sends the operator back, and returns them to the account's page", async () => {
    const t = setup()
    const accountId = await redditAccount(t)
    const fetch = realReddit('nora_builds')
    const state = await startConnect(t, accountId)
    expect(await connectionOf(t, accountId)).toEqual({ kind: 'pending' })

    const response = await t.fetch(`/oauth/reddit/callback?state=${state}&code=granted`)
    expect(response.status).toBe(302)
    expect(response.headers.get('Location')).toBe(`http://localhost:3300/accounts/${accountId}`)
    // The handle matches whatever the case Reddit spells the name in.
    expect(await connectionOf(t, accountId)).toMatchObject({ kind: 'connected', username: 'nora_builds', mock: false })
    expect(await openConnectItems(t, accountId)).toEqual([])
    const stored = await t.run((ctx) => ctx.db.query('connections').first())
    expect(stored?.status).toMatchObject({
      kind: 'connected',
      refreshToken: 'refresh',
      scopes: ['identity', 'read', 'history', 'privatemessages'],
    })
    // The code exchange, among whatever else reached the token endpoint (a search as the app asks it for a token too).
    const exchange = fetch.mock.calls.find(
      ([input, init]) =>
        String(input) === 'https://www.reddit.com/api/v1/access_token' && String(init?.body).startsWith('grant_type=authorization_code')
    )
    expect(String(exchange?.[1]?.body)).toBe(
      `grant_type=authorization_code&code=granted&redirect_uri=${encodeURIComponent(`${SITE}/oauth/reddit/callback`)}`
    )
  })

  it('keeps the account unconnected when another Reddit user consented, and says who', async () => {
    const t = setup()
    const accountId = await redditAccount(t)
    realReddit('someone_else')
    const state = await startConnect(t, accountId)
    expect((await t.fetch(`/oauth/reddit/callback?state=${state}&code=granted`)).status).toBe(302)
    expect(await connectionOf(t, accountId)).toMatchObject({
      kind: 'revoked',
      error: 'You connected u/someone_else, not u/Nora_Builds. Connect again as u/Nora_Builds.',
    })
    expect(await openConnectItems(t, accountId)).toHaveLength(1)
  })

  it('changes nothing when the operator declines, and refuses a state it did not hand out or one past its window', async () => {
    const t = setup()
    const accountId = await redditAccount(t)
    realReddit('nora_builds')
    const state = await startConnect(t, accountId)
    expect((await t.fetch(`/oauth/reddit/callback?state=${state}&error=access_denied`)).status).toBe(302)
    expect(await connectionOf(t, accountId)).toEqual({ kind: 'pending' })

    expect((await t.fetch('/oauth/reddit/callback?state=forged&code=granted')).status).toBe(400)
    await t.run(async (ctx) => {
      const connection = await ctx.db.query('connections').first()
      if (!connection) throw new Error('no connection')
      await ctx.db.patch(connection._id, { status: { kind: 'pending', state, startedAt: Date.now() - CONNECT_WINDOW_MS - 1 } })
    })
    expect((await t.fetch(`/oauth/reddit/callback?state=${state}&code=granted`)).status).toBe(400)
    expect(await connectionOf(t, accountId)).toEqual({ kind: 'pending' })
  })

  it('stores why a code exchange failed, so the operator can connect again', async () => {
    const t = setup()
    const accountId = await redditAccount(t)
    realReddit('nora_builds')
    const state = await startConnect(t, accountId)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 401, statusText: 'Unauthorized' }))
    )
    expect((await t.fetch(`/oauth/reddit/callback?state=${state}&code=granted`)).status).toBe(302)
    expect(await connectionOf(t, accountId)).toMatchObject({ kind: 'revoked', error: 'Reddit refused the code: 401 Unauthorized' })
    await t.mutation(internal.internal.connections.connectMock, { accountId })
    expect(await connectionOf(t, accountId)).toMatchObject({ kind: 'connected' })
  })

  it("reads the account's posts only once connected, and a grant Reddit dropped asks to connect again", async () => {
    const t = setup()
    const accountId = await redditAccount(t)
    await expect(t.mutation(api.private.history.importHistory, { accountId })).rejects.toThrow(
      cannotRead({ platform: 'reddit' }, 'activity')
    )

    // Mock mode: connected, the mock reader reads the account.
    await t.action(api.private.connections.connect, { accountId })
    const imported = await t.mutation(api.private.history.importHistory, { accountId })
    await t.finishAllScheduledFunctions(() => {})
    expect(await t.run((ctx) => ctx.db.get(imported))).toMatchObject({ status: 'done', result: { added: 40, skipped: 0 } })

    // Real mode: Reddit no longer accepts the stored grant.
    realReddit('nora_builds')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ error: 'invalid_grant' }, { status: 400 }))
    )
    const failed = await t.mutation(api.private.history.importHistory, { accountId })
    await t.finishAllScheduledFunctions(() => {})
    const said = 'Reddit no longer lets Influstep read u/Nora_Builds: connect it again.'
    expect(await t.run((ctx) => ctx.db.get(failed))).toMatchObject({ status: 'failed', error: said })
    expect(await connectionOf(t, accountId)).toMatchObject({ kind: 'revoked', error: said })
    expect(await openConnectItems(t, accountId)).toHaveLength(1)
  })
})
