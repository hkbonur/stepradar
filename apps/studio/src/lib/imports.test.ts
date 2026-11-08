import { IMPORT_BATCH_MAX } from '@influstep/shared'
import { describe, expect, it } from 'vitest'
import { chunk } from './imports'

describe('chunk', () => {
  it('splits a long archive into full batches and a last short one, in order', () => {
    const posts = Array.from({ length: IMPORT_BATCH_MAX * 2 + 7 }, (_, index) => index)
    const runs = chunk(posts, IMPORT_BATCH_MAX)
    expect(runs.map((run) => run.length)).toEqual([IMPORT_BATCH_MAX, IMPORT_BATCH_MAX, 7])
    expect(runs.flat()).toEqual(posts)
  })

  it('sends nothing for nothing', () => {
    expect(chunk([], IMPORT_BATCH_MAX)).toEqual([])
  })

  it('refuses a size that would never finish', () => {
    expect(() => chunk([1, 2], 0)).toThrow('cannot chunk by 0')
  })
})
