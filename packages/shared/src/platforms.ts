import { forumHost, type Forum } from './forums'

/** Where an account takes part (CONTEXT.md, "Platform"). */
export const PLATFORMS = ['reddit', 'hackernews', 'x', 'linkedin', 'forum'] as const
export type Platform = (typeof PLATFORMS)[number]

/**
 * The platforms that are one site, by name. Every forum is its own site with
 * its own name, so a forum is named by its place (`placeLabel`), or as a kind
 * (`PLATFORM_KIND_LABELS`, `PLATFORM_IN_WORDS`), never as "Forum" in a
 * sentence about one account.
 */
export const PLATFORM_LABELS: Record<Exclude<Platform, 'forum'>, string> = {
  reddit: 'Reddit',
  hackernews: 'Hacker News',
  x: 'X',
  linkedin: 'LinkedIn',
}

/** Each platform as a kind, where the operator picks one or reads where something came from: "Forum". */
export const PLATFORM_KIND_LABELS: Record<Platform, string> = { ...PLATFORM_LABELS, forum: 'Forum' }

/** Each platform in a sentence about the platform, not one account: "a post on Reddit", "a post on a forum". */
export const PLATFORM_IN_WORDS: Record<Platform, string> = { ...PLATFORM_LABELS, forum: 'a forum' }

/**
 * Where an account takes part: its platform, and on a forum which forum,
 * since every forum is its own site with its own links, users and rules.
 */
export type PlatformPlace = { platform: Exclude<Platform, 'forum'> } | { platform: 'forum'; forum: Forum }

/**
 * An account's place from a row that keeps its forum beside its platform
 * (the accounts table's `forum`, present on a forum account only). A forum
 * account without its forum, or another account with one, is a broken row.
 */
export function placeOf(account: { platform: Platform; forum?: Forum }): PlatformPlace {
  if (account.platform !== 'forum') {
    if (account.forum !== undefined) throw new Error(`a ${account.platform} account has a forum`)
    return { platform: account.platform }
  }
  if (account.forum === undefined) throw new Error('a forum account has no forum')
  return { platform: 'forum', forum: account.forum }
}

/** Whether two places are one: the same platform, and on a forum the same forum. */
export function samePlace(a: PlatformPlace, b: PlatformPlace): boolean {
  if (a.platform === 'forum' && b.platform === 'forum') return a.forum.origin === b.forum.origin
  return a.platform === b.platform
}

/** A place as the operator reads it: the forum's name, or the platform's. */
export function placeLabel(place: PlatformPlace): string {
  return place.platform === 'forum' ? place.forum.name : PLATFORM_LABELS[place.platform]
}

/**
 * What a sponsor link's utm_medium names the place by (ADR 0003): the
 * platform, or a forum's host, so one handle on two forums is two accounts
 * to the conversions too.
 */
export function utmMediumOf(place: PlatformPlace): string {
  return place.platform === 'forum' ? forumHost(place.forum) : place.platform
}

/**
 * An account's handle as its platform spells it: the pattern the setup
 * checks, the prefix the studio writes it with, and what the field asks for.
 * A handle keeps its case, because Hacker News reads usernames
 * case-sensitively.
 */
export const PLATFORM_HANDLES: Record<Platform, { pattern: RegExp; rule: string; prefix: string; hint: string }> = {
  reddit: {
    pattern: /^[A-Za-z0-9_-]{3,20}$/,
    rule: '3 to 20 letters, digits, dashes or underscores',
    prefix: 'u/',
    hint: 'Your Reddit username, without u/.',
  },
  hackernews: {
    pattern: /^[A-Za-z0-9_-]{2,15}$/,
    rule: '2 to 15 letters, digits, dashes or underscores',
    prefix: '',
    hint: 'Your Hacker News username.',
  },
  x: {
    pattern: /^[A-Za-z0-9_]{1,15}$/,
    rule: '1 to 15 letters, digits or underscores',
    prefix: '@',
    hint: 'Your X handle, without the @.',
  },
  linkedin: {
    pattern: /^[A-Za-z0-9-]{3,100}$/,
    rule: '3 to 100 letters, digits or dashes',
    prefix: 'in/',
    hint: 'The end of your profile link, after linkedin.com/in/.',
  },
  // Discourse usernames are letters, digits, dots, dashes and underscores; other forums allow spaces.
  forum: {
    pattern: /^[^\s@/][^@/]{0,58}[^\s@/]$/,
    rule: '2 to 60 characters, with no @ or slash',
    prefix: '@',
    hint: 'Your username on the forum, without the @.',
  },
}

/**
 * The platforms whose reader reads an account only once the operator lets it
 * (OAuth): Reddit. The others are read by their handle, or not at all.
 */
export const CONNECTED_PLATFORMS = ['reddit'] as const satisfies readonly Platform[]
export type ConnectedPlatform = (typeof CONNECTED_PLATFORMS)[number]

export function needsConnection(platform: Platform): platform is ConnectedPlatform {
  return CONNECTED_PLATFORMS.some((connected) => connected === platform)
}

/** The handle as typed or pasted: the prefix its platform writes it with (@ada, u/ada) dropped. */
export function bareHandle(typed: string, platform: Platform): string {
  const handle = typed.trim()
  const prefix = PLATFORM_HANDLES[platform].prefix
  return prefix !== '' && handle.startsWith(prefix) ? handle.slice(prefix.length) : handle
}

/** A community as its platform writes it: r/n8n on Reddit, Ask HN on Hacker News, a forum's category by its name. */
export function communityLabel(platform: Platform, name: string): string {
  return platform === 'reddit' ? `r/${name}` : name
}

/** The handle as its platform writes it: @ada on X and on a forum, u/ada on Reddit, ada on Hacker News. */
export function handleOf(account: { platform: Platform; handle: string }): string {
  return `${PLATFORM_HANDLES[account.platform].prefix}${account.handle}`
}
