/**
 * Notifications (docs/plan.md, "Notifier: web push"): a push about new
 * comments within ten minutes of them, several in one, a morning digest, and
 * a rising thread the listener found (shared replies.ts `risingRead`).
 * Nothing is pushed in the operator's quiet hours: a comment or the digest
 * waits for their end, and a rising thread is not pushed at all.
 */

export const NOTIFICATION_KINDS = ['comment', 'digest', 'rising'] as const
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number]

/** A notification waits to be pushed, is being pushed, then went out to the devices or failed on all of them. */
export const NOTIFICATION_STATUSES = ['queued', 'sending', 'sent', 'failed'] as const
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number]

/** What a push shows: a title, the first words, the studio address a click opens, and the tag a repeat replaces. */
export interface NotificationPayload {
  title: string
  body: string
  url: string
  tag: string
}

/** How much of a comment a notification shows. */
export const NOTIFICATION_TEXT_MAX = 120

/** A comment's words as a notification shows them: at most NOTIFICATION_TEXT_MAX characters, cut at a word. */
export function notificationText(text: string, max: number = NOTIFICATION_TEXT_MAX): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  const cut = flat.slice(0, max - 1)
  return `${cut.slice(0, cut.lastIndexOf(' ') > 0 ? cut.lastIndexOf(' ') : cut.length)}…`
}

/** The operator's quiet hours: from `start` to `end` (local hours, 0 to 23) in their timezone; they may run past midnight. */
export interface QuietHours {
  start: number
  end: number
  timezone: string
}

/** Whether a local hour falls in the quiet hours. Equal start and end mean none. */
export function quietAt(quiet: QuietHours, hour: number): boolean {
  if (quiet.start === quiet.end) return false
  if (quiet.start < quiet.end) return hour >= quiet.start && hour < quiet.end
  return hour >= quiet.start || hour < quiet.end
}

/** What is wrong with quiet hours, in the words the studio shows. */
export function quietHoursProblems(quiet: QuietHours): string[] {
  const problems: string[] = []
  for (const hour of [quiet.start, quiet.end]) {
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) problems.push('Quiet hours start and end on a whole hour, 0 to 23.')
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: quiet.timezone })
  } catch {
    problems.push(`${quiet.timezone} is no timezone.`)
  }
  return [...new Set(problems)]
}

/** The Posted page's anchor of one of the account's items: a comment notification opens the page at the item it is under. */
export function postedAnchor(externalId: string): string {
  return `item-${externalId.replace(/[^A-Za-z0-9_-]/g, '-')}`
}
