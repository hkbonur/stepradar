import { describe, expect, it } from 'vitest'
import { mixSweep } from './communities'

const threads = (prefix: string, count: number) => Array.from({ length: count }, (_, index) => ({ externalId: `${prefix}${index}` }))
const ids = (found: { externalId: string }[]) => found.map((thread) => thread.externalId)

describe('mixSweep', () => {
  it("keeps half a sweep to the account's own communities and the rest from everywhere", () => {
    expect(ids(mixSweep(threads('own', 8), threads('all', 8), 6))).toEqual(['own0', 'own1', 'own2', 'all0', 'all1', 'all2'])
  })

  it('fills what one half lacks from the other, and counts a thread both found once', () => {
    expect(ids(mixSweep(threads('own', 1), threads('all', 8), 4))).toEqual(['own0', 'all0', 'all1', 'all2'])
    expect(ids(mixSweep(threads('own', 8), threads('all', 1), 4))).toEqual(['own0', 'own1', 'own2', 'all0'])
    expect(ids(mixSweep([{ externalId: 'both' }], [{ externalId: 'both' }, { externalId: 'all1' }], 4))).toEqual(['both', 'all1'])
  })
})
