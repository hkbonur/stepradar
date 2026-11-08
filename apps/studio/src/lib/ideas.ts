import { writeDayOf } from '@influstep/shared'
import { formatDay } from './format'

/**
 * What an idea says where a written post shows its first line (CONTEXT.md,
 * Just-in-time draft): that the writer is on it now, or the day it will be,
 * the day before the post is due (shared writeDayOf).
 */
export function ideaLine(post: { plannedFor: string }, writing: boolean): string {
  if (writing) return 'Writing now'
  return `Writing on ${formatDay(writeDayOf(post.plannedFor), { weekday: 'short', day: 'numeric', month: 'short' })}`
}
