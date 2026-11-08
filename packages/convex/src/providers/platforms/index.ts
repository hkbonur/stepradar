import { forumHost, needsConnection, type ConnectedPlatform, type Forum, type Platform, type PlatformPlace } from '@influstep/shared'
import { providersMode } from '../../lib/env'
import { discourseForumAt, discourseReader } from './discourse'
import { hackerNewsReader } from './hackernews'
import { mockReader } from './mock'
import { redditReader } from './reddit'
import { REDDIT_KEYS } from './reddit/oauth'
import { READER_CAPABILITIES, type PlatformReader, type ReaderCapability, type ReaderConnection } from './types'

/**
 * The reader of the account's place, as its connection lets it read (core
 * `readerConnectionOf`; null for an account not connected, or for a search
 * that reads for no account). X runs by hand until its API tier is chosen
 * (docs/plan.md, decision 3), and LinkedIn has no read API without partner
 * access, so neither reads anything: each of their steps is manual. A forum
 * on Discourse is read through its public JSON; one on other software reads
 * nothing, like LinkedIn.
 */
export function platformReader(place: PlatformPlace, connection: ReaderConnection | null): PlatformReader {
  return providersMode() === 'mock' ? mockReader(place, connection) : realReader(place, connection)
}

/** The place's real reader whatever the mode, for the Providers page. */
export function realReader(place: PlatformPlace, connection: ReaderConnection | null): PlatformReader {
  switch (place.platform) {
    case 'reddit':
      return redditReader(connection)
    case 'hackernews':
      return hackerNewsReader
    case 'x':
      return { platform: 'x', name: 'none' }
    case 'linkedin':
      return { platform: 'linkedin', name: 'none' }
    case 'forum':
      return place.forum.software === 'discourse' ? discourseReader(place.forum) : { platform: 'forum', name: 'none' }
  }
}

/**
 * The forum at an https origin, as the setup finds it (`discourseForumAt`);
 * in mock mode every forum is a Discourse forum named by its host, so the
 * mock reader reads it.
 */
export async function forumAt(origin: string): Promise<Forum> {
  if (providersMode() === 'mock') return { origin, name: forumHost({ origin }), software: 'discourse' }
  return discourseForumAt(origin)
}

/** The deployment keys a platform's real reader needs: Reddit's OAuth app; the others read without one. */
export function readerKeys(platform: Platform): readonly string[] {
  return needsConnection(platform) ? CONNECTION_KEYS[platform] : []
}

/** The keys each connected platform's OAuth app needs. */
const CONNECTION_KEYS: Record<ConnectedPlatform, readonly string[]> = { reddit: REDDIT_KEYS }

/** What a reader can do, in the order of its contract. */
export function capabilitiesOf(reader: PlatformReader): ReaderCapability[] {
  return READER_CAPABILITIES.filter((capability) => reader[capability] !== undefined)
}

export { MOCK_HISTORY_SIZE, mockXHistory } from './mock/history'
export {
  ConnectionRevoked,
  cannotRead,
  type CommentsQuery,
  type FoundSignal,
  type FoundThread,
  type HeardMention,
  type PlatformComment,
  type PlatformReader,
  type ReaderCapability,
  type ReaderConnection,
  type SearchQuery,
} from './types'
