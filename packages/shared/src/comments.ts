import type { ReplyStatus } from './replies'

/**
 * Comments (docs/plan.md, slice 6): someone's answer under one of the
 * account's posts or replies, or a mention of the account. Each fresh one
 * gets an answer draft and a notification; the match marks it answered when
 * it sees the operator's reply under it.
 */

/**
 * A comment waits for its answer (being written, drafted, or the operator's
 * own words), was answered when the answer went out, or was let go: too old
 * to answer when first read, or the account or the operator passed on its
 * answer.
 */
export const COMMENT_STATUSES = ['new', 'answered', 'dismissed'] as const
export type CommentStatus = (typeof COMMENT_STATUSES)[number]

/** What a comment's status says on the Posted page. */
export const COMMENT_STATUS_LABELS: Record<CommentStatus, string> = {
  new: 'Waits for your answer',
  answered: 'Answered',
  dismissed: 'Let go',
}

/**
 * What a comment becomes as its answer moves: an answer waiting or being
 * written keeps it waiting, one that went out answers it, one passed on or
 * gone stale lets it go.
 */
export const COMMENT_STATUS_OF_ANSWER: Record<ReplyStatus, CommentStatus> = {
  heard: 'new',
  draft: 'new',
  posted: 'answered',
  measured: 'answered',
  skipped: 'dismissed',
}

/** How far back the comment poll reads: the account's items posted within it, and the comments under them. */
export const COMMENT_WINDOW_MS = 7 * 24 * 3_600_000
