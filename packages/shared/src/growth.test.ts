import { describe, expect, it } from 'vitest'
import { clickLeak, fellBehind, type ClickFlow } from './growth'

const BEFORE: ClickFlow = { reached: 10_000, clicked: 100 }

describe('consistency', () => {
  it('asks to post once at least three posts were due and fewer than half went out', () => {
    expect(fellBehind({ due: 4, posted: 1 })).toBe(true)
    expect(fellBehind({ due: 4, posted: 2 })).toBe(false)
    // Monday, one post due and not yet out: too early to say.
    expect(fellBehind({ due: 2, posted: 0 })).toBe(false)
  })
})

describe('clickLeak', () => {
  it('finds clicks whose rate fell under 60% of the window before', () => {
    expect(clickLeak({ reached: 10_000, clicked: 40 }, BEFORE)).toEqual({ rate: 0.004, before: 0.01 })
    expect(clickLeak({ reached: 10_000, clicked: 70 }, BEFORE)).toBeNull()
    // A window under the floor says nothing, and a window before under it gives nothing to compare with.
    expect(clickLeak({ reached: 999, clicked: 0 }, BEFORE)).toBeNull()
    expect(clickLeak({ reached: 2_000, clicked: 1 }, { reached: 999, clicked: 90 })).toBeNull()
  })

  it('takes no click at all as a leak, whatever came before, once three times the floor was reached', () => {
    expect(clickLeak({ reached: 3_000, clicked: 0 }, { reached: 0, clicked: 0 })).toEqual({ rate: 0, before: null })
    expect(clickLeak({ reached: 2_000, clicked: 0 }, { reached: 0, clicked: 0 })).toBeNull()
  })
})
