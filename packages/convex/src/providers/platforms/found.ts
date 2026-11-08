import type { FoundThread } from './types'

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
