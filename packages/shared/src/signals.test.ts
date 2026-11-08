import { describe, expect, it } from 'vitest'
import { COLD_FRESHNESS, SIGNAL_SOURCES, SIGNAL_SOURCE_LABELS, isCold, signalAgesOut, signalFreshness } from './signals'

const DAY = 86_400_000
const now = Date.UTC(2026, 9, 13, 9)

describe('signalFreshness', () => {
  it('is the score on the day it was published, halved every two days after', () => {
    expect(signalFreshness({ source: 'reddit', status: 'new', score: 80, publishedAt: now, foundAt: now }, now)).toBe(80)
    expect(signalFreshness({ source: 'reddit', status: 'new', score: 80, publishedAt: now - 2 * DAY, foundAt: now }, now)).toBe(40)
    expect(signalFreshness({ source: 'reddit', status: 'new', score: 80, publishedAt: now - 4 * DAY, foundAt: now }, now)).toBe(20)
    expect(signalFreshness({ source: 'reddit', status: 'new', score: 80, publishedAt: now - DAY, foundAt: now }, now)).toBe(57)
  })

  it('dates a signal by when it was found when the source does not say when it was published', () => {
    expect(signalFreshness({ source: 'reddit', status: 'new', score: 60, foundAt: now - 2 * DAY }, now)).toBe(30)
  })

  it('reads the publish time over the find time', () => {
    expect(signalFreshness({ source: 'reddit', status: 'new', score: 60, publishedAt: now - 10 * DAY, foundAt: now }, now)).toBe(2)
  })

  it('never grows past the score for a time ahead of now', () => {
    expect(signalFreshness({ source: 'reddit', status: 'new', score: 70, publishedAt: now + DAY, foundAt: now }, now)).toBe(70)
  })

  it('keeps the score of an open problem however old, and halves a dismissed one like any signal', () => {
    expect(signalFreshness({ source: 'problems', status: 'new', score: 90, publishedAt: now - 10 * DAY, foundAt: now }, now)).toBe(90)
    expect(signalFreshness({ source: 'problems', status: 'dismissed', score: 80, publishedAt: now - 2 * DAY, foundAt: now }, now)).toBe(40)
  })
})

describe('signalAgesOut', () => {
  it('lets an old signal go unless a post used it or it is a problem still open', () => {
    expect(signalAgesOut({ source: 'reddit', status: 'new' })).toBe(true)
    expect(signalAgesOut({ source: 'reddit', status: 'used' })).toBe(false)
    expect(signalAgesOut({ source: 'problems', status: 'new' })).toBe(false)
    expect(signalAgesOut({ source: 'problems', status: 'dismissed' })).toBe(true)
  })
})

describe('isCold', () => {
  it('is cold under the threshold only', () => {
    expect(isCold(COLD_FRESHNESS - 1)).toBe(true)
    expect(isCold(COLD_FRESHNESS)).toBe(false)
  })
})

describe('the signal sources', () => {
  it('names every source a signal comes from', () => {
    expect(SIGNAL_SOURCES).toEqual(['hackernews', 'reddit', 'x', 'linkedin', 'forum', 'search', 'comments', 'problems'])
    expect(SIGNAL_SOURCE_LABELS.hackernews).toBe('Hacker News')
    expect(SIGNAL_SOURCE_LABELS.search).toBe('Search suggestions')
    expect(SIGNAL_SOURCE_LABELS.problems).toBe('Problem log')
  })

  it('keeps an open problem as fresh as it was logged, since readers keep asking it', () => {
    const now = Date.UTC(2026, 9, 23)
    expect(
      signalFreshness({ source: 'problems', status: 'new', score: 95, publishedAt: now - 10 * DAY, foundAt: now - 10 * DAY }, now)
    ).toBe(95)
  })
})
