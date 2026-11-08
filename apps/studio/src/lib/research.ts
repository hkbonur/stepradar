import { formatDateTime, formatTime } from './format'

/** How many lines of the morning brief the account page shows before "Whole brief". */
const BRIEF_LINES_SHOWN = 3

/** How many problems the account page lists before "and n more". */
export const PROBLEMS_SHOWN = 3

/**
 * The brief's text as the lines the account page shows: the first few, and
 * the rest behind "Whole brief". Blank lines only space the researcher's
 * parts apart, so they are dropped rather than counted as one of the few.
 */
export function splitBrief(text: string): { head: string[]; rest: string[] } {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  return { head: lines.slice(0, BRIEF_LINES_SHOWN), rest: lines.slice(BRIEF_LINES_SHOWN) }
}

/** Midnight of the browser's day that `at` falls in. */
function startOfDay(at: number): number {
  const date = new Date(at)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/**
 * When the brief was written, as the operator reads it beside the brief:
 * "06:15 today", "06:15 yesterday", or the date and time when it is older.
 * Calendar days in the browser's timezone, rounded, so a daylight saving
 * change in between still counts one day as one.
 */
export function briefTime(at: number, now: number): string {
  const days = Math.round((startOfDay(now) - startOfDay(at)) / 86_400_000)
  if (days === 0) return `${formatTime(at)} today`
  if (days === 1) return `${formatTime(at)} yesterday`
  return formatDateTime(at)
}
