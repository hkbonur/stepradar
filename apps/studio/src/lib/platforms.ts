import { PLATFORMS, PLATFORM_LABELS } from '@influstep/shared'

/**
 * The platforms by name for a sentence: "Reddit, Hacker News, X, LinkedIn
 * and product forums" where Influstep works on all of them, "… LinkedIn or a
 * product forum" where an account is on one. Every forum is its own site, so
 * forums are named as a kind.
 */
export function platformsInWords(type: 'conjunction' | 'disjunction'): string {
  const forums = type === 'conjunction' ? 'product forums' : 'a product forum'
  const names = PLATFORMS.map((platform) => (platform === 'forum' ? forums : PLATFORM_LABELS[platform]))
  return new Intl.ListFormat('en-GB', { style: 'long', type }).format(names)
}
