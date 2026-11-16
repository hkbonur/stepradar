import type { FoundThread, PlatformReader } from './types'

/** How much a thread moves: its reach and twice its comments. */
export function threadMoves(thread: FoundThread): number {
  return thread.reach + thread.comments * 2
}

/**
 * What a search found over several terms, ready to read: a thread found by
 * two terms once, with both among its topics, the one that moves most
 * first, at most `limit` of them.
 */
export function rankFound(found: FoundThread[], limit: number): FoundThread[] {
  const seen = new Map<string, FoundThread>()
  for (const thread of found) {
    const existing = seen.get(thread.externalId)
    seen.set(thread.externalId, existing ? { ...existing, topics: [...new Set([...existing.topics, ...thread.topics])] } : thread)
  }
  return [...seen.values()].sort((a, b) => threadMoves(b) - threadMoves(a)).slice(0, limit)
}

/**
 * The groups of terms a reader's search is asked, one query each: the
 * account's own terms, then the sponsor's profile's (shared
 * `profileSearchTerms`). Each query keeps its own limit, so a loose profile
 * term never crowds a pillar's thread out before the classifier reads it. A
 * group with no term is not asked. A reader that ignores the terms is asked
 * once, with the account's own.
 */
export function askedTerms(reader: Pick<PlatformReader, 'searchIgnoresTerms'>, own: string[], profile: string[]): string[][] {
  if (reader.searchIgnoresTerms) return [own]
  return [own, profile].filter((terms) => terms.length > 0)
}

/**
 * What a reader finds for an account: one query for each group of terms it
 * is asked (`askedTerms`), one after the other since they read one platform,
 * as one list. The account's own threads come first, in the order their
 * query found them, so a search with no profile finds what it found before
 * there was one; the profile's follow, and a thread both found is kept once,
 * in its first place, with the topics of both.
 */
export async function searchTermGroups(
  reader: Pick<PlatformReader, 'searchIgnoresTerms'>,
  terms: { own: string[]; profile: string[] },
  search: (terms: string[]) => Promise<FoundThread[]>
): Promise<FoundThread[]> {
  const found = new Map<string, FoundThread>()
  for (const group of askedTerms(reader, terms.own, terms.profile)) {
    for (const thread of await search(group)) {
      const first = found.get(thread.externalId)
      found.set(thread.externalId, first ? { ...first, topics: [...new Set([...first.topics, ...thread.topics])] } : thread)
    }
  }
  return [...found.values()]
}
