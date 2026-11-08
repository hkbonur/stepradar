import { describe, expect, it } from 'vitest'
import { rankFound } from './found'
import type { FoundThread } from './types'

function found(externalId: string, reach: number, topics: string[]): FoundThread {
  return {
    externalId,
    url: `https://reddit.com/${externalId}`,
    title: externalId,
    text: '',
    postedAt: 0,
    author: { handle: 'dana', name: 'dana' },
    reach,
    community: 'n8n',
    comments: 0,
    topics,
  }
}

describe('rankFound', () => {
  it('keeps an item two terms found once, with both terms, the best first and no more than the limit', () => {
    expect(rankFound([found('a', 10, ['n8n']), found('b', 30, ['n8n']), found('a', 10, ['webhooks']), found('c', 5, ['n8n'])], 2)).toEqual([
      found('b', 30, ['n8n']),
      found('a', 10, ['n8n', 'webhooks']),
    ])
  })
})
