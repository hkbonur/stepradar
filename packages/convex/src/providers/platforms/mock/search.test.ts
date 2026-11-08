import { describe, expect, it } from 'vitest'
import { mockSearch } from './search'

describe('mock search', () => {
  it('keeps the fixed automation stories for an account they touch', async () => {
    const found = await mockSearch('reddit')({ terms: ['n8n tutorials'], since: 0, limit: 5, communities: null, sponsorName: 'Formstep' })
    expect(found[0]?.title).toBe('n8n webhook fails silently when the client sends a form, how do I debug?')
  })

  it('tells an account in another niche stories about its own terms', async () => {
    const found = await mockSearch('hackernews')({
      terms: ['Figma how-tos', 'design systems'],
      since: 0,
      limit: 5,
      communities: null,
      sponsorName: 'Formstep',
    })
    expect(found.map((signal) => signal.title)).toEqual([
      'Ask HN: What does your figma how-tos setup look like?',
      'Show HN: I automated the boring part of design systems',
    ])
  })
})
