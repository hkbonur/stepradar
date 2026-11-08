import type { FoundSignal, SearchQuery } from '../platforms/types'

/** What people type into a search box about the account's terms: signals of source `search`, from no platform. */
export interface SuggestionsProvider {
  readonly name: string
  find(query: SuggestionsQuery): Promise<FoundSignal[]>
}

/** The terms to suggest for, and how many suggestions at most; a suggestion has no post time to filter by. */
export type SuggestionsQuery = Pick<SearchQuery, 'terms' | 'limit'>
