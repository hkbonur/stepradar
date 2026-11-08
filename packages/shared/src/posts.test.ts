import { describe, expect, it } from 'vitest'
import { DEFAULT_FORMATS } from './formats'
import { postHook, postSlotHours, xLength } from './posts'

const LINK = 'http://localhost:3300/go/abc1234'
const x = DEFAULT_FORMATS.x

describe('xLength', () => {
  it('counts plain text by code point', () => {
    expect(xLength('Retry the node.')).toBe(15)
    expect(xLength('café ✅')).toBe(6)
  })
  it('weighs every link 23, whatever its length', () => {
    expect(xLength('https://x.co')).toBe(23)
    expect(xLength(`see ${LINK} and http://a.very.long.example.com/with/a/path?q=1 now`)).toBe(4 + 23 + 5 + 23 + 4)
  })
})

describe('postSlotHours', () => {
  it('spaces the posts three hours from the publish hour', () => {
    expect(postSlotHours(x)).toEqual([15, 18])
    expect(postSlotHours({ ...x, cadence: { postsPerDay: 1, kinds: ['text'], intents: ['ask'], repliesPerDay: 5 } })).toEqual([15])
  })
  it('slides the day earlier so the last post lands by 23', () => {
    expect(postSlotHours({ ...x, cadence: { postsPerDay: 4, kinds: ['text'], intents: ['ask'], repliesPerDay: 5 } })).toEqual([
      14, 17, 20, 23,
    ])
    expect(
      postSlotHours({ ...x, publishHour: 23, cadence: { postsPerDay: 2, kinds: ['text'], intents: ['ask'], repliesPerDay: 5 } })
    ).toEqual([20, 23])
  })
  it('never goes below midnight', () => {
    expect(
      postSlotHours({ ...x, publishHour: 23, cadence: { postsPerDay: 9, kinds: ['text'], intents: ['ask'], repliesPerDay: 5 } })[0]
    ).toBe(0)
  })
})

describe('postHook', () => {
  it('is the first line of the first part, trimmed', () => {
    expect(postHook(['  n8n retries three times.  \nSet it per node.', 'Part two.'])).toBe('n8n retries three times.')
    expect(postHook(['\nAfter a blank line.'])).toBe('After a blank line.')
    expect(postHook([])).toBe('')
  })
})
