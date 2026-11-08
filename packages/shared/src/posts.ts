import type { PlatformFormat } from './formats'
import type { Platform } from './platforms'

/**
 * How a platform counts a post, when a day's posts are due, and a post's
 * hook. A post is exactly the parts the writer wrote, which the operator
 * posts by hand; what each platform takes is in post-rules.ts.
 */

export const X_POST_LIMIT = 280
export const THREAD_PARTS_MIN = 2
export const THREAD_PARTS_MAX = 6

/** X shortens every link to a t.co URL of this many characters, whatever the link's own length. */
const X_URL_WEIGHT = 23
const URL_PATTERN = /https?:\/\/\S+/g

/**
 * A post's length the way X counts it: every link weighs 23, everything else
 * one per code point. X also weighs some scripts (CJK, for one) double;
 * accounts write English, so that rule is left out.
 */
export function xLength(text: string): number {
  let length = 0
  let from = 0
  for (const match of text.matchAll(URL_PATTERN)) {
    length += Array.from(text.slice(from, match.index)).length + X_URL_WEIGHT
    from = match.index + match[0].length
  }
  return length + Array.from(text.slice(from)).length
}

/** A text's length as its platform counts it: X weighs links (xLength), the others count code points. */
export function platformLength(text: string, platform: Platform): number {
  return platform === 'x' ? xLength(text) : [...text].length
}

/**
 * The local hours a day's posts are due: three hours apart from the X
 * format's publish hour. A late publish hour slides the whole day earlier so the last
 * post still lands before midnight.
 */
export function postSlotHours(format: Pick<PlatformFormat, 'publishHour' | 'cadence'>): number[] {
  const hours = Array.from({ length: format.cadence.postsPerDay }, (_, index) => format.publishHour + 3 * index)
  const last = hours.at(-1)
  if (last === undefined) return []
  const excess = Math.max(0, last - 23)
  return hours.map((hour) => Math.max(0, hour - excess))
}

/** A post's hook (the experiments' unit): the first line of its first part. Writer and editor both store it through here. */
export function postHook(parts: string[]): string {
  const [first] = parts
  if (first === undefined) return ''
  const text = first.trimStart()
  const end = text.indexOf('\n')
  return (end === -1 ? text : text.slice(0, end)).trim()
}
