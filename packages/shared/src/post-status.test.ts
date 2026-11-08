import { describe, expect, it } from 'vitest'
import { POST_STATUSES, POST_EVENTS, canApply, letGo, needsOperator, textEditable, wentOut } from './post-status'

describe('post events', () => {
  it('reaches posted only from a draft, and measured only once posted', () => {
    expect(POST_STATUSES.filter((status) => canApply(status, 'posted'))).toEqual(['draft'])
    expect(POST_STATUSES.filter((status) => canApply(status, 'measured'))).toEqual(['posted'])
  })
  it('kills what is still open, and nothing posted or let go', () => {
    expect(POST_STATUSES.filter((status) => canApply(status, 'killed'))).toEqual(POST_STATUSES.filter(textEditable))
  })
  it('rewrites a draft or a failed post, and retries only a failed one', () => {
    expect(POST_STATUSES.filter((status) => canApply(status, 'rewrite'))).toEqual(['draft', 'failed'])
    expect(POST_STATUSES.filter((status) => canApply(status, 'retry'))).toEqual(['failed'])
  })
  it('gives every operator event its own refusal', () => {
    expect(POST_EVENTS.skipped.refusal('Posted')).toBe('A post at "Posted" cannot be skipped.')
    expect(POST_EVENTS.posted.refusal('Idea')).toBe('Only a draft can be marked posted; this post is at "Idea".')
  })
})

describe('post phases', () => {
  it('keeps the text open until the operator posted it or let it go', () => {
    expect(POST_STATUSES.filter(textEditable)).toEqual(['idea', 'draft', 'failed'])
    expect(POST_STATUSES.filter(wentOut)).toEqual(['posted', 'measured'])
    expect(POST_STATUSES.filter(letGo)).toEqual(['skipped', 'killed'])
  })
  it('needs the operator for a draft to post or a failed post', () => {
    expect(POST_STATUSES.filter(needsOperator)).toEqual(['draft', 'failed'])
  })
})
