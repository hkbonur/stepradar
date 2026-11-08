import { describe, expect, it } from 'vitest'
import { addDays, dayKey, hourAt, instantAt, weekStart } from './dates'

describe('dates', () => {
  it('finds the Monday of a week', () => {
    expect(weekStart('2026-10-09')).toBe('2026-10-05')
    expect(weekStart('2026-10-05')).toBe('2026-10-05')
    expect(weekStart('2026-10-11')).toBe('2026-10-05')
  })
  it('adds days across month ends', () => {
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02')
  })
  it('resolves a local hour to an instant and back', () => {
    const at = instantAt('2026-10-09', 9, 'Europe/Oslo')
    expect(new Date(at).toISOString()).toBe('2026-10-09T07:00:00.000Z')
    expect(dayKey(at, 'Europe/Oslo')).toBe('2026-10-09')
  })
  it('finds a local hour on the day the clocks change west of UTC', () => {
    expect(hourAt(instantAt('2026-11-01', 7, 'America/Los_Angeles'), 'America/Los_Angeles')).toBe(7)
    expect(hourAt(instantAt('2026-03-08', 7, 'America/Los_Angeles'), 'America/Los_Angeles')).toBe(7)
  })

  it('reads the local hour back from an instant, on either side of a DST change', () => {
    expect(hourAt(instantAt('2026-10-09', 18, 'Europe/Oslo'), 'Europe/Oslo')).toBe(18)
    expect(hourAt(instantAt('2026-11-02', 0, 'Europe/Oslo'), 'Europe/Oslo')).toBe(0)
    expect(hourAt(instantAt('2026-11-02', 23, 'Europe/Oslo'), 'Europe/Oslo')).toBe(23)
  })
})
