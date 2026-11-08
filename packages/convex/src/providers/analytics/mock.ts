import { PLATFORMS } from '@influstep/shared'
import type { AnalyticsProvider, FoundConversion, FoundProbable } from './types'

const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000

/** How far apart a post's mock conversions come, from when it went out. */
const SPACING_MS = 2 * HOUR_MS

/** A mock probable signup comes every this many days on each platform. */
const PROBABLE_EVERY_DAYS = 4

/**
 * Mock conversions proportional to each sponsored post's visits, down the
 * whole journey in the product: one demo per 10 visits, one signup per 25, a
 * trial for every second signup and a paid for every sixth, each tagged with
 * the post's slug and variant as its link would tag it. They come two hours
 * apart from when the post went out, so a later pull finds the ones due
 * since. One distinct id per mock person, derived from the handle, the slug
 * and the person's index only, so a repeat pull dedupes on (distinctId,
 * kind) instead of adding the same people again.
 */
export const mockAnalytics: AnalyticsProvider = {
  name: 'mock',
  async conversions(args): Promise<FoundConversion[]> {
    const now = Date.now()
    const out: FoundConversion[] = []
    for (const post of args.mockVisits) {
      const utm = {
        source: args.accountHandle,
        medium: args.medium,
        campaign: post.slug,
        ...(post.variantKey === undefined ? {} : { content: post.variantKey }),
      }
      const due = (at: number, conversion: Omit<FoundConversion, 'at' | 'utm'>) => {
        if (at <= now) out.push({ ...conversion, at, utm })
      }
      for (let i = 0; i < Math.floor(post.visits / 10); i += 1) {
        due(post.postedAt + (i + 1) * SPACING_MS, { kind: 'demo_started', distinctId: `mock-${args.accountHandle}-${post.slug}-demo-${i}` })
      }
      for (let i = 0; i < Math.floor(post.visits / 25); i += 1) {
        const at = post.postedAt + (i + 1) * SPACING_MS
        const distinctId = `mock-${args.accountHandle}-${post.slug}-${i}`
        due(at, { kind: 'signup', distinctId })
        if (i % 2 === 1) due(at + HOUR_MS, { kind: 'trial_started', distinctId })
        if (i % 6 === 5) due(at + 2 * HOUR_MS, { kind: 'paid', distinctId })
      }
    }
    return out
  },
  /**
   * A probable signup on every platform every PROBABLE_EVERY_DAYS days, at
   * noon of a day counted from the epoch, so a repeat pull finds the same
   * people; every second one said where they heard of it, every third paid.
   * A workspace with no forum has no forum's.
   */
  async probableConversions(args): Promise<FoundProbable[]> {
    const out: FoundProbable[] = []
    for (let day = Math.ceil(args.since / DAY_MS); day * DAY_MS + DAY_MS / 2 < Date.now(); day += 1) {
      if (day % PROBABLE_EVERY_DAYS !== 0) continue
      const at = day * DAY_MS + DAY_MS / 2
      const basis = (day / PROBABLE_EVERY_DAYS) % 2 === 0 ? 'heard_about_us' : 'referrer'
      for (const platform of PLATFORMS.filter((platform) => platform !== 'forum' || args.forumHosts.length > 0)) {
        const distinctId = `mock-probable-${platform}-${day}`
        out.push({ platform, kind: 'signup', distinctId, at, basis })
        if ((day / PROBABLE_EVERY_DAYS) % 3 === 0) out.push({ platform, kind: 'paid', distinctId, at: at + 2 * HOUR_MS, basis })
      }
    }
    return out
  },
}
