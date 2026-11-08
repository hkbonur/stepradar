import type { Platform } from './platforms'
import { PLATFORM_DRAFT_SHAPES } from './replies'

/** How much two sets overlap: the members they share over all their members (Jaccard); 0 when either is empty. */
export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let shared = 0
  for (const member of a) if (b.has(member)) shared += 1
  return shared / (a.size + b.size - shared)
}

/** How many words a shingle spans. */
const SHINGLE_WORDS = 3

/** The words a text is compared by: lower-case letters and digits, its links left out. */
function wordsOf(text: string): string[] {
  return (
    text
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, ' ')
      .match(/[\p{L}\p{N}]+/gu) ?? []
  )
}

function shinglesOf(words: string[], size: number): Set<string> {
  const shingles = new Set<string>()
  for (let start = 0; start + size <= words.length; start += 1) shingles.add(words.slice(start, start + size).join(' '))
  return shingles
}

/**
 * How alike two texts are, from 0 to 1: the overlap of their normalized word
 * shingles, runs of SHINGLE_WORDS words (fewer when a text is shorter). The
 * match breaks a tie with it; an edit share is what it leaves.
 */
export function textSimilarity(a: string, b: string): number {
  const left = wordsOf(a)
  const right = wordsOf(b)
  const size = Math.min(SHINGLE_WORDS, left.length, right.length)
  if (size === 0) return 0
  return jaccard(shinglesOf(left, size), shinglesOf(right, size))
}

/**
 * How much of `source` a text repeats, from 0 to 1: the share of the
 * source's word shingles found in it. Unlike `textSimilarity`, a long text
 * that quotes a short source whole repeats all of it.
 */
export function repeatedShare(source: string, text: string): number {
  const sourceWords = wordsOf(source)
  const size = Math.min(SHINGLE_WORDS, sourceWords.length)
  if (size === 0) return 0
  const quoted = shinglesOf(sourceWords, size)
  const said = shinglesOf(wordsOf(text), size)
  let repeated = 0
  for (const shingle of quoted) if (said.has(shingle)) repeated += 1
  return repeated / quoted.size
}

/**
 * How much of a draft the operator changed before posting it, from 0 (posted
 * as written) to 1. Only where the draft is ready to post (X and LinkedIn):
 * on Reddit and Hacker News the operator is meant to rewrite it, so the
 * number means nothing there and is null.
 */
export function editShareOf(platform: Platform, draft: string, posted: string): number | null {
  if (PLATFORM_DRAFT_SHAPES[platform] !== 'text') return null
  return 1 - textSimilarity(draft, posted)
}
