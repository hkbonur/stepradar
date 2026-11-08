import { POST_STATUS_LABELS, POST_EVENTS, canApply, foundPosted, type ImportedPost, type PostStatus, type Posted } from '@influstep/shared'
import type { Doc } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'
import { refusal } from '../lib/errors'

/**
 * A post's moves as the backend makes them: an event of the shared table
 * (POST_EVENTS) with the fields it carries, written in one patch. Handlers
 * call `applyEvent` and never patch `status` by hand.
 */
export type PipelineEvent =
  | { type: 'written'; at: number }
  | { type: 'posted'; posted: Posted }
  | { type: 'matched'; item: ImportedPost; editShare: number | null }
  | { type: 'measured' }
  | { type: 'skipped'; reason: string }
  | { type: 'failed'; error: string }
  | { type: 'killed' }
  | { type: 'rewrite' }
  | { type: 'retry' }

/** Where an event takes a post, or why it cannot: in the operator's words when it is the operator's event. */
export type TransitionResult = { ok: true; status: PostStatus } | { ok: false; reason: string; refused: boolean }

export function transition(post: Pick<Doc<'posts'>, 'status' | 'failedFrom'>, type: PipelineEvent['type']): TransitionResult {
  const rule = POST_EVENTS[type]
  if (!canApply(post.status, type)) {
    if ('refusal' in rule) return { ok: false, reason: rule.refusal(POST_STATUS_LABELS[post.status]), refused: true }
    return { ok: false, reason: `a post at ${post.status} cannot take "${type}"`, refused: false }
  }
  if (rule.to !== 'failedFrom') return { ok: true, status: rule.to }
  if (post.failedFrom === undefined) return { ok: false, reason: 'a failed post has no status it failed from', refused: false }
  return { ok: true, status: post.failedFrom }
}

/** What an event writes beside the status. Every event but a failure clears the error. */
function fieldsOf(event: PipelineEvent, post: Doc<'posts'>): Partial<Doc<'posts'>> {
  switch (event.type) {
    case 'written':
      return { error: undefined, writtenAt: event.at }
    case 'posted':
      return { error: undefined, posted: event.posted }
    case 'matched':
      return { error: undefined, posted: foundPosted(event.item, event.editShare) }
    case 'skipped':
      return { error: undefined, skipReason: event.reason }
    case 'failed':
      return { error: event.error, failedFrom: post.status }
    case 'retry':
      return { error: undefined, failedFrom: undefined }
    default:
      return { error: undefined }
  }
}

/** Where an event takes a post, or the refusal in the event's own words (shared POST_EVENTS). */
export function assertTransition(post: Pick<Doc<'posts'>, 'status' | 'failedFrom'>, type: PipelineEvent['type']): PostStatus {
  const result = transition(post, type)
  if (!result.ok) throw result.refused ? refusal(result.reason) : new Error(result.reason)
  return result.status
}

/** Moves a post through the pipeline, or refuses with the event's own words (shared POST_EVENTS). */
export async function applyEvent(ctx: MutationCtx, post: Doc<'posts'>, event: PipelineEvent): Promise<PostStatus> {
  const status = assertTransition(post, event.type)
  await ctx.db.patch(post._id, { status, ...fieldsOf(event, post), updatedAt: Date.now() })
  return status
}
