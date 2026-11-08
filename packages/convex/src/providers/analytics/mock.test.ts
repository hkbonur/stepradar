import { describe, expect, it, vi } from 'vitest'
import { mockAnalytics } from './mock'

const HOUR = 3_600_000
const NOW = Date.UTC(2026, 9, 14, 12)

describe('mock analytics', () => {
  it("spreads each sponsored post's conversions over its visits, tagged as its link tags them, and only the ones due by now", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
    const found = await mockAnalytics.conversions({
      accountHandle: 'nora',
      medium: 'x',
      since: NOW - 30 * 24 * HOUR,
      mockVisits: [
        { slug: 'retries', variantKey: 'question', postedAt: NOW - 24 * HOUR, visits: 50 },
        // Posted an hour ago: its first conversions are not due yet.
        { slug: 'fresh', postedAt: NOW - HOUR, visits: 50 },
        { slug: 'quiet', postedAt: NOW - 24 * HOUR, visits: 9 },
      ],
    })
    vi.useRealTimers()
    const kinds = (slug: string) => found.filter((conversion) => conversion.utm.campaign === slug).map((conversion) => conversion.kind)
    expect(kinds('retries')).toEqual([
      'demo_started',
      'demo_started',
      'demo_started',
      'demo_started',
      'demo_started',
      'signup',
      'signup',
      'trial_started',
    ])
    expect(kinds('fresh')).toEqual([])
    expect(kinds('quiet')).toEqual([])
    expect(found[0]?.utm).toEqual({ source: 'nora', medium: 'x', campaign: 'retries', content: 'question' })
    expect(found.every((conversion) => conversion.at <= NOW)).toBe(true)
  })
})
