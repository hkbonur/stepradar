import { describe, expect, it } from 'vitest'
import { DEFAULT_LENGTH_MIX, lengthKindProblem, pickLengths, postLengthOf, SHORT_POST_MAX, type PostLength } from './post-mix'

const LINK = 'https://formstep.io/a/very/long/path/that/x/weighs/as/twenty/three'

function tally(lengths: PostLength[]): Record<PostLength, number> {
  return {
    short: lengths.filter((length) => length === 'short').length,
    medium: lengths.filter((length) => length === 'medium').length,
    long: lengths.filter((length) => length === 'long').length,
  }
}

function adjacentRepeats(lengths: PostLength[]): number {
  return lengths.filter((length, index) => index > 0 && lengths[index - 1] === length).length
}

describe('postLengthOf', () => {
  it('calls one part of at most 100 a one-liner, as X counts it', () => {
    expect(postLengthOf(['a'.repeat(SHORT_POST_MAX)])).toBe('short')
    expect(postLengthOf(['a'.repeat(SHORT_POST_MAX + 1)])).toBe('medium')
    // A link weighs 23, however long it is.
    expect(postLengthOf([`${'a'.repeat(76)} ${LINK}`])).toBe('short')
    expect(postLengthOf([`${'a'.repeat(77)} ${LINK}`])).toBe('medium')
  })
  it('calls more than one part a thread, however short the parts', () => {
    expect(postLengthOf(['One.', 'Two.'])).toBe('long')
  })
  it('throws on a post without parts', () => {
    expect(() => postLengthOf([])).toThrow('at least one part')
  })
})

describe('lengthKindProblem', () => {
  it('keeps a thread long and a text post short or medium', () => {
    expect(lengthKindProblem('thread', 'long')).toBeNull()
    expect(lengthKindProblem('thread', 'medium')).toBe('A thread is always long.')
    expect(lengthKindProblem('thread', 'short')).toBe('A thread is always long.')
    expect(lengthKindProblem('text', 'short')).toBeNull()
    expect(lengthKindProblem('text', 'medium')).toBeNull()
    expect(lengthKindProblem('text', 'long')).toBe('A text post is short or medium, never long.')
  })
})

describe('pickLengths', () => {
  it('gives each length the whole part of its share, the rest by largest remainder', () => {
    // 14 slots: 4.2 short, 7 medium, 2.8 long. The long remainder is the largest.
    expect(tally(pickLengths(DEFAULT_LENGTH_MIX, 14))).toEqual({ short: 4, medium: 7, long: 3 })
    // 10 slots divide evenly.
    expect(tally(pickLengths(DEFAULT_LENGTH_MIX, 10))).toEqual({ short: 3, medium: 5, long: 2 })
    // Equal remainders go in POST_LENGTHS order.
    expect(tally(pickLengths({ short: 1, medium: 1, long: 1 }, 2))).toEqual({ short: 1, medium: 1, long: 0 })
  })
  it('reads the shares relative to their sum', () => {
    expect(tally(pickLengths({ short: 2, medium: 0, long: 2 }, 4))).toEqual({ short: 2, medium: 0, long: 2 })
  })
  it('is the same every time', () => {
    expect(pickLengths(DEFAULT_LENGTH_MIX, 14)).toEqual(pickLengths(DEFAULT_LENGTH_MIX, 14))
    expect(pickLengths(DEFAULT_LENGTH_MIX, 14)).toEqual([
      'medium',
      'short',
      'medium',
      'short',
      'medium',
      'long',
      'medium',
      'short',
      'medium',
      'long',
      'medium',
      'short',
      'medium',
      'long',
    ])
  })
  it('never puts two equal lengths side by side when it can avoid it', () => {
    expect(adjacentRepeats(pickLengths(DEFAULT_LENGTH_MIX, 14))).toBe(0)
    expect(adjacentRepeats(pickLengths({ short: 0.5, medium: 0.25, long: 0.25 }, 8))).toBe(0)
    expect(adjacentRepeats(pickLengths({ short: 0.6, medium: 0.4, long: 0 }, 5))).toBe(0)
  })
  it('repeats a length only when nothing else is left', () => {
    expect(pickLengths({ short: 0.8, medium: 0.2, long: 0 }, 5)).toEqual(['short', 'medium', 'short', 'short', 'short'])
    expect(pickLengths({ short: 1, medium: 0, long: 0 }, 3)).toEqual(['short', 'short', 'short'])
  })
  it('handles no slots and one slot', () => {
    expect(pickLengths(DEFAULT_LENGTH_MIX, 0)).toEqual([])
    expect(pickLengths(DEFAULT_LENGTH_MIX, 1)).toEqual(['medium'])
  })
  it('throws on a mix it cannot draw from or a slot count that is not one', () => {
    expect(() => pickLengths({ short: 0, medium: 0, long: 0 }, 3)).toThrow('at least one share above zero')
    expect(() => pickLengths({ short: -0.1, medium: 1, long: 0 }, 3)).toThrow('the short share')
    expect(() => pickLengths({ short: Number.NaN, medium: 1, long: 0 }, 3)).toThrow('the short share')
    expect(() => pickLengths(DEFAULT_LENGTH_MIX, 1.5)).toThrow('1.5 slots')
    expect(() => pickLengths(DEFAULT_LENGTH_MIX, -1)).toThrow('-1 slots')
  })
})
