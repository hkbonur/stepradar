import { describe, expect, it } from 'vitest'
import { formatDay } from './format'
import { ideaLine } from './ideas'

const dayWords = (day: string) => formatDay(day, { weekday: 'short', day: 'numeric', month: 'short' })

describe('ideaLine', () => {
  it('names the day before a post is due as its writing day', () => {
    expect(ideaLine({ plannedFor: '2026-10-15' }, false)).toBe(`Writing on ${dayWords('2026-10-14')}`)
  })
  it('counts back across a month end', () => {
    expect(ideaLine({ plannedFor: '2026-11-01' }, false)).toBe(`Writing on ${dayWords('2026-10-31')}`)
  })
  it('says the writer is on it while its write job waits or runs', () => {
    expect(ideaLine({ plannedFor: '2026-10-15' }, true)).toBe('Writing now')
  })
})
