import { describe, expect, it } from 'vitest'
import { countVoice } from '@influstep/shared'
import { HISTORY_BEING_DELETED, accountTotals, assertVoiceEdit, engagementOf, voiceSampleOf } from './history'

const bySource = { archive: 2, paste: 1, api: 0, mock: 0 }
// Two originals (a one-liner and a thread) and, from the three posts by source, one reply.
const originals = countVoice([
  { parts: ['A one-liner.'], isReply: false },
  { parts: ['A thread.', 'Its second part.'], isReply: false },
])

describe('accountTotals', () => {
  it('counts originals, replies and every source, zero included', () => {
    expect(accountTotals({ bySource, originals })).toEqual({ count: 3, originals: 2, replies: 1, bySource })
    expect(accountTotals(null)).toEqual({ count: 0, originals: 0, replies: 0, bySource: { archive: 0, paste: 0, api: 0, mock: 0 } })
  })
})

describe('engagementOf', () => {
  it('is likes plus reposts', () => {
    expect(engagementOf({ likes: 40, reposts: 5 })).toBe(45)
  })
})

describe('voiceSampleOf', () => {
  const tenOriginals = countVoice(Array.from({ length: 10 }, (_, index) => ({ parts: [`Post ${index}.`], isReply: false })))
  it('refuses under ten originals and says how many there are', () => {
    expect(() => voiceSampleOf(null)).toThrow('Import at least 10 posts first; there are 0.')
    expect(() => voiceSampleOf({ originals, clearing: false })).toThrow('Import at least 10 posts first; there are 2.')
    expect(voiceSampleOf({ originals: tenOriginals, clearing: false })).toEqual(tenOriginals)
  })
  it('refuses while Clear history is still deleting posts', () => {
    expect(() => voiceSampleOf({ originals: tenOriginals, clearing: true })).toThrow(HISTORY_BEING_DELETED)
  })
})

describe('assertVoiceEdit', () => {
  it('trims what it keeps and refuses with the first problem', () => {
    expect(assertVoiceEdit({ language: ' tr ', summary: ' Kısa. ', traits: [' Direct '] })).toEqual({
      language: 'tr',
      summary: 'Kısa.',
      traits: ['Direct'],
    })
    expect(() => assertVoiceEdit({ language: '', summary: '', traits: [] })).toThrow('The language is empty.')
  })
})
