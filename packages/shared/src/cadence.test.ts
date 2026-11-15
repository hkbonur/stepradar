import { describe, expect, it } from 'vitest'
import { POST_WEEKDAYS, cadenceText, postWeekdays } from './formats'

const format = (postDays: number, postsPerDay: number) => ({
  publishHour: 9,
  cadence: { postDays, postsPerDay, kinds: ['text' as const], intents: ['ask' as const], repliesPerDay: 5 },
})

describe('the days a week with posts', () => {
  it('names as many weekdays as days, none twice', () => {
    for (const [days, weekdays] of POST_WEEKDAYS.entries()) {
      expect(weekdays).toHaveLength(days)
      expect(new Set(weekdays).size).toBe(days)
    }
    expect(() => postWeekdays(8)).toThrow('8 is no number of days a week')
  })

  it('says when an account posts, or that it only replies', () => {
    expect(cadenceText(format(0, 1))).toBe('No posts: replies only')
    expect(cadenceText(format(7, 2))).toBe('2 posts a day at 09:00')
    expect(cadenceText(format(1, 1))).toBe('1 post on Tuesday at 09:00')
    expect(cadenceText(format(2, 1))).toBe('1 post on Tuesday and Thursday at 09:00')
    expect(cadenceText(format(3, 1))).toBe('1 post on Monday, Wednesday and Friday at 09:00')
  })
})
