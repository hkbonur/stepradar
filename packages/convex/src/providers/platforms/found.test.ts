import { describe, expect, it } from 'vitest'
import { askedTerms, rankFound, searchTermGroups } from './found'
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

describe('askedTerms', () => {
  it('asks for the pillars and for the profile apart, and only for the pillars where the profile says nothing', () => {
    expect(askedTerms({}, ['n8n tutorials'], ['Typeform'])).toEqual([['n8n tutorials'], ['Typeform']])
    expect(askedTerms({}, ['n8n tutorials'], [])).toEqual([['n8n tutorials']])
  })

  it('asks a reader that ignores the terms once', () => {
    expect(askedTerms({ searchIgnoresTerms: true }, ['n8n tutorials'], ['Typeform'])).toEqual([['n8n tutorials']])
  })
})

describe('searchTermGroups', () => {
  it("asks a query for each group and keeps every thread in the order found, the account's own first, one both found once", async () => {
    const asked: string[][] = []
    const search = async (terms: string[]) => {
      asked.push(terms)
      return terms.includes('n8n') ? [found('a', 10, ['n8n'])] : [found('a', 10, ['Typeform']), found('b', 30, ['Typeform'])]
    }
    expect(await searchTermGroups({}, { own: ['n8n'], profile: ['Typeform'] }, search)).toEqual([
      found('a', 10, ['n8n', 'Typeform']),
      found('b', 30, ['Typeform']),
    ])
    expect(asked).toEqual([['n8n'], ['Typeform']])
  })
})
