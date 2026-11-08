import { editShareOf, textSimilarity, type ImportedPost } from '@influstep/shared'
import { describe, expect, it } from 'vitest'
import type { Id } from '../_generated/dataModel'
import { matchItems, type PostCandidate, type ReplyCandidate } from './match'

const HOUR = 3_600_000
const NOW = Date.UTC(2026, 9, 14, 10)
const TIMEZONE = 'UTC'
const NONE = { known: new Set<string>(), timezone: TIMEZONE, platform: 'reddit' as const }

function item(overrides: Partial<ImportedPost> & Pick<ImportedPost, 'externalId'>): ImportedPost {
  return {
    parts: ['A comment.'],
    postedAt: NOW,
    likes: 0,
    reposts: 0,
    replies: 0,
    parentId: 't3_thread',
    url: null,
    community: 'n8n',
    lang: null,
    ...overrides,
  }
}

function reply(id: string, overrides: Partial<ReplyCandidate> = {}): ReplyCandidate {
  return {
    id: id as Id<'replies'>,
    inReplyTo: 't3_thread',
    writtenAt: NOW - 2 * HOUR,
    openedAt: null,
    text: 'Cap the retries at three and alert on the last one, so a failing webhook never runs twice.',
    externalId: null,
    ...overrides,
  }
}

function post(id: string, overrides: Partial<PostCandidate> = {}): PostCandidate {
  return {
    id: id as Id<'posts'>,
    externalId: null,
    community: 'n8n',
    plannedFor: '2026-10-14',
    writtenAt: NOW - 20 * HOUR,
    line: 'How do you keep a webhook from running twice?',
    ...overrides,
  }
}

describe('the match', () => {
  it('finds a Reddit reply the operator rewrote completely, by what it answers and when it was posted', () => {
    const posted = item({ externalId: 't1_mine', parts: ['Honestly? Idempotency keys. We dedupe on the event id in Postgres.'] })
    expect(textSimilarity(posted.parts[0] ?? '', reply('r1').text)).toBe(0)
    expect(matchItems([posted], { replies: [reply('r1')], posts: [] }, NONE)).toEqual({ replies: [{ id: 'r1', item: posted }], posts: [] })
  })

  it('takes the closer of two comments under one parent, and leaves the other to no draft', () => {
    const close = item({ externalId: 't1_close', parts: ['Cap the retries at three and alert on the last one. Saved me twice.'] })
    const other = item({ externalId: 't1_other', parts: ['Also, which queue do you use?'], postedAt: NOW - HOUR })
    expect(matchItems([other, close], { replies: [reply('r1')], posts: [] }, NONE).replies).toEqual([{ id: 'r1', item: close }])
  })

  it('finds a draft never opened from the studio, and prefers the one opened when the texts tie', () => {
    const posted = item({ externalId: 't1_mine', parts: ['Something else entirely.'] })
    const never = reply('never')
    const opened = reply('opened', { openedAt: NOW - HOUR })
    expect(matchItems([posted], { replies: [never], posts: [] }, NONE).replies).toEqual([{ id: 'never', item: posted }])
    expect(matchItems([posted], { replies: [never, opened], posts: [] }, NONE).replies).toEqual([{ id: 'opened', item: posted }])
  })

  it('finds a post by its community, its day and a title close enough, and none past it', () => {
    const titled = (overrides: Partial<ImportedPost>) =>
      item({ externalId: 't3_own', parentId: null, parts: ['How do you keep a webhook from running twice?\n\nMine does.'], ...overrides })
    const own = titled({})
    expect(matchItems([own], { replies: [], posts: [post('p1')] }, NONE).posts).toEqual([{ id: 'p1', item: own }])
    // Another subreddit, two days later, a different title, or before the post was written: no draft of the operator's.
    expect(matchItems([titled({ community: 'zapier' })], { replies: [], posts: [post('p1')] }, NONE).posts).toEqual([])
    expect(matchItems([titled({ postedAt: NOW + 48 * HOUR })], { replies: [], posts: [post('p1')] }, NONE).posts).toEqual([])
    expect(
      matchItems([titled({ parts: ['My weekend project: a form builder'] })], { replies: [], posts: [post('p1')] }, NONE).posts
    ).toEqual([])
    expect(matchItems([own], { replies: [], posts: [post('p1', { writtenAt: NOW + HOUR })] }, NONE).posts).toEqual([])
  })

  it('finds a forum reply wherever in its topic it went out, whatever post the operator clicked Reply under', () => {
    const forum = { ...NONE, platform: 'forum' as const }
    const underThird = item({ externalId: '41/7', parentId: '41/3' })
    expect(matchItems([underThird], { replies: [reply('topic', { inReplyTo: '41' })], posts: [] }, forum).replies).toEqual([
      { id: 'topic', item: underThird },
    ])
    // An answer to a comment, posted from the topic's own reply box.
    const fromBottom = item({ externalId: '41/8', parentId: '41' })
    expect(matchItems([fromBottom], { replies: [reply('fifth', { inReplyTo: '41/5' })], posts: [] }, forum).replies).toEqual([
      { id: 'fifth', item: fromBottom },
    ])
    expect(
      matchItems([item({ externalId: '42/2', parentId: '42' })], { replies: [reply('topic', { inReplyTo: '41' })], posts: [] }, forum)
        .replies
    ).toEqual([])
    // Elsewhere a reply answers only what it was drafted for.
    expect(matchItems([underThird], { replies: [reply('topic', { inReplyTo: '41' })], posts: [] }, NONE).replies).toEqual([])
  })

  it('pairs no draft reply with a post of its own, nor with a comment posted before the draft was written', () => {
    const own = item({ externalId: 't3_own', parentId: null, parts: ['Show HN: my weekend project'] })
    const early = item({ externalId: 't1_early', postedAt: NOW - 3 * HOUR })
    expect(matchItems([own, early], { replies: [reply('r1')], posts: [] }, NONE)).toEqual({ replies: [], posts: [] })
  })

  it('gives an item its link named to that reply or post whatever it answers, and leaves alone what was found before', () => {
    const named = item({ externalId: 't1_named', parentId: 't1_someone' })
    const story = item({ externalId: 't3_story', parentId: null })
    const before = item({ externalId: 't1_before' })
    const outcome = matchItems(
      [named, story, before],
      { replies: [reply('linked', { externalId: 't1_named' }), reply('waiting')], posts: [post('p1', { externalId: 't3_story' })] },
      { ...NONE, known: new Set(['t1_before']) }
    )
    expect(outcome).toEqual({ replies: [{ id: 'linked', item: named }], posts: [{ id: 'p1', item: story }] })
  })
})

describe('the edit share', () => {
  it('says how much of a ready draft the operator changed on X and LinkedIn, and nothing where they rewrite', () => {
    const draft = 'Cap the retries at three and alert on the last one.'
    expect(editShareOf('x', draft, draft)).toBe(0)
    expect(editShareOf('linkedin', draft, 'Something else entirely, in my own words.')).toBe(1)
    expect(editShareOf('x', draft, 'Cap the retries at three and alert on the final one.')).toBeGreaterThan(0)
    expect(editShareOf('reddit', draft, 'Anything.')).toBeNull()
    expect(editShareOf('hackernews', draft, draft)).toBeNull()
  })
})
