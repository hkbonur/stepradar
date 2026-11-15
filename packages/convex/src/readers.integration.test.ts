import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, internal } from './_generated/api'
import { ARCHIVE_NEEDS_X } from './core/history'
import { cannotRead, capabilitiesOf, realReader } from './providers/platforms'
import { communitiesToRead, storeCommunityRules } from './core/communities'
import { mockClassifier } from './providers/classifier/mock'
import { N8N_FORUM, insertAccount } from '../test/fixtures'
import { setup } from '../test/setup'

// Real mode reads Claude for the classifier; these tests read the mock's rules instead.
vi.mock('./providers/classifier/anthropic', async () => {
  const { mockClassifier } = await import('./providers/classifier/mock')
  return { anthropicClassifier: () => mockClassifier }
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('platform readers', () => {
  it('leaves a step its reader cannot do to the operator, and names the step', async () => {
    const t = setup()
    const account = await t.run((ctx) => insertAccount(ctx, { platform: 'linkedin', handle: 'ada-lovelace' }))

    // LinkedIn's reader reads nothing, so the schedule queues no listening and no comment poll for it.
    await t.mutation(internal.internal.schedule.listen, {})
    await t.mutation(internal.internal.schedule.pollComments, {})
    expect(await t.run((ctx) => ctx.db.query('jobs').collect())).toEqual([])
    await expect(t.mutation(api.private.replies.listenNow, { accountId: account._id })).rejects.toThrow(
      cannotRead({ platform: 'linkedin' }, 'search')
    )
    await expect(t.mutation(api.private.history.importHistory, { accountId: account._id })).rejects.toThrow(
      cannotRead({ platform: 'linkedin' }, 'activity')
    )
    // The archive and the paste are X's formats.
    await expect(t.mutation(api.private.history.importPosts, { accountId: account._id, source: 'paste', posts: [] })).rejects.toThrow(
      ARCHIVE_NEEDS_X
    )

    // The metrics pull reads no numbers, and still closes what is due.
    expect(await t.action(internal.internal.analyst.pullMetrics, { accountId: account._id })).toMatchObject({ counted: 0 })
  })

  it("searches every platform whose reader can, whatever the account's own platform", async () => {
    const t = setup()
    const account = await t.run((ctx) => insertAccount(ctx, { platform: 'linkedin', handle: 'ada-lovelace' }))
    await t.action(internal.internal.researcher.pollSignals, { accountId: account._id })
    const signals = await t.run((ctx) => ctx.db.query('signals').collect())
    expect([...new Set(signals.map((signal) => signal.source))].sort()).toEqual(['hackernews', 'reddit', 'search', 'x'])
  })

  it('leaves a platform out of the poll in real mode while its app keys are not set, names the keys, and still reads the others', async () => {
    const t = setup()
    const account = await t.run((ctx) => insertAccount(ctx, { platform: 'linkedin', handle: 'ada-lovelace' }))
    vi.stubEnv('PROVIDERS_MODE', 'real')
    const now = Math.floor(Date.now() / 1000)
    const fetch = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input))
      if (url.host === 'hn.algolia.com') {
        const hit = { url: null, author: 'dana', created_at_i: now - 600, points: 12, num_comments: 4 }
        // One story on the account's niche (n8n), one off it: the classifier keeps the first and files the second dismissed.
        return Response.json({
          hits: [
            { ...hit, objectID: '9001', title: 'Ask HN: How do you retry n8n webhooks?' },
            { ...hit, objectID: '9002', title: 'Show HN: A synth in the browser' },
          ],
        })
      }
      if (url.host === 'suggestqueries.google.com') return Response.json([url.searchParams.get('q'), []])
      throw new Error(`unexpected fetch ${url}`)
    })
    vi.stubGlobal('fetch', fetch)

    expect(await t.action(internal.internal.researcher.pollSignals, { accountId: account._id })).toEqual({
      found: 1,
      kept: 1,
      offNiche: 1,
      unread: [{ platform: 'reddit', missing: ['REDDIT_CLIENT_ID', 'REDDIT_CLIENT_SECRET', 'REDDIT_USER_AGENT'] }],
    })
    expect(fetch.mock.calls.some(([input]) => String(input).includes('reddit.com'))).toBe(false)
    expect(await t.run((ctx) => ctx.db.query('signals').collect())).toMatchObject([
      { source: 'hackernews', externalId: '9001', status: 'new' },
      { source: 'hackernews', externalId: '9002', status: 'dismissed' },
    ])
    // A second poll reads the same stories without asking the classifier again, and keeps their statuses.
    expect(await t.action(internal.internal.researcher.pollSignals, { accountId: account._id })).toMatchObject({
      found: 0,
      kept: 0,
      offNiche: 0,
    })
    expect((await t.run((ctx) => ctx.db.query('signals').collect())).map((signal) => signal.status)).toEqual(['new', 'dismissed'])
  })

  it("reads on Reddit, Hacker News and Discourse forums in real mode, Reddit's account only once connected, and nothing on X or LinkedIn", () => {
    expect(capabilitiesOf(realReader({ platform: 'hackernews' }, null, {}))).toEqual([
      'search',
      'activity',
      'comments',
      'counts',
      'account',
      'rules',
    ])
    expect(capabilitiesOf(realReader({ platform: 'reddit' }, null, {}))).toEqual(['search', 'rules'])
    expect(capabilitiesOf(realReader({ platform: 'reddit' }, { refreshToken: 'grant' }, {}))).toEqual([
      'search',
      'mentions',
      'activity',
      'comments',
      'counts',
      'account',
      'rules',
    ])
    expect(capabilitiesOf(realReader({ platform: 'x' }, null, {}))).toEqual([])
    expect(capabilitiesOf(realReader({ platform: 'linkedin' }, null, {}))).toEqual([])
    // A Discourse forum is read as any visitor reads it, mentions aside; a forum on other software reads nothing.
    expect(capabilitiesOf(realReader({ platform: 'forum', forum: N8N_FORUM }, null, {}))).toEqual([
      'search',
      'activity',
      'comments',
      'counts',
      'account',
      'rules',
      'community',
    ])
    const zapier = { origin: 'https://community.zapier.com', name: 'Zapier Community', software: 'other' as const }
    expect(capabilitiesOf(realReader({ platform: 'forum', forum: zapier }, null, {}))).toEqual([])
  })

  it('listens on Hacker News through its search, and keeps where each thread was said', async () => {
    const t = setup()
    const account = await t.run((ctx) => insertAccount(ctx, { platform: 'hackernews', handle: 'nora' }))
    await t.mutation(api.private.replies.listenNow, { accountId: account._id })
    await t.finishAllScheduledFunctions(() => {})
    const replies = await t.run((ctx) => ctx.db.query('replies').collect())
    expect(replies.length).toBeGreaterThan(0)
    for (const reply of replies) expect(reply).toMatchObject({ origin: 'search', thread: { community: 'Hacker News' } })
    // Hacker News gets talking points for the operator to write from, not a comment.
    expect(replies.filter((reply) => reply.status === 'draft').every((reply) => reply.text.startsWith('- '))).toBe(true)

    // It met Hacker News, read its guidelines and found they discourage promotion; within the week they are not read again.
    const communities = await t.run((ctx) => ctx.db.query('communities').collect())
    expect(communities).toMatchObject([{ name: 'Hacker News', selfPromotion: 'forbidden', weight: 1 }])
    const readAt = communities[0]?.rulesReadAt
    await t.mutation(api.private.replies.listenNow, { accountId: account._id })
    await t.finishAllScheduledFunctions(() => {})
    expect((await t.run((ctx) => ctx.db.query('communities').collect())).map((community) => community.rulesReadAt)).toEqual([readAt])
  })

  it('drafts a reply to a thread the operator pasted where nothing searches, once', async () => {
    const t = setup()
    const account = await t.run((ctx) => insertAccount(ctx, { platform: 'linkedin', handle: 'ada-lovelace' }))
    const url = 'https://www.linkedin.com/posts/dana-ruiz_retries-activity-7123456789-abcd'
    const paste = (link: string) =>
      t.action(api.private.replies.pasteThread, { accountId: account._id, url: link, text: 'How do you stop retries running twice?' })
    await paste(url)
    await t.finishAllScheduledFunctions(() => {})
    const replies = await t.run((ctx) => ctx.db.query('replies').collect())
    expect(replies).toMatchObject([
      {
        origin: 'pasted',
        status: 'draft',
        operatorAsked: true,
        inReplyTo: 'urn:li:activity:7123456789',
        // The link names its author; nothing says when it was posted or how far it reaches, so neither is made up.
        thread: { author: { handle: 'dana-ruiz' }, text: 'How do you stop retries running twice?', postedAt: null, reach: null },
      },
    ])
    await expect(paste(url)).rejects.toThrow('This thread already has a reply; it is on this page.')
    await expect(paste('https://x.com/dana/status/1840')).rejects.toThrow('That is no link to a thread on LinkedIn.')
  })

  it('reads a community once whatever the case of its name', async () => {
    const t = setup()
    const account = await t.run((ctx) => insertAccount(ctx, { platform: 'reddit', handle: 'ada_automates' }))
    const read = { rulesText: 'No self-promotion.', selfPromotion: 'forbidden' as const, reason: 'a rule forbids promotion' }
    await t.run(async (ctx) => {
      await storeCommunityRules(ctx, account._id, { name: 'n8n', ...read }, Date.now())
      await storeCommunityRules(ctx, account._id, { name: 'N8N', ...read }, Date.now())
      expect(await communitiesToRead(ctx, account._id, ['N8N', 'zapier'], Date.now())).toEqual(['zapier'])
    })
    expect((await t.run((ctx) => ctx.db.query('communities').collect())).map((community) => community.name)).toEqual(['n8n'])
  })

  it("keeps half a Reddit sweep to the account's own communities weighted above zero, and reads everywhere for the rest", async () => {
    const t = setup()
    const account = await t.run((ctx) => insertAccount(ctx, { platform: 'reddit', handle: 'ada_automates' }))
    const read = { rulesText: 'Be kind.', selfPromotion: 'allowed' as const, reason: 'no rule against it' }
    await t.run(async (ctx) => {
      await storeCommunityRules(ctx, account._id, { name: 'n8n', ...read }, Date.now())
      await storeCommunityRules(ctx, account._id, { name: 'zapier', ...read }, Date.now())
      const zapier = await ctx.db
        .query('communities')
        .withIndex('by_account_name', (q) => q.eq('accountId', account._id).eq('name', 'zapier'))
        .first()
      if (!zapier) throw new Error('community not stored')
      await ctx.db.patch(zapier._id, { weight: 0 })
    })
    expect(await t.query(internal.internal.replies.searchedCommunitiesOf, { accountId: account._id })).toEqual(['n8n'])
    await t.action(internal.internal.replies.listen, { accountId: account._id })
    const heard = await t.run((ctx) => ctx.db.query('replies').collect())
    const kept = heard.filter((reply) => reply.inReplyTo.startsWith('mock-reddit-kept-'))
    expect(kept.length).toBeGreaterThan(0)
    expect(kept.every((reply) => reply.thread.community === 'n8n')).toBe(true)
    expect(heard.some((reply) => !reply.inReplyTo.startsWith('mock-reddit-kept-'))).toBe(true)
  })

  it("answers a pasted Reddit thread under the rules the operator pasted while the app's keys are not set, and asks for them without", async () => {
    const t = setup()
    const account = await t.run((ctx) => insertAccount(ctx, { platform: 'reddit', handle: 'nora' }))
    vi.stubEnv('PROVIDERS_MODE', 'real')
    const url = 'https://www.reddit.com/r/n8n/comments/1abcde/form_webhook_runs_twice/'
    const text = 'My form webhook runs twice. How do you dedupe it?'
    await expect(t.action(api.private.replies.pasteThread, { accountId: account._id, url, text })).rejects.toThrow(
      'Stepradar could not read the rules of r/n8n: The Reddit app ID is not set. Add it on the Providers page. Paste them with the thread instead.'
    )
    await expect(t.action(api.private.replies.pasteThread, { accountId: account._id, url, text, rules: '  ' })).rejects.toThrow(
      'Paste the community’s rules, or leave the field empty.'
    )
    const rules = '1. No self-promotion outside the weekly thread.'
    await t.action(api.private.replies.pasteThread, { accountId: account._id, url, text, rules })
    expect(await t.run((ctx) => ctx.db.query('communities').collect())).toMatchObject([{ name: 'n8n', rulesText: rules }])
    expect(await t.run((ctx) => ctx.db.query('replies').collect())).toMatchObject([
      { origin: 'pasted', inReplyTo: 't3_1abcde', thread: { community: 'n8n' } },
    ])
  })

  it('refuses rules pasted with a thread that names no community', async () => {
    const t = setup()
    const account = await t.run((ctx) => insertAccount(ctx, { platform: 'linkedin', handle: 'ada-lovelace' }))
    await expect(
      t.action(api.private.replies.pasteThread, {
        accountId: account._id,
        url: 'https://www.linkedin.com/posts/dana-ruiz_retries-activity-7123456789-abcd',
        text: 'Retries?',
        rules: 'Be kind.',
      })
    ).rejects.toThrow('This thread names no community, so it takes no rules.')
  })

  it('answers nothing in a community whose rules it cannot read, and says so', async () => {
    const t = setup()
    const account = await t.run((ctx) => insertAccount(ctx, { platform: 'hackernews', handle: 'nora' }))
    vi.spyOn(mockClassifier, 'communityRules').mockRejectedValue(new Error('the model is down'))
    const outcome = await t.action(internal.internal.replies.listen, { accountId: account._id })
    expect(outcome).toMatchObject({ rulesUnread: [{ name: 'Hacker News', error: 'the model is down' }] })
    expect(await t.run((ctx) => ctx.db.query('replies').collect())).toEqual([])
    await expect(
      t.action(api.private.replies.pasteThread, {
        accountId: account._id,
        url: 'https://news.ycombinator.com/item?id=41000000',
        text: 'Retries?',
      })
    ).rejects.toThrow('Stepradar could not read the rules of Hacker News: the model is down')
  })
})
