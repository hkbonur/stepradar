import { describe, expect, it } from 'vitest'
import type { PostKind } from './post-kinds'
import { postDraftProblems, postProblems } from './post-rules'

const LINK = 'http://localhost:3300/go/abc1234'

/** A post on X: its title only names it in the studio. */
const onX = (kind: PostKind, parts: string[]) => postProblems({ platform: 'x', kind, community: null }, { title: '', parts })

describe('postProblems', () => {
  it('accepts a post that fits', () => {
    expect(onX('text', ['Short and true.'])).toEqual([])
    expect(onX('thread', ['a'.repeat(280), 'b'.repeat(280)])).toEqual([])
  })
  it('counts the parts by kind', () => {
    expect(onX('text', ['One.', 'Two.'])).toEqual(['A text post is one part.'])
    expect(onX('thread', ['One.'])).toEqual(['A thread is 2 to 6 parts.'])
    expect(
      onX(
        'thread',
        Array.from({ length: 7 }, () => 'Part.')
      )
    ).toEqual(['A thread is 2 to 6 parts.'])
  })
  it('names an empty part and a part over the limit, the last part included', () => {
    expect(onX('thread', ['One.', '  ', 'Three.'])).toEqual(['Part 2 is empty.'])
    expect(onX('thread', ['One.', 'b'.repeat(281), 'Three.'])).toEqual(['Part 2 is 281 characters; X allows 280.'])
    expect(onX('text', ['a'.repeat(281)])).toEqual(['Part 1 is 281 characters; X allows 280.'])
  })
  it('weighs a link in a part 23', () => {
    expect(onX('text', [`${'a'.repeat(256)} ${LINK}`])).toEqual([])
    expect(onX('text', [`${'a'.repeat(257)} ${LINK}`])).toEqual(['Part 1 is 281 characters; X allows 280.'])
  })
  it('lists every problem in order', () => {
    expect(onX('text', ['', 'two'])).toEqual(['A text post is one part.', 'Part 1 is empty.'])
  })
})

describe('a post beyond X', () => {
  it('posts a Reddit title within 300 characters, and a body as long as Reddit takes', () => {
    const reddit = { platform: 'reddit' as const, kind: 'text' as const, community: 'n8n' }
    expect(postProblems(reddit, { title: 'How do you retry webhooks?', parts: ['a'.repeat(5_000)] })).toEqual([])
    expect(postProblems(reddit, { title: '  ', parts: ['Body.'] })).toEqual(['Write the title Reddit shows.'])
    expect(postProblems(reddit, { title: 't'.repeat(301), parts: ['Body.'] })).toEqual([
      'A title on Reddit is at most 300 characters; this one is 301.',
    ])
  })

  it('titles a Hacker News post for where it goes, and gives talking points, not the text', () => {
    const points = '- Retries run twice\n- Cap them\nFact: https://example.com'
    const hn = (community: string) => ({ platform: 'hackernews' as const, kind: 'text' as const, community })
    expect(postProblems(hn('Show HN'), { title: 'Show HN: Forms that agents send', parts: [points] })).toEqual([])
    expect(postProblems(hn('Show HN'), { title: 'Forms that agents send', parts: [points] })).toEqual([
      'A post on Show HN has a title that starts "Show HN: ".',
    ])
    expect(postProblems(hn('Hacker News'), { title: 'Ask HN: anyone?', parts: [points] })).toEqual([
      'Only a post on Ask HN starts its title "Ask HN: ".',
    ])
    // The writer's draft is talking points; what the operator posts is their own words.
    expect(postDraftProblems(hn('Ask HN'), { title: `Ask HN: ${'q'.repeat(80)}`, parts: ['A paragraph.'] })).toEqual([
      'A title on Hacker News is at most 80 characters; this one is 88.',
      'Write the talking points, one per line beginning "- ".',
    ])
    expect(postProblems(hn('Ask HN'), { title: 'Ask HN: how do you retry?', parts: ['A paragraph in my own words.'] })).toEqual([])
  })

  it('takes no thread on LinkedIn', () => {
    expect(postProblems({ platform: 'linkedin', kind: 'thread', community: null }, { title: '', parts: ['One.', 'Two.'] })).toEqual([
      'A post on LinkedIn is one part: no thread.',
    ])
  })
})
