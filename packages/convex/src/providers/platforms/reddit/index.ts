import type { ProviderKeys } from '../../../core/keys'
import type { PlatformReader, ReaderConnection } from '../types'
import { redditAccount, redditActivity, redditComments, redditCounts, redditMentions } from './account'
import { redditAppSession, redditSession } from './oauth'
import { redditRules, redditSearch } from './search'

/**
 * Reddit, through its OAuth API: search as the app for any account, and once
 * the operator connected the account, search as it, hear its mentions, and
 * read its own posts and comments, the answers in its inbox, their numbers
 * and its karma, refreshing the grant once per reader. The app's keys are
 * the operator's (core/keys.ts), read where each request is made.
 */
export function redditReader(connection: ReaderConnection | null, keys: ProviderKeys): PlatformReader {
  if (connection === null) {
    const app = redditAppSession(keys)
    return {
      platform: 'reddit',
      name: 'oauth (app)',
      search: (query) => redditSearch(app, query),
      rules: (community) => redditRules(app, community),
    }
  }
  const session = redditSession(keys, connection.refreshToken)
  return {
    platform: 'reddit',
    name: 'oauth',
    search: (query) => redditSearch(session, query),
    mentions: (query) => redditMentions(session, query),
    activity: (query) => redditActivity(session, query),
    comments: (query) => redditComments(session, query),
    counts: (items) => redditCounts(session, items),
    account: (handle) => redditAccount(session, handle),
    rules: (community) => redditRules(session, community),
  }
}
