/**
 * A post's way from its idea to its numbers (CONTEXT.md, "Post"), in the
 * order a post goes through them. Influstep never posts: a written post waits for the
 * operator as a draft until they post it by hand and say so.
 */
export const POST_STATUSES = ['idea', 'draft', 'posted', 'measured', 'skipped', 'failed', 'killed'] as const

export type PostStatus = (typeof POST_STATUSES)[number]

/**
 * Where a post stands for the operator: open (to write, post or let go), out
 * (the operator posted it), or gone (let go before it went out). The one
 * reading of what a status means; the helpers below read it.
 */
export const POST_PHASES = {
  idea: 'open',
  draft: 'open',
  failed: 'open',
  posted: 'out',
  measured: 'out',
  skipped: 'gone',
  killed: 'gone',
} as const satisfies Record<PostStatus, 'open' | 'out' | 'gone'>

/**
 * What a post says stays editable until the operator posted it or let it go,
 * and it can be moved and killed for as long. The backend refuses an edit
 * outside these statuses and the studio locks its editor by the same rule.
 */
export function textEditable(status: PostStatus): boolean {
  return POST_PHASES[status] === 'open'
}

/** The operator posted it: it is on X, measured or not. */
export function wentOut(status: PostStatus): boolean {
  return POST_PHASES[status] === 'out'
}

/** It was let go before it went out: skipped or killed. Every screen strikes it through. */
export function letGo(status: PostStatus): boolean {
  return POST_PHASES[status] === 'gone'
}

/** What needs the operator's hand: a draft to post, or a post that failed. A post card draws both with a border. */
export function needsOperator(status: PostStatus): boolean {
  return status === 'draft' || status === 'failed'
}

interface PostEventRule {
  from: readonly PostStatus[]
  /** Where the post goes; a retry returns it to the status it failed from. */
  to: PostStatus | 'failedFrom'
  /** What the operator reads when the event comes from another status. An agent's events have none: that would be a bug. */
  refusal?: (at: string) => string
}

/**
 * What can happen to a post, from which statuses, and where it goes: the one
 * table the backend moves a post by (core/pipeline.ts `applyEvent`) and the
 * studio offers its actions by (`canApply`).
 */
export const POST_EVENTS = {
  written: { from: ['idea'], to: 'draft' },
  posted: { from: ['draft'], to: 'posted', refusal: (at) => `Only a draft can be marked posted; this post is at "${at}".` },
  measured: { from: ['posted'], to: 'measured' },
  // The match found it among the account's own items: a draft goes out, a post marked posted gets the platform's id.
  matched: { from: ['draft', 'posted'], to: 'posted' },
  failed: { from: ['idea', 'draft'], to: 'failed' },
  skipped: { from: ['idea', 'draft'], to: 'skipped', refusal: (at) => `A post at "${at}" cannot be skipped.` },
  killed: { from: ['idea', 'draft', 'failed'], to: 'killed', refusal: (at) => `A post at "${at}" cannot be killed.` },
  rewrite: {
    from: ['draft', 'failed'],
    to: 'idea',
    refusal: (at) => `Only a draft or a failed post can be rewritten; this one is at "${at}".`,
  },
  retry: { from: ['failed'], to: 'failedFrom', refusal: (at) => `Only a failed post can be retried; this one is at "${at}".` },
} as const satisfies Record<string, PostEventRule>

export type PostEventType = keyof typeof POST_EVENTS

export function canApply(status: PostStatus, event: PostEventType): boolean {
  const from: readonly PostStatus[] = POST_EVENTS[event].from
  return from.includes(status)
}

export const POST_STATUS_LABELS: Record<PostStatus, string> = {
  idea: 'Idea',
  draft: 'Draft',
  posted: 'Posted',
  measured: 'Measured',
  skipped: 'Skipped',
  failed: 'Failed',
  killed: 'Killed',
}

/** The DESIGN.md status tint scale, as the semantic token each status maps to. */
export type StatusTint = 'fog' | 'alert-amber' | 'field-green' | 'ink' | 'signal-red'

export const POST_STATUS_TINTS: Record<PostStatus, StatusTint> = {
  idea: 'fog',
  draft: 'alert-amber',
  posted: 'field-green',
  measured: 'ink',
  skipped: 'fog',
  failed: 'signal-red',
  killed: 'fog',
}

export const SPONSOR_SEGMENTS = ['none', 'mention'] as const
export type SponsorSegment = (typeof SPONSOR_SEGMENTS)[number]

export const SPONSOR_SEGMENT_LABELS: Record<SponsorSegment, string> = {
  none: 'No sponsor',
  mention: 'Sponsor mention',
}
