import { describe, expect, it } from 'vitest'
import { repeatedShare } from './similarity'
import { asksSomething, roundupOf, standouts } from './what-worked'
import type { SignalSource } from './signals'

const thread = (id: string, source: SignalSource, score: number) => ({ id, source, score })

describe('standouts', () => {
  it('picks the threads that moved at least twice the median of the others of their source, the most out of line first', () => {
    const found = [
      thread('r1', 'reddit', 380),
      thread('r2', 'reddit', 107),
      thread('r3', 'reddit', 90),
      thread('h1', 'hackernews', 150),
      thread('h2', 'hackernews', 60),
      thread('h3', 'hackernews', 50),
      thread('h4', 'hackernews', 55),
    ]
    expect(standouts(found).map((standout) => standout.id)).toEqual(['r1', 'h1'])
  })

  it('compares a thread only within its source and with enough others, and never reads suggestions or comments', () => {
    // A forum read and a Reddit point are no common unit: 900 forum reads stand out among nothing on Reddit.
    expect(standouts([thread('f1', 'forum', 900), thread('r1', 'reddit', 10), thread('r2', 'reddit', 12)])).toEqual([])
    expect(standouts([thread('s1', 'search', 90), thread('s2', 'search', 5), thread('s3', 'search', 5)])).toEqual([])
    // Among threads nobody answered, one anyone answered stands out.
    expect(standouts([thread('x1', 'x', 3), thread('x2', 'x', 0), thread('x3', 'x', 0)]).map((standout) => standout.id)).toEqual(['x1'])
  })
})

describe('roundupOf', () => {
  const question = (id: string, pillar: string, score: number) => ({ id, pillar, score })

  it('takes the pillar with the most questions, at least four, the most moved first and at most eight', () => {
    const asked = [
      ...Array.from({ length: 10 }, (_, index) => question(`w${index}`, 'webhooks', index)),
      ...Array.from({ length: 5 }, (_, index) => question(`f${index}`, 'forms', 100 + index)),
    ]
    const roundup = roundupOf(asked)
    expect(roundup?.pillar).toBe('webhooks')
    expect(roundup?.questions.map((entry) => entry.id)).toEqual(['w9', 'w8', 'w7', 'w6', 'w5', 'w4', 'w3', 'w2'])
  })

  it('breaks a tie by what the questions moved, and makes none from three', () => {
    const tied = ['a', 'b', 'c', 'd'].flatMap((id) => [question(`w${id}`, 'webhooks', 1), question(`f${id}`, 'forms', 2)])
    expect(roundupOf(tied)?.pillar).toBe('forms')
    expect(roundupOf([question('1', 'forms', 1), question('2', 'forms', 1), question('3', 'forms', 1)])).toBeNull()
  })

  it('reads a title as a question when it asks one', () => {
    expect(asksSomething('How do you collect documents from clients?')).toBe(true)
    expect(asksSomething('Show HN: my form builder')).toBe(false)
  })
})

describe('repeatedShare', () => {
  it('says how much of a source a text repeats, all of it when the text quotes it whole', () => {
    const title = 'How do you collect documents from clients?'
    expect(repeatedShare(title, `Everyone asks this. ${title} Here is what I do.`)).toBe(1)
    expect(repeatedShare(title, 'Chasing clients for PDFs? I send one form and the files come back into the flow.')).toBe(0)
    expect(repeatedShare('', 'anything')).toBe(0)
  })
})
