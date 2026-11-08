import { z } from 'zod'
import type { FoundSignal } from '../platforms/types'
import type { SuggestionsProvider, SuggestionsQuery } from './types'

/**
 * Google's search suggestions: what people type into the search box about a
 * term. The autocomplete endpoint is unofficial and needs no key; Google may
 * change or close it without notice, and then this adapter throws.
 */
const SUGGEST_URL = 'https://suggestqueries.google.com/complete/search'

/** How many of the query's terms are asked about: two requests each, so a sweep stays a handful of calls. */
const TERMS_ASKED = 4

/** The `client=firefox` answer: the query, then the suggestions in Google's order. Anything after them is ignored. */
const responseSchema = z.tuple([z.string(), z.array(z.string())]).rest(z.unknown())

export const googleSuggestions: SuggestionsProvider = {
  name: 'google-suggest',
  async find(query: SuggestionsQuery): Promise<FoundSignal[]> {
    const now = Date.now()
    const seen = new Set<string>()
    const found: FoundSignal[] = []
    for (const term of query.terms.slice(0, TERMS_ASKED)) {
      for (const asked of [term, `how to ${term}`]) {
        const suggestions = await suggestionsFor(asked)
        for (const [rank, suggestion] of suggestions.entries()) {
          const key = suggestion.toLowerCase()
          if (seen.has(key)) continue
          seen.add(key)
          found.push({
            source: 'search',
            externalId: key,
            title: suggestion,
            url: `https://www.google.com/search?q=${encodeURIComponent(suggestion)}`,
            summary: `People type "${suggestion}" into Google.`,
            score: Math.max(30, 70 - rank * 5),
            topics: term.split(/\s+/).filter((word) => word !== ''),
            publishedAt: now,
          })
        }
      }
    }
    return found.sort((a, b) => b.score - a.score).slice(0, query.limit)
  },
}

async function suggestionsFor(asked: string): Promise<string[]> {
  const url = new URL(SUGGEST_URL)
  url.searchParams.set('client', 'firefox')
  url.searchParams.set('hl', 'en')
  url.searchParams.set('q', asked)
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Google search suggestions failed: ${response.status} ${response.statusText}`)
  const [, suggestions] = responseSchema.parse(await response.json())
  return suggestions
}
