import type { FoundSignal } from '../platforms/types'
import type { SuggestionsProvider, SuggestionsQuery } from './types'

const HOUR_MS = 3_600_000

/** The tools the account's readers weigh its own subjects against, one per term the mock suggests for. */
const COMPARED_WITH = ['zapier', 'make'] as const

/**
 * Suggestions shaped like the real adapter's (google.ts), made from the
 * first terms: a how-to and a comparison for each, found within the last day.
 */
function suggestionsFor(query: SuggestionsQuery, now: number): FoundSignal[] {
  const suggestions = COMPARED_WITH.flatMap((rival, index) => {
    const term = query.terms[index]
    if (term === undefined) return []
    const subject = term.toLowerCase()
    const topics = subject.split(/\s+/).filter((word) => word !== '')
    return [`how to get started with ${subject}`, `${subject} vs ${rival}`].map((suggestion) => ({ suggestion, topics }))
  })
  return suggestions.slice(0, query.limit).map((entry, rank) => ({
    source: 'search',
    externalId: entry.suggestion,
    title: entry.suggestion,
    url: `https://www.google.com/search?q=${encodeURIComponent(entry.suggestion)}`,
    summary: `People type "${entry.suggestion}" into Google.`,
    score: Math.max(30, 70 - rank * 5),
    topics: entry.topics,
    publishedAt: now - (2 + rank * 4) * HOUR_MS,
  }))
}

export const mockSuggestions: SuggestionsProvider = {
  name: 'mock',
  async find(query) {
    return suggestionsFor(query, Date.now())
  },
}
