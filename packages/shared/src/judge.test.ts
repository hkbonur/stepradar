import { describe, expect, it } from 'vitest'
import { engages, missingReasons, type EngagementReasons } from './judge'

const reasons = (overrides: Partial<EngagementReasons>): EngagementReasons => ({
  read: 'The first line names the bug they have now.',
  comment: 'It asks which limit they use.',
  like: 'It gives a number they can copy.',
  follow: 'It shows more fixes like it are coming.',
  ...overrides,
})

describe('the judge', () => {
  it('needs a reason to read on and to comment, and one to like or follow', () => {
    expect(engages(reasons({}))).toBe(true)
    expect(engages(reasons({ like: null }))).toBe(true)
    expect(engages(reasons({ like: null, follow: null }))).toBe(false)
    expect(engages(reasons({ comment: null }))).toBe(false)
    expect(engages(reasons({ read: null }))).toBe(false)
    expect(missingReasons(reasons({ comment: null, follow: null }))).toEqual(['comment', 'follow'])
  })
})
