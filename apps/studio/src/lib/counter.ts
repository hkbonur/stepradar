/**
 * How close a written part is to X's limit, for the character counter
 * (DESIGN.md, Character counter): quiet under 90 percent, near from 90 percent
 * up to the limit itself, over past it.
 */
type CounterTone = 'quiet' | 'near' | 'over'

const NEAR_SHARE = 0.9

export function counterTone(length: number, limit: number): CounterTone {
  if (length > limit) return 'over'
  if (length >= limit * NEAR_SHARE) return 'near'
  return 'quiet'
}
