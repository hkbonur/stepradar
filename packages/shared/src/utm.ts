import type { Platform } from './platforms'

export interface Attribution {
  accountHandle: string
  /** Where the link was made for, as utm_medium names it (shared `utmMediumOf`): the platform, or a forum's host. */
  medium: string
  postSlug?: string
  variantKey?: string
}

/**
 * How a sponsored post links to the sponsor on each platform (decision 6 in
 * docs/plan.md). Its kind: a tracked link on X and LinkedIn, whose clicks
 * the worker counts; on Reddit, Hacker News and forums the sponsor's website
 * itself, with the same UTM parameters, since those communities distrust
 * redirect domains, so no click is counted there. Its placement: in the post's text,
 * or on Hacker News the submission's URL, outside the talking points.
 */
export interface SponsorLinkRule {
  kind: 'tracked' | 'direct'
  placement: 'text' | 'submission'
}

export const SPONSOR_LINKS: Record<Platform, SponsorLinkRule> = {
  x: { kind: 'tracked', placement: 'text' },
  linkedin: { kind: 'tracked', placement: 'text' },
  reddit: { kind: 'direct', placement: 'text' },
  hackernews: { kind: 'direct', placement: 'submission' },
  forum: { kind: 'direct', placement: 'text' },
}

/** The `utm_campaign` of an account's bio link: it names no post, so what it brings counts for the account alone. */
export const BIO_CAMPAIGN = 'bio'

/** Whether the platform's sponsor links are tracked links, whose clicks are counted. */
export function countsClicks(platform: Platform): boolean {
  return SPONSOR_LINKS[platform].kind === 'tracked'
}

/** A tracked link's address on the studio's public origin, which the worker serves. */
export function trackedLinkUrl(appUrl: string, slug: string): string {
  return new URL(`/go/${slug}`, appUrl).toString()
}

/** ADR 0003: the UTM set every sponsor link carries, a tracked link on its redirect and a direct one in itself. */
export function buildAttributedUrl(target: string, attribution: Attribution): string {
  const url = new URL(target)
  url.searchParams.set('utm_source', attribution.accountHandle)
  url.searchParams.set('utm_medium', attribution.medium)
  if (attribution.postSlug) url.searchParams.set('utm_campaign', attribution.postSlug)
  if (attribution.variantKey) url.searchParams.set('utm_content', attribution.variantKey)
  return url.toString()
}

const SLUG_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'

/** Short, unambiguous, lowercase. Deterministic when a seed is given (tests, mocks). */
export function makeSlug(length: number, seed?: number): string {
  let state = seed ?? Math.floor(Math.random() * 0xffffffff)
  let out = ''
  for (let i = 0; i < length; i += 1) {
    // mulberry32 step: stable sequence from one seed
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296
    out += SLUG_ALPHABET[Math.floor(r * SLUG_ALPHABET.length)]
  }
  return out
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}
