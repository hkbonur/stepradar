import { describe, expect, it } from 'vitest'
import { groupQuestions, questionTokens, writeDayOf } from './research'

describe('writeDayOf', () => {
  it('is the day before', () => {
    expect(writeDayOf('2026-10-14')).toBe('2026-10-13')
  })

  it('crosses a month end, a leap day and a year end', () => {
    expect(writeDayOf('2026-11-01')).toBe('2026-10-31')
    expect(writeDayOf('2028-03-01')).toBe('2028-02-29')
    expect(writeDayOf('2027-03-01')).toBe('2027-02-28')
    expect(writeDayOf('2027-01-01')).toBe('2026-12-31')
  })

  it('refuses a string that is not a day', () => {
    expect(() => writeDayOf('2026-10')).toThrow('not a YYYY-MM-DD day')
  })
})

describe('questionTokens', () => {
  it('keeps words of three or more letters and digits, lowercased, without stopwords', () => {
    expect(questionTokens('How do I export a Figma frame to SVG?')).toEqual(['export', 'figma', 'frame', 'svg'])
    expect(questionTokens('Why is it so?')).toEqual([])
  })
})

describe('groupQuestions', () => {
  it('groups questions that share half their words, in input order, and keeps a lone one alone', () => {
    const groups = groupQuestions([
      { id: 'a', text: 'How do I export a Figma frame to SVG?' },
      { id: 'b', text: 'Can you export one Figma frame as SVG?' },
      { id: 'c', text: 'What price is Cursor Pro?' },
      { id: 'd', text: 'Export Figma frame SVG how?' },
    ])
    expect(groups).toEqual([
      { ids: ['a', 'b', 'd'], text: 'How do I export a Figma frame to SVG?', tokens: ['export', 'figma', 'frame', 'svg'] },
      { ids: ['c'], text: 'What price is Cursor Pro?', tokens: ['cursor', 'price', 'pro'] },
    ])
  })

  it('keeps only the tokens every member shares', () => {
    const groups = groupQuestions([
      { id: 'a', text: 'export figma frame svg quickly' },
      { id: 'b', text: 'export figma frame svg' },
    ])
    expect(groups).toEqual([{ ids: ['a', 'b'], text: 'export figma frame svg quickly', tokens: ['export', 'figma', 'frame', 'svg'] }])
  })

  it('names a group by its first question when its members share no word', () => {
    const groups = groupQuestions([
      { id: 'a', text: 'Retry a webhook?' },
      { id: 'b', text: 'Retry?' },
      { id: 'c', text: 'Webhook?' },
    ])
    expect(groups).toEqual([{ ids: ['a', 'b', 'c'], text: 'Retry a webhook?', tokens: ['retry', 'webhook'] }])
  })

  it('never groups two questions without a meaningful word', () => {
    expect(
      groupQuestions([
        { id: 'a', text: 'Why?' },
        { id: 'b', text: 'How?' },
      ]).map((group) => group.ids)
    ).toEqual([['a'], ['b']])
  })
})
