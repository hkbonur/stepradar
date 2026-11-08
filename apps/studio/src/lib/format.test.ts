import { describe, expect, it } from 'vitest'
import {
  addDays,
  formatCount,
  formatDateTime,
  formatElapsed,
  formatHour,
  formatMoney,
  formatNumber,
  languageName,
  plural,
  weekStart,
} from './format'

describe('format', () => {
  it('shortens counts the way a report reads them', () => {
    expect(formatCount(950)).toBe('950')
    expect(formatCount(1_240)).toBe('1.2k')
    expect(formatCount(12_400)).toBe('12k')
    expect(formatCount(2_500_000)).toBe('2.5M')
  })
  it('uses the singular word for exactly one and the plural for any other count', () => {
    expect(plural(1, 'post', 'posts')).toBe('post')
    expect(plural(0, 'post', 'posts')).toBe('posts')
    expect(plural(2, 'reply', 'replies')).toBe('replies')
  })
  it('shows evidence numbers with at most three decimals', () => {
    expect(formatNumber(0.02134).replace(/\D/g, '')).toBe('0021')
    expect(formatNumber(4200).replace(/\D/g, '')).toBe('4200')
  })
  it('rounds money to whole units in the given currency', () => {
    const usd = formatMoney(1234.6, 'USD')
    expect(usd.replace(/\D/g, '')).toBe('1235')
    expect(usd).toMatch(/\$|USD/)
    expect(formatMoney(0, 'EUR').replace(/\D/g, '')).toBe('0')
  })
  it('writes a publish hour with two digits and no minutes', () => {
    expect(formatHour(9)).toBe('09:00')
    expect(formatHour(16)).toBe('16:00')
  })
  it('finds Monday and walks days across a month end', () => {
    expect(weekStart('2026-10-09')).toBe('2026-10-05')
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02')
  })
  it('reads a moment on the clock of the time zone it is given', () => {
    const at = Date.UTC(2026, 9, 14, 14, 0)
    // The browser's locale picks a 24 or a 12 hour clock; either way it is four in the afternoon in Oslo.
    expect(formatDateTime(at, 'Europe/Oslo')).toMatch(/16[:.]00|0?4[:.]00\s?PM/i)
    expect(formatDateTime(at, 'America/New_York')).toMatch(/10[:.]00/)
  })
  it('says how long a job has been running in whole minutes, hours past the hour, and days', () => {
    expect(formatElapsed(40_000)).toBe('under a minute')
    expect(formatElapsed(2 * 60_000 + 59_000)).toBe('2 min')
    expect(formatElapsed(60 * 60_000)).toBe('1 h')
    expect(formatElapsed(65 * 60_000)).toBe('1 h 5 min')
    expect(formatElapsed(50 * 3_600_000)).toBe('2 d')
  })
  it('names a language tag, and knows when it cannot', () => {
    expect(languageName('nb', 'en')).toBe('Norwegian Bokmål')
    expect(languageName('tr', 'en')).toBe('Turkish')
    expect(languageName('zz', 'en')).toBeNull()
    expect(languageName('not a tag', 'en')).toBeNull()
  })
})
