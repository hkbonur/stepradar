/** Formatting for the operator's eyes: short, tabular, local. */

export function formatCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 10_000) return `${Math.round(value / 1000)}k`
  if (value >= 1_000) return `${(value / 1000).toFixed(1)}k`
  return String(Math.round(value))
}

/** A count, or a dash for one not read or not counted: a number missing is no zero. */
export function formatKnown(value: number | null): string {
  return value === null ? '–' : formatCount(value)
}

/**
 * The word a count takes, "post" for exactly one and "posts" for any other
 * number, zero included. English only, like the rest of the studio; the caller
 * prints the count itself, in its own tabular span.
 */
export function plural(count: number, one: string, other: string): string {
  return count === 1 ? one : other
}

/**
 * A number the backend wrote as evidence (a journal entry's numbers), as the
 * operator reads it: grouped, at most three decimals. Its label says the unit.
 */
export function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(value)
}

export function formatPercent(rate: number, digits = 1): string {
  return `${(rate * 100).toFixed(digits)}%`
}

/** Whole units in the workspace's currency: the report estimates, it does not invoice. */
export function formatMoney(value: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(value)
}

export function formatTime(at: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(new Date(at))
}

/** A publish hour (0 to 23) as it reads on a schedule: 16 is "16:00". */
export function formatHour(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`
}

/** A day in the past, with its year: an imported post can be years old. */
export function formatDate(at: number): string {
  return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(at))
}

/**
 * A language tag (BCP 47, such as `nb`) as the operator reads it, "Norwegian
 * Bokmål". Null when the tag is malformed or names no language the browser
 * knows, so the caller says what an unknown tag shows instead.
 */
export function languageName(tag: string, locale?: string): string | null {
  try {
    const name = new Intl.DisplayNames(locale, { type: 'language', fallback: 'none' }).of(tag)
    return name === undefined ? null : name
  } catch {
    // A RangeError: the text is not a well-formed language tag at all.
    return null
  }
}

/**
 * A moment as the operator reads it: month, day and time. Without a time zone
 * it is the browser's; a publish time passes the account's, because that is the
 * clock the account's publish hours are set in.
 */
export function formatDateTime(at: number, timeZone?: string): string {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone }).format(
    new Date(at)
  )
}

export function formatDay(day: string, options: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric' }): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Intl.DateTimeFormat(undefined, options).format(new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1))
}

export function relativeTime(at: number, now = Date.now()): string {
  const seconds = Math.round((at - now) / 1000)
  const abs = Math.abs(seconds)
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  if (abs < 60) return formatter.format(seconds, 'second')
  if (abs < 3600) return formatter.format(Math.round(seconds / 60), 'minute')
  if (abs < 86_400) return formatter.format(Math.round(seconds / 3600), 'hour')
  return formatter.format(Math.round(seconds / 86_400), 'day')
}

/**
 * How long something has been going, "2 min" or "1 h 5 min", for a running
 * job ("for 2 min"). Whole minutes, rounded down, because the line is read at a
 * glance and ticks on its own; under a minute it says so in words.
 */
export function formatElapsed(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return 'under a minute'
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return minutes % 60 === 0 ? `${hours} h` : `${hours} h ${minutes % 60} min`
  return `${Math.floor(hours / 24)} d`
}

/** Today as YYYY-MM-DD in the browser's timezone. */
export function todayKey(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export function addDays(day: string, days: number): string {
  const [y, m, d] = day.split('-').map(Number)
  const date = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days))
  return date.toISOString().slice(0, 10)
}

export function weekStart(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  const date = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1))
  return addDays(day, -((date.getUTCDay() + 6) % 7))
}
