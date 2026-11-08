import { afterEach, describe, expect, it, vi } from 'vitest'
import { mockSearch } from '../platforms/mock/search'
import { googleSuggestions } from './google'
import { mockSuggestions } from './mock'

const NOW = Date.UTC(2026, 9, 13, 6, 15)
const DAY_MS = 86_400_000

/** Google's answer to each query the adapter asks, keyed by the query. */
function stubSuggestions(answers: Record<string, string[]>): string[] {
  const asked: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: URL) => {
      const query = input.searchParams.get('q') ?? ''
      asked.push(query)
      return new Response(JSON.stringify([query, answers[query] ?? []]), { status: 200 })
    })
  )
  return asked
}

describe('search suggestions', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('asks for each of the first four terms and its how-to, and scores a suggestion by its place in its own list', async () => {
    vi.useFakeTimers({ now: NOW })
    const asked = stubSuggestions({
      'n8n tutorials': ['n8n tutorials', 'n8n tutorials for beginners'],
      'how to n8n tutorials': ['how to n8n tutorials'],
    })
    const found = await googleSuggestions.find({ terms: ['n8n tutorials', 'b', 'c', 'd', 'e'], limit: 10 })
    expect(asked).toEqual(['n8n tutorials', 'how to n8n tutorials', 'b', 'how to b', 'c', 'how to c', 'd', 'how to d'])
    expect(found).toEqual([
      {
        source: 'search',
        externalId: 'n8n tutorials',
        title: 'n8n tutorials',
        url: 'https://www.google.com/search?q=n8n%20tutorials',
        summary: 'People type "n8n tutorials" into Google.',
        score: 70,
        topics: ['n8n', 'tutorials'],
        publishedAt: NOW,
      },
      expect.objectContaining({ externalId: 'how to n8n tutorials', score: 70 }),
      expect.objectContaining({ externalId: 'n8n tutorials for beginners', score: 65 }),
    ])
  })

  it('keeps a suggestion once whatever its case, and never more than the limit', async () => {
    stubSuggestions({
      n8n: ['n8n webhook', 'n8n pricing', 'n8n docker', 'n8n vs zapier', 'n8n self hosted', 'n8n cloud', 'n8n api', 'n8n ai', 'n8n login'],
      'how to n8n': ['N8N Webhook', 'how to n8n'],
    })
    const all = await googleSuggestions.find({ terms: ['n8n'], limit: 20 })
    expect(all.map((signal) => signal.externalId).filter((id) => id === 'n8n webhook')).toHaveLength(1)
    // Rank 8 and below floors at 30.
    expect(all.find((signal) => signal.externalId === 'n8n login')?.score).toBe(30)
    expect(await googleSuggestions.find({ terms: ['n8n'], limit: 3 })).toHaveLength(3)
  })

  it('throws naming the status when Google answers with anything but the suggestions', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('slow down', { status: 429, statusText: 'Too Many Requests' }))
    )
    await expect(googleSuggestions.find({ terms: ['n8n'], limit: 5 })).rejects.toThrow(
      'Google search suggestions failed: 429 Too Many Requests'
    )
  })
})

describe('mock signals', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('suggests how-tos and comparisons from the terms, found within the last day', async () => {
    vi.useFakeTimers({ now: NOW })
    const found = await mockSuggestions.find({
      terms: ['n8n tutorials', 'AI agent workflows', 'Automation fails'],
      limit: 5,
    })
    expect(found.map((signal) => signal.title)).toEqual([
      'how to get started with n8n tutorials',
      'n8n tutorials vs zapier',
      'how to get started with ai agent workflows',
      'ai agent workflows vs make',
    ])
    for (const signal of found) {
      expect(signal.source).toBe('search')
      expect(signal.publishedAt).toBeGreaterThan(NOW - DAY_MS)
      expect(signal.publishedAt).toBeLessThanOrEqual(NOW)
    }
  })

  it("spreads a source's stories over the last three days", async () => {
    vi.useFakeTimers({ now: NOW })
    const found = await mockSearch('hackernews')({ terms: ['n8n'], since: 0, limit: 5, communities: null, sponsorName: 'Formstep' })
    const ages = found.map((signal) => NOW - signal.postedAt)
    expect(ages).toHaveLength(3)
    for (const age of ages) {
      expect(age).toBeGreaterThan(0)
      expect(age).toBeLessThan(3 * DAY_MS)
    }
    expect(new Set(ages.map((age) => Math.floor(age / DAY_MS))).size).toBe(3)
  })
})
