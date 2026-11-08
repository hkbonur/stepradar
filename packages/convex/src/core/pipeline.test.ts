import { describe, expect, it } from 'vitest'
import { transition } from './pipeline'

const at = (status: Parameters<typeof transition>[0]['status'], failedFrom?: 'idea' | 'draft') => ({ status, failedFrom })

describe('transition', () => {
  it('walks the happy path', () => {
    expect(transition(at('idea'), 'written')).toEqual({ ok: true, status: 'draft' })
    expect(transition(at('draft'), 'posted')).toEqual({ ok: true, status: 'posted' })
    expect(transition(at('posted'), 'measured')).toEqual({ ok: true, status: 'measured' })
  })
  it('refuses the operator in the event’s words, and an agent’s event as a bug', () => {
    expect(transition(at('idea'), 'posted')).toEqual({
      ok: false,
      reason: 'Only a draft can be marked posted; this post is at "Idea".',
      refused: true,
    })
    expect(transition(at('measured'), 'written')).toMatchObject({ ok: false, refused: false })
  })
  it('retries a failed post to the status it failed from', () => {
    expect(transition(at('failed', 'idea'), 'retry')).toEqual({ ok: true, status: 'idea' })
    expect(transition(at('failed', 'draft'), 'retry')).toEqual({ ok: true, status: 'draft' })
    expect(transition(at('draft'), 'retry')).toMatchObject({ ok: false, refused: true })
  })
  it('skips an idea or a draft, never a posted post', () => {
    expect(transition(at('idea'), 'skipped')).toEqual({ ok: true, status: 'skipped' })
    expect(transition(at('draft'), 'skipped')).toEqual({ ok: true, status: 'skipped' })
    expect(transition(at('posted'), 'skipped')).toMatchObject({ ok: false, reason: 'A post at "Posted" cannot be skipped.' })
  })
})
