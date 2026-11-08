/**
 * Calendar days are strings (YYYY-MM-DD) in the account's timezone, so a plan
 * reads the same wherever the operator opens it. Instants are epoch ms.
 */

export function dayKey(at: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(
    new Date(at)
  )
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

export function addDays(day: string, days: number): string {
  const [y, m, d] = day.split('-').map(Number)
  const date = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days))
  return date.toISOString().slice(0, 10)
}

/** Monday of the week that contains `day`. */
export function weekStart(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  const date = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1))
  const weekday = (date.getUTCDay() + 6) % 7 // Monday = 0
  return addDays(day, -weekday)
}

/**
 * The instant of `hour`:00 on `day` in `timezone`. Resolved by trying the UTC
 * guess and correcting by the offset Intl reports, which handles DST.
 */
export function instantAt(day: string, hour: number, timezone: string): number {
  const [y, m, d] = day.split('-').map(Number)
  const guess = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, hour)
  // On a day the clocks change, the offset at the guess can differ from the offset at the answer, so it is read again there.
  const first = guess - timezoneOffsetMs(guess, timezone)
  return guess - timezoneOffsetMs(first, timezone)
}

/** An hour of the day as the journal and the chat write it: "07:00". */
export function hourText(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`
}

/** The local hour (0 to 23) of an instant in `timezone`, so a moved post keeps its slot on the new day. */
export function hourAt(at: number, timezone: string): number {
  const hour = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hourCycle: 'h23', hour: '2-digit' })
    .formatToParts(new Date(at))
    .find((part) => part.type === 'hour')
  if (!hour) throw new Error(`Intl gave no hour for ${at} in ${timezone}`)
  return Number(hour.value)
}

function timezoneOffsetMs(at: number, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(at))
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return asUtc - Math.floor(at / 1000) * 1000
}
