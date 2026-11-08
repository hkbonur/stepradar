import { describe, expect, it } from 'vitest'
import { fellBehind, funnelLeak, type StepFlows } from './growth'

const flows = (overrides: Partial<StepFlows> = {}): StepFlows => ({
  click: { from: 10_000, to: 100 },
  signup: { from: 100, to: 10 },
  paid: { from: 10, to: 2 },
  ...overrides,
})

describe('consistency', () => {
  it('asks to post once at least three posts were due and fewer than half went out', () => {
    expect(fellBehind({ due: 4, posted: 1 })).toBe(true)
    expect(fellBehind({ due: 4, posted: 2 })).toBe(false)
    // Monday, one post due and not yet out: too early to say.
    expect(fellBehind({ due: 2, posted: 0 })).toBe(false)
  })
})

describe('funnelLeak', () => {
  it('finds the step whose rate fell furthest under 60% of the window before', () => {
    const now = flows({ click: { from: 10_000, to: 40 }, signup: { from: 40, to: 2 } })
    expect(funnelLeak(now, flows())).toEqual({ step: 'click', rate: 0.004, before: 0.01 })
    // A step under its floor in either window says nothing.
    expect(funnelLeak(flows({ signup: { from: 29, to: 0 } }), flows())).toBeNull()
  })

  it('takes a step that let nothing through as the worst leak, whatever came before', () => {
    const dry = flows({ signup: { from: 120, to: 0 } })
    expect(funnelLeak(dry, flows({ signup: null }))).toEqual({ step: 'signup', rate: 0, before: null })
    // Under three times its floor, a dry step is too small to call.
    expect(funnelLeak(flows({ signup: { from: 60, to: 0 } }), flows({ signup: null }))).toBeNull()
  })

  it('reads no step a platform does not count', () => {
    expect(funnelLeak(flows({ click: null, signup: null }), flows())).toBeNull()
  })
})
