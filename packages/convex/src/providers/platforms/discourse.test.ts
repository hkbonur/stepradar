import { afterEach, describe, expect, it, vi } from 'vitest'
import { discourseForumAt, discourseReader, discourseText } from './discourse'

const NOW = Date.UTC(2026, 9, 23, 9)
const FORUM = { origin: 'https://community.n8n.io', name: 'n8n Community', software: 'discourse' as const }

/** The forum's pages by path (with its query, or without it when any query will do); any other page is a 404. */
function stubForum(pages: Record<string, unknown>): string[] {
  const asked: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL) => {
      const url = new URL(String(input))
      const path = `${url.pathname}${url.search}`
      asked.push(path)
      const page = pages[path] ?? pages[url.pathname]
      if (page === undefined) return new Response('not found', { status: 404 })
      return typeof page === 'string' ? new Response(page) : Response.json(page)
    })
  )
  return asked
}

/** A post as Discourse shows it to a visitor, trimmed to what the reader reads. */
function post(postNumber: number, fields: Record<string, unknown> = {}) {
  return {
    id: 600_000 + postNumber,
    post_number: postNumber,
    post_type: 1,
    username: 'dana',
    name: 'Dana Ruiz',
    created_at: new Date(NOW - 3_600_000).toISOString(),
    cooked: `<p>Answer ${postNumber}</p>`,
    reads: 40,
    reply_count: 0,
    actions_summary: [{ id: 2, count: 3 }],
    ...fields,
  }
}

const CATEGORIES = {
  category_list: {
    categories: [
      {
        id: 12,
        name: 'Questions',
        description_text: 'For troubleshooting issues. Share your workflow.',
        subcategory_list: [{ id: 7, name: 'Nodes', description_text: null }],
      },
      { id: 15, name: 'Built with n8n', description_text: 'Show off what you built.' },
    ],
  },
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('finding a forum', () => {
  it('reads a public Discourse forum by its title, and any other site as other software named by its host', async () => {
    stubForum({ '/site/basic-info.json': { title: 'n8n Community', login_required: false } })
    expect(await discourseForumAt('https://community.n8n.io')).toEqual(FORUM)
    stubForum({ '/site/basic-info.json': '<!DOCTYPE html><html></html>' })
    expect(await discourseForumAt('https://community.zapier.com')).toEqual({
      origin: 'https://community.zapier.com',
      name: 'community.zapier.com',
      software: 'other',
    })
  })

  it('refuses a forum that asks visitors to sign in, and one it cannot reach', async () => {
    stubForum({ '/site/basic-info.json': { title: 'Acme Insiders', login_required: true } })
    await expect(discourseForumAt('https://insiders.acme.example')).rejects.toThrow(
      'Acme Insiders asks visitors to sign in, and Influstep reads only forums anyone can read.'
    )
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed')
      })
    )
    await expect(discourseForumAt('https://gone.example.com')).rejects.toThrow('Influstep could not reach gone.example.com: fetch failed')
  })
})

describe('the Discourse search', () => {
  it("finds topics by their first post, in their category, kept to the account's categories when asked", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
    const asked = stubForum({
      '/categories.json': CATEGORIES,
      '/search.json': {
        posts: [
          {
            username: 'dana',
            name: 'Dana Ruiz',
            created_at: new Date(NOW - 600_000).toISOString(),
            like_count: 4,
            blurb: 'Retries run twice &gt; why?',
            post_number: 1,
            topic_id: 41,
          },
          {
            username: 'kai',
            name: '',
            created_at: new Date(NOW - 900_000).toISOString(),
            like_count: 9,
            blurb: 'Look at the node',
            post_number: 3,
            topic_id: 41,
          },
          {
            username: 'mira',
            name: null,
            created_at: new Date(NOW - 1_200_000).toISOString(),
            like_count: 1,
            blurb: 'My form bot',
            post_number: 1,
            topic_id: 42,
          },
        ],
        topics: [
          { id: 41, title: 'Form webhook runs twice', slug: 'form-webhook-runs-twice', posts_count: 5, category_id: 7 },
          { id: 42, title: 'I built a form bot', slug: 'i-built-a-form-bot', posts_count: 1, category_id: 15 },
        ],
      },
    })
    const search = discourseReader(FORUM).search
    if (!search) throw new Error('the Discourse reader searches')
    const query = { terms: ['webhooks'], since: NOW - 2 * 86_400_000, limit: 5, communities: null, sponsorName: 'Formstep' }
    expect(await search(query)).toEqual([
      {
        externalId: '41',
        url: 'https://community.n8n.io/t/form-webhook-runs-twice/41',
        title: 'Form webhook runs twice',
        text: 'Retries run twice > why?',
        postedAt: NOW - 600_000,
        author: { handle: 'dana', name: 'Dana Ruiz' },
        reach: 4,
        community: 'Nodes',
        comments: 4,
        topics: ['webhooks'],
      },
      expect.objectContaining({ externalId: '42', community: 'Built with n8n', author: { handle: 'mira', name: 'mira' } }),
    ])
    expect(decodeURIComponent(asked.find((path) => path.startsWith('/search.json')) ?? '')).toBe(
      '/search.json?q=webhooks after:2026-10-21 in:first order:latest'
    )
    expect((await search({ ...query, communities: ['nodes'] })).map((thread) => thread.externalId)).toEqual(['41'])
  })
})

describe("the account's own posts", () => {
  it('reads its topics and replies, a reply by its number in the topic, one cut short read whole, and stops at the first older page', async () => {
    const action = (fields: Record<string, unknown>) => ({
      action_type: 5,
      created_at: new Date(NOW - 3_600_000).toISOString(),
      excerpt: 'Set the retry to once',
      truncated: false,
      slug: 'form-webhook-runs-twice',
      topic_id: 41,
      post_number: 4,
      post_id: 604,
      reply_to_post_number: null,
      title: 'Form webhook runs twice',
      category_id: 12,
      ...fields,
    })
    const asked = stubForum({
      '/categories.json': CATEGORIES,
      '/user_actions.json': {
        user_actions: [
          action({
            action_type: 4,
            post_number: 1,
            post_id: 601,
            topic_id: 50,
            slug: 'retries-in-one-place',
            title: 'Retries in one place',
            excerpt: 'Here is how',
            truncated: true,
          }),
          action({}),
          action({ post_number: 6, post_id: 606, reply_to_post_number: 3 }),
          action({ post_number: 2, post_id: 602, created_at: new Date(NOW - 30 * 86_400_000).toISOString() }),
        ],
      },
      '/posts/601.json': post(1, { cooked: '<p>Here is how I keep retries in one place.</p><p>One error workflow.</p>' }),
    })
    const activity = discourseReader(FORUM).activity
    if (!activity) throw new Error('the Discourse reader reads the account')
    const items = await activity({ handle: 'ada', since: NOW - 7 * 86_400_000, niche: 'n8n', pillars: [], now: NOW })
    expect(items).toEqual([
      expect.objectContaining({
        externalId: '50',
        parts: ['Retries in one place\n\nHere is how I keep retries in one place.\n\nOne error workflow.'],
        parentId: null,
        url: 'https://community.n8n.io/t/retries-in-one-place/50',
        community: 'Questions',
      }),
      expect.objectContaining({
        externalId: '41/4',
        parts: ['Set the retry to once'],
        parentId: '41',
        url: 'https://community.n8n.io/t/form-webhook-runs-twice/41/4',
      }),
      expect.objectContaining({ externalId: '41/6', parentId: '41/3' }),
    ])
    expect(asked.filter((path) => path.startsWith('/user_actions.json'))).toHaveLength(1)
  })
})

describe('the comments under the account’s items', () => {
  it('reads every post after the last one read in its topic, and the replies to one of its replies, leaving out the forum’s own notes', async () => {
    const asked = stubForum({
      '/t/50/posts.json?post_number=3&asc=true': {
        post_stream: {
          posts: [post(4), post(5, { post_type: 3, cooked: '<p>closed the topic</p>' }), post(6, { username: 'kai', name: '' })],
        },
      },
      '/t/50/posts.json?post_number=6&asc=true': { post_stream: { posts: [] } },
      '/posts/by_number/41/4.json': post(4, { id: 604 }),
      '/posts/604/replies.json': [post(7, { username: 'mira', cooked: '<p>Thanks, that worked!</p>' })],
    })
    const comments = discourseReader(FORUM).comments
    if (!comments) throw new Error('the Discourse reader reads comments')
    const read = await comments({ items: ['50', '41/4'], since: NOW - 7 * 86_400_000, known: new Set(['50/3']) })
    expect(read.map((comment) => [comment.externalId, comment.parentId, comment.author.handle])).toEqual([
      ['50/4', '50', 'dana'],
      ['50/6', '50', 'kai'],
      ['41/7', '41/4', 'mira'],
    ])
    expect(read[2]).toMatchObject({ text: 'Thanks, that worked!', url: 'https://community.n8n.io/t/41/7', likes: 3 })
    expect(asked).toContain('/t/50/posts.json?post_number=6&asc=true')
  })
})

describe('the numbers of the account’s items', () => {
  it('reads a topic by its first post and a reply by its number, a hidden one as removed, and leaves out one gone', async () => {
    stubForum({
      '/t/50.json': {
        id: 50,
        slug: 'retries-in-one-place',
        posts_count: 6,
        visible: true,
        post_stream: { posts: [post(1, { reads: 120 })] },
      },
      '/posts/by_number/41/4.json': post(4, { reads: 33, reply_count: 2, actions_summary: [] }),
      '/posts/by_number/41/6.json': post(6, { hidden: true }),
    })
    const counts = discourseReader(FORUM).counts
    if (!counts) throw new Error('the Discourse reader reads numbers')
    const asked = (externalId: string) => ({ externalId, kind: 'reply' as const, postedAt: NOW })
    expect(await counts([asked('50'), asked('41/4'), asked('41/6'), asked('41/9')])).toEqual([
      { externalId: '50', counts: { platform: 'forum', reads: 120, likes: 3, replies: 5 } },
      { externalId: '41/4', counts: { platform: 'forum', reads: 33, likes: 0, replies: 2 } },
      { externalId: '41/6', removed: true },
    ])
  })

  it("reads the account's likes, and names a user the forum does not have", async () => {
    stubForum({ '/u/ada/summary.json': { user_summary: { likes_received: 412, post_count: 90 } } })
    const account = discourseReader(FORUM).account
    if (!account) throw new Error('the Discourse reader reads the account')
    expect(await account('ada')).toEqual({ platform: 'forum', likesReceived: 412 })
    await expect(account('nobody')).rejects.toThrow('n8n Community has no user named nobody.')
  })
})

describe("a category's rules", () => {
  it("are the forum's guidelines and the category's own description", async () => {
    stubForum({
      '/categories.json': CATEGORIES,
      '/guidelines': [
        '<html><body><ul><li>Privacy</li></ul>',
        "<div itemprop='mainContentOfPage'>",
        '<h2>Always Be Civil</h2><ul><li>Respect our forum. Don’t post spam or otherwise vandalize the forum.</li></ul>',
        '</div><footer>Powered by Discourse</footer></body></html>',
      ].join(''),
    })
    const rules = discourseReader(FORUM).rules
    if (!rules) throw new Error('the Discourse reader reads rules')
    expect(await rules('questions')).toBe(
      'Always Be Civil\n\nRespect our forum. Don’t post spam or otherwise vandalize the forum.\n\nQuestions: For troubleshooting issues. Share your workflow.'
    )
  })
})

describe('discourseText', () => {
  it('ends a line at a paragraph, a break or a list item, keeps a link’s text and decodes what Discourse escapes', () => {
    expect(
      discourseText('<p>Use the <a href="/t/x/1" class="mention">@kai</a> fix &amp; log</p><ul><li>once</li></ul>A<br>B &hellip;')
    ).toBe('Use the @kai fix & log\n\nonce\n\nA\nB …')
  })
})

describe('a forum that asks the reader to slow down', () => {
  it('waits as long as it says and tries once more, and fails a read it limits again', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    let calls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls += 1
        if (calls === 1) return new Response('slow down', { status: 429, headers: { 'Retry-After': '2' } })
        return Response.json({ user_summary: { likes_received: 7 } })
      })
    )
    const account = discourseReader(FORUM).account
    if (!account) throw new Error('the Discourse reader reads the account')
    const read = account('ada')
    await vi.advanceTimersByTimeAsync(2_000)
    expect(await read).toEqual({ platform: 'forum', likesReceived: 7 })

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('slow down', { status: 429, headers: { 'Retry-After': '2' } }))
    )
    const limited = account('ada')
    const failed = expect(limited).rejects.toThrow('n8n Community limits how fast a visitor reads it; the next read tries again.')
    await vi.advanceTimersByTimeAsync(2_000)
    await failed
  })
})

describe('where a pasted topic was said', () => {
  it("reads a topic's category from the topic, the categories once for the reader", async () => {
    const asked = stubForum({
      '/categories.json': CATEGORIES,
      '/t/41.json': { id: 41, slug: 'form-webhook-runs-twice', posts_count: 5, category_id: 7, post_stream: { posts: [post(1)] } },
      '/guidelines': "<div itemprop='mainContentOfPage'><p>Be civil.</p></div><footer></footer>",
    })
    const reader = discourseReader(FORUM)
    if (!reader.community || !reader.rules) throw new Error('the Discourse reader says where a topic was said, and reads rules')
    expect(await reader.community('41/7')).toBe('Nodes')
    await reader.rules('Questions')
    await reader.rules('Nodes')
    expect(asked.filter((path) => path.startsWith('/categories.json'))).toHaveLength(1)
    expect(asked.filter((path) => path === '/guidelines')).toHaveLength(1)
    await expect(reader.community('99')).rejects.toThrow('n8n Community has no topic 99.')
  })
})
