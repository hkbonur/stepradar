import { afterEach, describe, expect, it, vi } from 'vitest'
import { hackerNewsReader, hnText } from './hackernews'

const NOW = Date.UTC(2026, 9, 22, 12)

/** Firebase's answer for each path the reader asks, keyed by the path after /v0/. */
function stubFirebase(answers: Record<string, unknown>): string[] {
  const asked: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const path = input.replace('https://hacker-news.firebaseio.com/v0/', '').replace(/\.json$/, '')
      asked.push(path)
      return new Response(JSON.stringify(path in answers ? answers[path] : null), { status: 200 })
    })
  )
  return asked
}

const STORY = {
  id: 41,
  type: 'story',
  time: NOW / 1000 - 3600,
  title: 'Show HN: Retries that never run twice',
  score: 57,
  descendants: 12,
  kids: [43, 44, 45],
}
const COMMENT = {
  id: 42,
  type: 'comment',
  time: NOW / 1000 - 7200,
  text: 'Use an idempotency key.<p>It&#x27;s the only fix.',
  kids: [],
  parent: 7,
}

describe('the Hacker News reader', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("reads a story's points and comments, a comment's answers, and the account's karma, leaving out what was removed", async () => {
    stubFirebase({
      'user/nora_demo': { id: 'nora_demo', karma: 310 },
      'item/41': STORY,
      'item/42': { ...COMMENT, kids: [46, 47] },
      'item/40': { id: 40, type: 'comment', time: NOW / 1000 - 9000, deleted: true },
      'item/39': { id: 39, type: 'story', time: NOW / 1000 - 9900, title: 'Show HN: Mine', dead: true },
    })
    const { counts, account } = hackerNewsReader
    if (!counts || !account) throw new Error('the Hacker News reader reads numbers')
    const asked = (['41', '42', '40', '39'] as const).map(
      (externalId) => ({ externalId, kind: externalId === '42' ? 'reply' : 'post', postedAt: NOW }) as const
    )
    expect(await counts(asked)).toEqual([
      { externalId: '41', counts: { platform: 'hackernews', score: 57, replies: 12 } },
      // Hacker News shows no comment's score.
      { externalId: '42', counts: { platform: 'hackernews', score: null, replies: 2 } },
      // Killed by moderators or flags: removed. One its author deleted is just gone.
      { externalId: '39', removed: true },
    ])
    expect(await account('nora_demo')).toEqual({ platform: 'hackernews', karma: 310 })
  })

  it("reads the account's newest stories and comments as its history, leaving out what was removed", async () => {
    stubFirebase({
      'user/nora_demo': { id: 'nora_demo', karma: 310, submitted: [41, 42, 40, 39] },
      'item/41': STORY,
      'item/42': COMMENT,
      'item/40': { id: 40, type: 'comment', time: NOW / 1000 - 9000, deleted: true },
      'item/39': { id: 39, type: 'pollopt', time: NOW / 1000 - 9900, text: 'Yes' },
    })
    const reader = hackerNewsReader.activity
    if (!reader) throw new Error('the Hacker News reader reads activity')
    expect(await reader({ handle: 'nora_demo', since: 0, niche: 'n8n', pillars: ['n8n'], now: NOW })).toEqual([
      {
        externalId: '41',
        parts: ['Show HN: Retries that never run twice'],
        postedAt: NOW - 3_600_000,
        likes: 57,
        reposts: 0,
        replies: 12,
        parentId: null,
        url: 'https://news.ycombinator.com/item?id=41',
        community: 'Show HN',
        lang: null,
      },
      {
        externalId: '42',
        parts: ["Use an idempotency key.\n\nIt's the only fix."],
        postedAt: NOW - 7_200_000,
        likes: 0,
        reposts: 0,
        replies: 0,
        parentId: '7',
        url: 'https://news.ycombinator.com/item?id=42',
        community: 'Hacker News',
        lang: null,
      },
    ])
  })

  it('reads only what was posted since the time asked, and asks for no batch past it', async () => {
    // Forty items, one an hour, newest first: the first batch of twenty reaches past three hours ago, so no second is asked for.
    const ids = Array.from({ length: 40 }, (_, index) => 100 - index)
    const items = Object.fromEntries(ids.map((id, index) => [`item/${id}`, { ...COMMENT, id, time: NOW / 1000 - (index + 1) * 3600 }]))
    const asked = stubFirebase({ 'user/nora_demo': { id: 'nora_demo', karma: 310, submitted: ids }, ...items })
    const reader = hackerNewsReader.activity
    if (!reader) throw new Error('the Hacker News reader reads activity')
    const posts = await reader({ handle: 'nora_demo', since: NOW - 3 * 3_600_000, niche: 'n8n', pillars: ['n8n'], now: NOW })
    expect(posts.map((post) => post.externalId)).toEqual(['100', '99', '98'])
    expect(asked.filter((path) => path.startsWith('item/'))).toHaveLength(20)
  })

  it('refuses a username Hacker News does not know, by name', async () => {
    stubFirebase({})
    const reader = hackerNewsReader.activity
    if (!reader) throw new Error('the Hacker News reader reads activity')
    await expect(reader({ handle: 'nobody_here', since: 0, niche: 'n8n', pillars: ['n8n'], now: NOW })).rejects.toThrow(
      'Hacker News has no user named nobody_here.'
    )
  })

  it('reads the comments directly under each item since the time asked, with who wrote them, skipping those read before', async () => {
    const asked = stubFirebase({
      'item/41': STORY,
      'item/43': { id: 43, type: 'comment', time: NOW / 1000 - 600, text: 'Which queue is that?', by: 'dana' },
      'item/44': { id: 44, type: 'comment', time: NOW / 1000 - 30 * 86_400, text: 'Old news.', by: 'tom' },
    })
    const reader = hackerNewsReader.comments
    if (!reader) throw new Error('the Hacker News reader reads comments')
    expect(await reader({ items: ['41'], since: NOW - 86_400_000, known: new Set(['45']) })).toEqual([
      {
        externalId: '43',
        parentId: '41',
        author: { handle: 'dana', name: 'dana' },
        text: 'Which queue is that?',
        url: 'https://news.ycombinator.com/item?id=43',
        community: 'Hacker News',
        likes: 0,
        at: NOW - 600_000,
      },
    ])
    expect(asked).not.toContain('item/45')
  })
})

describe('hnText', () => {
  it('keeps paragraphs, writes a link as its address and decodes what Hacker News escapes', () => {
    expect(
      hnText(
        'See <a href="https:&#x2F;&#x2F;n8n.io&#x2F;docs" rel="nofollow">n8n.io&#x2F;docs</a><p><i>Retry</i> &quot;once&quot; &amp; log'
      )
    ).toBe('See https://n8n.io/docs\n\nRetry "once" & log')
  })
})

describe('the Hacker News search', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('finds stories as threads, an Ask HN in its own community', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          hits: [
            {
              objectID: '41',
              title: 'Ask HN: How do you retry webhooks?',
              url: null,
              author: 'dana',
              story_text: 'Mine run twice.<p>Ideas?',
              points: 12,
              num_comments: 4,
              created_at_i: NOW / 1000 - 600,
            },
          ],
        })
      )
    )
    const search = hackerNewsReader.search
    if (!search) throw new Error('the Hacker News reader searches')
    expect(await search({ terms: ['webhooks'], since: 0, limit: 5, communities: null, sponsorName: 'Formstep' })).toEqual([
      {
        externalId: '41',
        url: 'https://news.ycombinator.com/item?id=41',
        title: 'Ask HN: How do you retry webhooks?',
        text: 'Mine run twice.\n\nIdeas?',
        postedAt: NOW - 600_000,
        author: { handle: 'dana', name: 'dana' },
        reach: 12,
        community: 'Ask HN',
        comments: 4,
        topics: ['webhooks'],
      },
    ])
  })
})
