import { describe, expect, it } from 'vitest'
import { formatDateTime, formatTime } from './format'
import { briefTime, splitBrief } from './research'

describe('splitBrief', () => {
  it('shows the first three lines and keeps the rest for the whole brief', () => {
    const text = [
      'Hacker News: 4 new',
      'Reddit: 2 new',
      'Search suggestions: 3 new',
      'Strongest: "n8n retries"',
      'Open problems: none',
    ].join('\n')
    expect(splitBrief(text)).toEqual({
      head: ['Hacker News: 4 new', 'Reddit: 2 new', 'Search suggestions: 3 new'],
      rest: ['Strongest: "n8n retries"', 'Open problems: none'],
    })
  })
  it('drops the blank lines between the parts, so they never take one of the three', () => {
    expect(splitBrief('Reddit: 2 new\n\n  \nStrongest: "webhooks"\n')).toEqual({
      head: ['Reddit: 2 new', 'Strongest: "webhooks"'],
      rest: [],
    })
  })
  it('reads a quiet morning as its one line', () => {
    expect(splitBrief('Nothing new moved since yesterday.')).toEqual({ head: ['Nothing new moved since yesterday.'], rest: [] })
  })
})

describe('briefTime', () => {
  const morning = new Date(2026, 9, 13, 6, 15).getTime()
  it('says today for a brief written earlier the same day', () => {
    expect(briefTime(morning, new Date(2026, 9, 13, 18, 0).getTime())).toBe(`${formatTime(morning)} today`)
  })
  it('says yesterday for one written the day before, across a month end', () => {
    const lastOfMonth = new Date(2026, 9, 31, 6, 15).getTime()
    expect(briefTime(lastOfMonth, new Date(2026, 10, 1, 5, 0).getTime())).toBe(`${formatTime(lastOfMonth)} yesterday`)
  })
  it('names the date of an older one', () => {
    expect(briefTime(morning, new Date(2026, 9, 15, 9, 0).getTime())).toBe(formatDateTime(morning))
  })
})
