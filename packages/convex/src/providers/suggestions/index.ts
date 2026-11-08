import { providersMode } from '../../lib/env'
import { googleSuggestions } from './google'
import { mockSuggestions } from './mock'
import type { SuggestionsProvider } from './types'

/** Google's autocomplete in real mode: an unofficial endpoint that needs no key (google.ts). */
export function suggestionsProvider(): SuggestionsProvider {
  return providersMode() === 'mock' ? mockSuggestions : googleSuggestions
}
