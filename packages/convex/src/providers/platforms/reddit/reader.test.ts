import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConnectionRevoked } from '../types'
import { redditReader } from './index'

const NOW = Date.UTC(2026, 9, 22, 12)
const OVERVIEW = '/user/Nora_Builds/overview?limit=100&raw_json=1'
const INBOX = '/message/inbox?limit=100&raw_json=1'

/** Reddit's token endpoint and the OAuth API, by path; counts how often the grant is refreshed. */
function stubReddit(api: Record<string, unknown>, refresh: Response = Response.json({ access_token: 'access' })) {
  const refreshes = { count: 0 }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.href === 'https://www.reddit.com/api/v1/access_token') {
        refreshes.count += 1
        expect(String(init?.body)).toBe('grant_type=refresh_token&refresh_token=grant')
        return refresh.clone()
      }
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer access')
      const path = `${url.pathname}${url.search}`
      if (!(path in api)) throw new Error(`unexpected read ${path}`)
      return Response.json(api[path])
    })
  )
  return refreshes
}

function reader() {
  const connected = redditReader({ refreshToken: 'grant' })
  const { activity, comments } = connected
  if (!activity || !comments) throw new Error('a connected Reddit reader reads the account')
  return { activity, comments }
}

describe('the connected Reddit reader', () => {
  beforeEach(() => {
    vi.stubEnv('REDDIT_CLIENT_ID', 'client-id')
    vi.stubEnv('REDDIT_CLIENT_SECRET', 'client-secret')
    vi.stubEnv('REDDIT_USER_AGENT', 'web:influstep:test (by /u/nora_builds)')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it("reads the account's posts and comments as its history, by fullname, refreshing the grant once", async () => {
    const refreshes = stubReddit({
      [OVERVIEW]: {
        data: {
          children: [
            {
              kind: 't3',
              data: {
                name: 't3_abc',
                title: 'How do you retry a webhook?',
                selftext: 'Mine runs twice.',
                score: 42,
                num_comments: 7,
                created_utc: NOW / 1000 - 3600,
                subreddit: 'n8n',
                permalink: '/r/n8n/comments/abc/how_do_you_retry_a_webhook/',
              },
            },
            {
              kind: 't1',
              data: {
                name: 't1_xyz',
                body: 'Use an idempotency key.',
                score: 5,
                created_utc: NOW / 1000 - 7200,
                parent_id: 't3_qrs',
                subreddit: 'automation',
                permalink: '/r/automation/comments/qrs/webhooks/xyz/',
              },
            },
          ],
        },
      },
      [INBOX]: {
        data: {
          children: [
            {
              kind: 't1',
              data: {
                name: 't1_def',
                author: 'dana_ops',
                body: 'Which queue?',
                created_utc: NOW / 1000 - 600,
                context: '/r/n8n/comments/abc/how_do_you_retry_a_webhook/def/?context=3',
                parent_id: 't3_abc',
                subreddit: 'n8n',
                type: 'post_reply',
              },
            },
            {
              kind: 't1',
              data: {
                name: 't1_old',
                author: 'dana_ops',
                body: 'Last month.',
                created_utc: NOW / 1000 - 30 * 86_400,
                context: '/r/n8n/comments/abc/how_do_you_retry_a_webhook/old/?context=3',
                parent_id: 't3_abc',
                subreddit: 'n8n',
                type: 'comment_reply',
              },
            },
            {
              kind: 't1',
              data: {
                name: 't1_mention',
                author: 'tomtries',
                body: 'u/Nora_Builds knows this',
                created_utc: NOW / 1000 - 300,
                context: '/r/n8n/comments/xyz/other/mention/?context=3',
                parent_id: 't3_xyz',
                subreddit: 'n8n',
                type: 'username_mention',
              },
            },
            { kind: 't4' },
          ],
        },
      },
    })
    const read = reader()
    expect(await read.activity({ handle: 'Nora_Builds', since: 0, niche: 'n8n', pillars: ['n8n'], now: NOW })).toEqual([
      {
        externalId: 't3_abc',
        parts: ['How do you retry a webhook?\n\nMine runs twice.'],
        postedAt: NOW - 3_600_000,
        likes: 42,
        reposts: 0,
        replies: 7,
        parentId: null,
        url: 'https://www.reddit.com/r/n8n/comments/abc/how_do_you_retry_a_webhook/',
        community: 'n8n',
        lang: null,
      },
      {
        externalId: 't1_xyz',
        parts: ['Use an idempotency key.'],
        postedAt: NOW - 7_200_000,
        likes: 5,
        reposts: 0,
        replies: 0,
        parentId: 't3_qrs',
        url: 'https://www.reddit.com/r/automation/comments/qrs/webhooks/xyz/',
        community: 'automation',
        lang: null,
      },
    ])
    // What was posted before the time asked is left out.
    const since = await read.activity({ handle: 'Nora_Builds', since: NOW - 5_400_000, niche: 'n8n', pillars: ['n8n'], now: NOW })
    expect(since.map((post) => post.externalId)).toEqual(['t3_abc'])
    // The answers in the inbox since the time asked, by what they answer; a mention is heard as a mention, a message skipped.
    expect(await read.comments({ items: ['t3_abc'], since: NOW - 86_400_000, known: new Set() })).toEqual([
      {
        externalId: 't1_def',
        parentId: 't3_abc',
        author: { handle: 'dana_ops', name: 'dana_ops' },
        text: 'Which queue?',
        url: 'https://www.reddit.com/r/n8n/comments/abc/how_do_you_retry_a_webhook/def/?context=3',
        community: 'n8n',
        likes: 0,
        at: NOW - 600_000,
      },
    ])
    expect(refreshes.count).toBe(1)
  })

  it("reads its items' scores and comments by fullname, and the account's karma", async () => {
    stubReddit({
      '/api/info?id=t3_abc,t1_def,t1_gone,t3_mod,t1_mod,t3_own&raw_json=1': {
        data: {
          children: [
            {
              kind: 't3',
              data: {
                name: 't3_abc',
                title: 'How do you retry a webhook?',
                selftext: '',
                score: 42,
                num_comments: 7,
                created_utc: NOW / 1000,
                subreddit: 'n8n',
                permalink: '/r/n8n/comments/abc/x/',
              },
            },
            {
              kind: 't1',
              data: {
                name: 't1_def',
                body: 'Cap the retries.',
                score: 5,
                created_utc: NOW / 1000,
                parent_id: 't3_xyz',
                subreddit: 'n8n',
                permalink: '/r/n8n/comments/xyz/x/def/',
              },
            },
            {
              kind: 't3',
              data: {
                name: 't3_mod',
                title: 'Try my tool',
                selftext: '',
                score: 1,
                num_comments: 0,
                created_utc: NOW / 1000,
                subreddit: 'n8n',
                permalink: '/r/n8n/comments/mod/x/',
                removed_by_category: 'moderator',
              },
            },
            {
              kind: 't1',
              data: {
                name: 't1_mod',
                body: '[removed]',
                score: 1,
                created_utc: NOW / 1000,
                parent_id: 't3_xyz',
                subreddit: 'n8n',
                permalink: '/r/n8n/comments/xyz/x/mod/',
              },
            },
            {
              kind: 't3',
              data: {
                name: 't3_own',
                title: 'Deleted it myself',
                selftext: '',
                score: 1,
                num_comments: 0,
                created_utc: NOW / 1000,
                subreddit: 'n8n',
                permalink: '/r/n8n/comments/own/x/',
                removed_by_category: 'deleted',
              },
            },
          ],
        },
      },
      '/user/Nora_Builds/about?raw_json=1': { data: { link_karma: 120, comment_karma: 480 } },
    })
    const { counts, account } = redditReader({ refreshToken: 'grant' })
    if (!counts || !account) throw new Error('a connected Reddit reader reads numbers')
    const asked = ['t3_abc', 't1_def', 't1_gone', 't3_mod', 't1_mod', 't3_own'].map((externalId) => ({
      externalId,
      kind: externalId.startsWith('t3_') ? ('post' as const) : ('reply' as const),
      postedAt: NOW,
    }))
    // Reddit counts no comments under a comment, and leaves out an item it no longer shows.
    expect(await counts(asked)).toEqual([
      { externalId: 't3_abc', counts: { platform: 'reddit', score: 42, replies: 7 } },
      { externalId: 't1_def', counts: { platform: 'reddit', score: 5, replies: null } },
      // Removed by the subreddit's moderators; one its author deleted is just gone.
      { externalId: 't3_mod', removed: true },
      { externalId: 't1_mod', removed: true },
    ])
    expect(await account('Nora_Builds')).toEqual({ platform: 'reddit', linkKarma: 120, commentKarma: 480 })
  })

  it('says the grant was revoked when Reddit no longer accepts it', async () => {
    stubReddit({}, Response.json({ error: 'invalid_grant' }, { status: 400 }))
    await expect(reader().activity({ handle: 'Nora_Builds', since: 0, niche: 'n8n', pillars: ['n8n'], now: NOW })).rejects.toBeInstanceOf(
      ConnectionRevoked
    )
  })

  it("names the deployment's keys when Reddit refuses the app, and leaves the grant alone", async () => {
    stubReddit({}, new Response('Unauthorized', { status: 401 }))
    const read = reader().activity({ handle: 'Nora_Builds', since: 0, niche: 'n8n', pillars: ['n8n'], now: NOW })
    await expect(read).rejects.toThrow('Reddit refused the OAuth app: check REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET')
    await expect(read).rejects.not.toBeInstanceOf(ConnectionRevoked)
  })

  it('searches as the app for an account not connected, in its communities, with fullnames for ids', async () => {
    const asked: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = new URL(String(input))
        if (url.href === 'https://www.reddit.com/api/v1/access_token') {
          expect(String(init?.body)).toBe('grant_type=client_credentials')
          return Response.json({ access_token: 'access' })
        }
        asked.push(`${url.pathname}${url.search}`)
        return Response.json({
          data: {
            children: [
              {
                kind: 't3',
                data: {
                  name: 't3_abc',
                  title: 'Webhook retries twice',
                  permalink: '/r/n8n/comments/abc/webhook/',
                  author: 'dana',
                  score: 40,
                  num_comments: 9,
                  created_utc: NOW / 1000 - 600,
                  subreddit: 'n8n',
                  selftext: 'Why?',
                },
              },
            ],
          },
        })
      })
    )
    const search = redditReader(null).search
    if (!search) throw new Error('the Reddit reader searches as the app')
    const found = await search({
      terms: ['webhooks'],
      since: NOW - 3_600_000,
      limit: 5,
      communities: ['n8n', 'zapier'],
      sponsorName: 'Formstep',
    })
    expect(asked).toEqual(['/r/n8n+zapier/search?q=webhooks&sort=new&t=week&limit=5&raw_json=1&restrict_sr=1'])
    expect(found).toEqual([
      {
        externalId: 't3_abc',
        url: 'https://www.reddit.com/r/n8n/comments/abc/webhook/',
        title: 'Webhook retries twice',
        text: 'Why?',
        postedAt: NOW - 600_000,
        author: { handle: 'dana', name: 'dana' },
        reach: 40,
        community: 'n8n',
        comments: 9,
        topics: ['webhooks'],
      },
    ])
  })

  it("reads a subreddit's rules, one per line", async () => {
    stubReddit({
      '/r/n8n/about/rules?raw_json=1': {
        rules: [
          { short_name: 'Be kind', description: 'No insults.' },
          { short_name: 'No self-promotion', description: 'Except in the weekly thread.' },
        ],
      },
    })
    const rules = redditReader({ refreshToken: 'grant' }).rules
    if (!rules) throw new Error('a connected Reddit reader reads rules')
    expect(await rules('n8n')).toBe('Be kind: No insults.\nNo self-promotion: Except in the weekly thread.')
  })

  it('hears the comments that mention the account since a time, by fullname', async () => {
    stubReddit({
      '/message/mentions?limit=100&raw_json=1': {
        data: {
          children: [
            {
              kind: 't1',
              data: {
                name: 't1_new',
                author: 'dana',
                body: 'u/Nora_Builds what fixed it?',
                created_utc: NOW / 1000 - 600,
                subreddit: 'n8n',
                context: '/r/n8n/comments/abc/webhook/new/?context=3',
                link_title: 'Webhook retries twice',
              },
            },
            {
              kind: 't1',
              data: {
                name: 't1_old',
                author: 'joe',
                body: 'old',
                created_utc: NOW / 1000 - 90_000,
                subreddit: 'n8n',
                context: '/r/n8n/comments/abc/webhook/old/?context=3',
                link_title: 'Webhook retries twice',
              },
            },
          ],
        },
      },
    })
    const mentions = redditReader({ refreshToken: 'grant' }).mentions
    if (!mentions) throw new Error('a connected Reddit reader hears mentions')
    expect(await mentions({ handle: 'Nora_Builds', since: NOW - 3_600_000 })).toEqual([
      {
        origin: 'mention',
        externalId: 't1_new',
        url: 'https://www.reddit.com/r/n8n/comments/abc/webhook/new/?context=3',
        title: 'Webhook retries twice',
        text: 'u/Nora_Builds what fixed it?',
        postedAt: NOW - 600_000,
        author: { handle: 'dana', name: 'dana' },
        reach: null,
        community: 'n8n',
        pillar: null,
        comments: null,
      },
    ])
  })
})
