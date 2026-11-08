import { describe, expect, it } from 'vitest'
import { foundPosted, postedItemOf, saidPosted, wentOutAt } from './posted'

const ITEM = {
  externalId: '41',
  parts: ['Use an idempotency key.'],
  postedAt: 1_000,
  likes: 0,
  reposts: 0,
  replies: 0,
  parentId: '7',
  url: 'https://news.ycombinator.com/item?id=41',
  community: 'Hacker News',
  lang: null,
}

describe('posted', () => {
  it('records how a draft went out: said with no link, linked, or found by the match', () => {
    expect(saidPosted(5, null, null)).toEqual({ kind: 'said', at: 5 })
    const linked = saidPosted(5, { url: 'https://x.com/ada/status/1', externalId: '1' }, 0.2)
    expect(linked).toEqual({ kind: 'linked', at: 5, url: 'https://x.com/ada/status/1', externalId: '1', editShare: 0.2 })
    // The match takes the platform's time, id and link, with the edit share decided for it.
    expect(foundPosted(ITEM, 0.2)).toEqual({ kind: 'found', at: 1_000, externalId: '41', url: ITEM.url, editShare: 0.2 })
    expect(foundPosted({ ...ITEM, url: null }, null)).toEqual({ kind: 'found', at: 1_000, externalId: '41' })
  })

  it('names the item that went out, none before or without a link, and when', () => {
    expect(postedItemOf(undefined)).toBeNull()
    expect(postedItemOf({ kind: 'said', at: 5 })).toBeNull()
    expect(postedItemOf(foundPosted(ITEM, null))).toEqual({ kind: 'found', at: 1_000, externalId: '41', url: ITEM.url })
    expect(wentOutAt({ _id: 'p1', posted: { kind: 'said', at: 5 } })).toBe(5)
    expect(() => wentOutAt({ _id: 'p1' })).toThrow('p1 went out, but says nothing of when')
  })
})
