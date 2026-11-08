import { PLATFORMS, PLATFORM_IN_WORDS, type Platform } from './platforms'

/**
 * Probable conversions (CONTEXT.md, "Probable conversion"): a sponsor's
 * conversion with no UTM parameters whose person said they heard of the
 * sponsor on a platform (the product's `heard_about_us` event), or first
 * arrived from a platform's domain. Most readers search for the sponsor
 * instead of clicking, so these are likely the larger share, but they name
 * a platform, never an account or a post: the report shows them apart and
 * labeled, and no experiment or strategy rule reads them.
 */

/** Why a conversion is probably a platform's: what the person said, or where they first came from. */
export const PROBABLE_BASES = ['heard_about_us', 'referrer'] as const
export type ProbableBasis = (typeof PROBABLE_BASES)[number]

/**
 * The domains a visitor arrives from on each platform; a subdomain counts
 * (old.reddit.com, www.linkedin.com). Every forum is its own site, so a
 * forum's are the hosts of the workspace's forums (shared `forumHost`).
 */
export const PLATFORM_REFERRING_DOMAINS: Record<Exclude<Platform, 'forum'>, readonly string[]> = {
  reddit: ['reddit.com'],
  hackernews: ['news.ycombinator.com'],
  x: ['t.co', 'x.com', 'twitter.com'],
  linkedin: ['linkedin.com', 'lnkd.in'],
}

/** The platform a first referring domain belongs to, the workspace's forums' hosts among them, or null for any other site, or none. */
export function platformOfReferrer(domain: string, forumHosts: readonly string[]): Platform | null {
  const host = domain.trim().toLowerCase()
  const known = (name: string) => host === name || host.endsWith(`.${name}`)
  const domains = (platform: Platform) => (platform === 'forum' ? forumHosts : PLATFORM_REFERRING_DOMAINS[platform])
  return PLATFORMS.find((platform) => domains(platform).some(known)) ?? null
}

/**
 * Each platform's names long enough that one letter off is still that name
 * and no other word: "redit", "linkedn", "hacker newz". Written apart they
 * count as one ("linked in").
 */
const LONG_NAMES: Record<Platform, readonly string[]> = {
  reddit: ['reddit'],
  hackernews: ['hackernews', 'ycombinator'],
  x: ['twitter'],
  linkedin: ['linkedin'],
  forum: [],
}

/**
 * What else names a platform, read only as written, since one letter off it
 * is any word: a subreddit, "hn", "x", a tweet, a forum ("form" is one letter
 * off it).
 */
const SHORT_NAMES: Record<Platform, RegExp | null> = {
  reddit: /\br\/\w+/i,
  hackernews: /\bhn\b/i,
  x: /\bx\.com\b|^x$|\bon x\b|\btweet/i,
  linkedin: null,
  forum: /\bforums?\b/i,
}

/**
 * The platform an answer to "where did you hear about us" names, as written
 * or misspelled by a letter, or null when it names none or more than one: an
 * answer that names another place (a friend, a search) is no conversion of
 * these platforms.
 */
export function platformOfHeardAbout(answer: string): Platform | null {
  const words = wordsOf(answer)
  const names = (platform: Platform) =>
    SHORT_NAMES[platform]?.test(answer.trim()) === true ||
    LONG_NAMES[platform].some((name) => words.some((word) => oneLetterOff(word, name)))
  const named = PLATFORMS.filter(names)
  const [only] = named
  return named.length === 1 && only !== undefined ? only : null
}

/** An answer's words, lower case, and each two in a row written together, since "hacker news" and "linked in" are one name. */
function wordsOf(answer: string): string[] {
  const words = answer
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean)
  return [...words, ...words.slice(1).map((word, index) => `${words[index]}${word}`)]
}

/** Whether a word is the name, or the name with one letter added, dropped, changed, or two side by side swapped. */
function oneLetterOff(word: string, name: string): boolean {
  if (Math.abs(word.length - name.length) > 1) return false
  let start = 0
  while (start < word.length && word[start] === name[start]) start += 1
  if (start === word.length && word.length === name.length) return true
  const rest = (a: number, b: number) => word.slice(start + a) === name.slice(start + b)
  return rest(1, 0) || rest(0, 1) || rest(1, 1) || (word[start] === name[start + 1] && word[start + 1] === name[start] && rest(2, 2))
}

/** How the report names what a probable conversion rests on, for one platform. */
export function probableBasisText(platform: Platform, basis: ProbableBasis): string {
  if (basis === 'heard_about_us') return `said they heard of it on ${PLATFORM_IN_WORDS[platform]}`
  if (platform === 'forum') return 'first came from the site of one of your forums'
  return `first came from ${PLATFORM_REFERRING_DOMAINS[platform].join(' or ')}`
}
