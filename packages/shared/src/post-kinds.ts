/**
 * What a post is on X: a text post or a thread, words only. The operator
 * posts it by hand (ADR 0004), so nothing is rendered for it.
 */

export const POST_KINDS = ['text', 'thread'] as const
export type PostKind = (typeof POST_KINDS)[number]

export const POST_KIND_LABELS: Record<PostKind, string> = {
  text: 'Text post',
  thread: 'Thread',
}
