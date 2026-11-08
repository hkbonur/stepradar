import { describe, expect, it } from 'vitest'
import { counterTone } from './counter'

describe('counterTone', () => {
  it('stays quiet under 90 percent of the limit', () => {
    expect(counterTone(0, 280)).toBe('quiet')
    expect(counterTone(251, 280)).toBe('quiet')
  })

  it('warns from 90 percent up to the limit itself', () => {
    expect(counterTone(252, 280)).toBe('near')
    expect(counterTone(280, 280)).toBe('near')
  })

  it('is over one character past the limit', () => {
    expect(counterTone(281, 280)).toBe('over')
  })

  it('reads a smaller limit, like the card title, the same way', () => {
    expect(counterTone(54, 60)).toBe('near')
    expect(counterTone(61, 60)).toBe('over')
  })
})
