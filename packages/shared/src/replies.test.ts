import { describe, expect, it } from 'vitest'
import {
  DRAFT_STALE_MS,
  MATCH_WINDOW_MS,
  OPENED_DRAFT_STALE_MS,
  asksForLink,
  draftRank,
  staleAt,
  REPLY_FRESH_MS,
  heardVerdict,
  namesSponsor,
  replyProblems,
  replyRuleCovers,
  replyRuleOf,
  type HeardThread,
  fitVerdict,
} from './replies'

const NOW = Date.UTC(2026, 9, 13, 12)
const HOUR = 3_600_000

function heard(overrides: Partial<HeardThread> = {}): HeardThread {
  return {
    origin: 'search',
    externalId: '1840',
    comments: null,
    title: null,
    text: 'What is your go-to setup for n8n tutorials?',
    url: 'https://x.com/dana_automates/status/1840',
    postedAt: NOW - HOUR,
    author: { handle: 'dana_automates', name: 'Dana Ruiz' },
    reach: 12_400,
    community: null,
    pillar: 'n8n tutorials',
    ...overrides,
  }
}

const CONTEXT = { platform: 'x' as const, accountHandle: 'ada_builds', sponsorName: 'Formstep', answered: new Set<string>(), now: NOW }

describe('what the listener keeps', () => {
  it('keeps a recent post with reach in the pillars', () => {
    expect(heardVerdict(heard(), CONTEXT)).toEqual({ kind: 'keep' })
  })

  it("drops the account's own posts, answered posts, old posts, and found posts without reach", () => {
    expect(heardVerdict(heard({ author: { handle: '@Ada_Builds', name: 'Ada' } }), CONTEXT).kind).toBe('drop')
    expect(heardVerdict(heard(), { ...CONTEXT, answered: new Set(['1840']) }).kind).toBe('drop')
    expect(heardVerdict(heard({ postedAt: NOW - REPLY_FRESH_MS.search - 1 }), CONTEXT).kind).toBe('drop')
    expect(heardVerdict(heard({ author: { handle: 'tomtries', name: 'Tom' }, reach: 410 }), CONTEXT).kind).toBe('drop')
  })

  it('keeps a mention from a small account, and for longer than a found post', () => {
    const mention = heard({ origin: 'mention', author: { handle: 'tomtries', name: 'Tom' }, reach: 410, postedAt: NOW - 20 * HOUR })
    expect(heardVerdict(mention, CONTEXT)).toEqual({ kind: 'keep' })
  })

  it('passes on a post naming the sponsor, with the reason the operator reads', () => {
    expect(heardVerdict(heard({ text: "Has anyone tried formstep's forms?" }), CONTEXT)).toEqual({
      kind: 'skip',
      reason: 'It names Formstep; the account answers about its sponsor only when you ask.',
    })
    expect(namesSponsor('Formsteps are hard', 'Formstep')).toBe(false)
    expect(DRAFT_STALE_MS).toBeGreaterThan(REPLY_FRESH_MS.search)
  })
})

describe('what a reply may say', () => {
  it('holds a reply to its platform: X counts to 280 and takes no link, Reddit takes a long reply with one', () => {
    expect(replyProblems('Cap the retries and alert on the last one.', 'x')).toEqual([])
    expect(replyProblems('  ', 'x')).toEqual(['Write the reply.'])
    expect(replyProblems('a'.repeat(281), 'x')).toEqual(['A reply on X is at most 280 characters; this one is 281.'])
    expect(replyProblems('See https://example.com', 'x')).toEqual(['Leave links out of a reply on X.'])
    expect(replyProblems(`${'a'.repeat(900)} https://example.com`, 'reddit')).toEqual([])
    expect(replyProblems('a'.repeat(1_251), 'linkedin')).toEqual(['A reply on LinkedIn is at most 1250 characters; this one is 1251.'])
  })
})

describe('reply rules', () => {
  it('reads what a never and an only rule cover', () => {
    expect(replyRuleOf('Never reply to politics.')).toEqual({ kind: 'never', words: ['politic'] })
    expect(replyRuleOf('Only reply to people building agents.')).toEqual({ kind: 'only', words: ['building', 'agent'] })
    expect(replyRuleOf('Never open with a question.')).toBeNull()
  })

  it('passes on a post a never rule names and a post an only rule does not', () => {
    expect(replyRuleCovers('Never reply to politics.', 'Politics aside, the new AI bill could change n8n.')).toBe(true)
    expect(replyRuleCovers('Never reply to politics.', 'What is your go-to n8n setup?')).toBe(false)
    expect(replyRuleCovers('Only reply to people building agents.', 'Is n8n still worth learning, or is it all agents now?')).toBe(false)
    expect(replyRuleCovers('Only reply to people building agents.', 'What is your go-to n8n setup?')).toBe(true)
  })
})

describe('fitVerdict', () => {
  const fit = { relevant: true, intent: 'question' as const, replyWorthy: true, score: 0.8, confidence: 0.7, reason: 'about retries' }
  it("keeps a post on topic and worth an answer, and drops the rest with the classifier's reason", () => {
    expect(fitVerdict(fit)).toEqual({ kind: 'keep' })
    expect(fitVerdict({ ...fit, relevant: false, reason: 'food' })).toEqual({ kind: 'drop', reason: 'off topic: food' })
    expect(fitVerdict({ ...fit, replyWorthy: false, reason: 'thanks only' })).toEqual({
      kind: 'drop',
      reason: 'nothing worth saying back: thanks only',
    })
  })
})

describe('reach and freshness beyond X', () => {
  it('drops no Reddit thread for its score, and answers a pasted thread however old it is', () => {
    expect(heardVerdict(heard({ reach: 3 }), { ...CONTEXT, platform: 'reddit' })).toEqual({ kind: 'keep' })
    expect(heardVerdict(heard({ origin: 'pasted', postedAt: NOW - 30 * 24 * HOUR }), CONTEXT)).toEqual({ kind: 'keep' })
  })
})

describe('a draft that waits', () => {
  const written = { status: 'draft' as const, heardAt: NOW - 2 * HOUR, writtenAt: NOW - HOUR }

  it('goes stale a day after it was written, or a week after the operator opened it', () => {
    expect(staleAt(written)).toBe(NOW - HOUR + DRAFT_STALE_MS)
    expect(staleAt({ heardAt: NOW })).toBe(NOW + DRAFT_STALE_MS)
    expect(staleAt({ ...written, openedAt: NOW })).toBe(NOW + OPENED_DRAFT_STALE_MS)
  })

  it('asks for its link two days after the operator opened it, while it waits', () => {
    expect(asksForLink(written, NOW)).toBe(false)
    expect(asksForLink({ ...written, openedAt: NOW }, NOW + MATCH_WINDOW_MS)).toBe(false)
    expect(asksForLink({ ...written, openedAt: NOW }, NOW + MATCH_WINDOW_MS + 1)).toBe(true)
    expect(asksForLink({ ...written, status: 'posted', openedAt: NOW }, NOW + MATCH_WINDOW_MS + 1)).toBe(false)
  })
})

describe('Today', () => {
  const fit = { relevant: true, intent: 'question' as const, replyWorthy: true, score: 0.8, confidence: 0.7, reason: 'about retries' }

  it('ranks a draft by its fit, weighed by the freshness left in its thread, and a pasted one by its fit alone', () => {
    expect(draftRank({ origin: 'search', fit, thread: { postedAt: NOW } }, NOW)).toBe(0.8)
    expect(draftRank({ origin: 'search', fit, thread: { postedAt: NOW - REPLY_FRESH_MS.search / 2 } }, NOW)).toBeCloseTo(0.4)
    expect(draftRank({ origin: 'search', fit, thread: { postedAt: NOW - 2 * REPLY_FRESH_MS.search } }, NOW)).toBe(0)
    expect(draftRank({ origin: 'pasted', fit, thread: { postedAt: null } }, NOW)).toBe(0.8)
  })
})
