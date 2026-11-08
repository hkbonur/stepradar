import { afterEach, describe, expect, it, vi } from 'vitest'
import { anthropicClassifier } from './anthropic'
import { mockClassifier } from './mock'
import type { ClassifyBrief } from './types'

const BRIEF: ClassifyBrief = {
  platform: 'reddit',
  placeName: 'Reddit',
  niche: 'n8n automations',
  audience: 'ops leads',
  pillars: ['n8n tutorials', 'webhook retries'],
  sponsorName: 'Formstep',
  sponsorPitch: 'Forms that workflows send to one customer.',
  posts: [
    { origin: 'search', text: 'My n8n webhook retries twice, why?' },
    { origin: 'search', text: 'Best pizza in Oslo tonight' },
    { origin: 'mention', text: 'thanks!' },
  ],
}

describe("the mock classifier's read of a community's rules", () => {
  it('finds a rule that forbids promotion, one that allows it, or none', async () => {
    const read = (rules: string) => mockClassifier.communityRules({ platform: 'reddit', placeName: 'Reddit', community: 'n8n', rules })
    expect((await read('Be kind.\nNo self-promotion or advertising.')).selfPromotion).toBe('forbidden')
    expect((await read('Self-promotion is welcome on Fridays.')).selfPromotion).toBe('allowed')
    expect((await read('Be kind.\nSearch first.')).selfPromotion).toBe('unknown')
  })
})

describe('the mock classifier', () => {
  it('keeps what shares the niche or was said to the account, and drops the rest as off topic', async () => {
    const [onTopic, offTopic, mention] = await mockClassifier.classify(BRIEF)
    expect(onTopic).toMatchObject({ relevant: true, replyWorthy: true, intent: 'question' })
    expect(offTopic).toMatchObject({ relevant: false, replyWorthy: false, reason: 'nothing about the niche' })
    expect(mention).toMatchObject({ relevant: true, reason: 'spoken to the account' })
  })
})

/** The Messages API's answer: the structured output as the model's text. */
function stubAnthropic(posts: unknown[]) {
  const fetch = vi.fn(
    async (_input: string | URL | Request, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          id: 'msg_test',
          type: 'message',
          role: 'assistant',
          model: 'claude-haiku-5-5',
          content: [{ type: 'text', text: JSON.stringify({ posts }) }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 10 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
  )
  vi.stubGlobal('fetch', fetch)
  return fetch
}

const READ = { relevant: true, intent: 'question', replyWorthy: true, score: 0.8, confidence: 0.6, reason: 'about retries' }

describe('the Claude classifier', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it("asks Haiku at low effort and returns a read per post, in the posts' order", async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')
    const fetch = stubAnthropic([
      { id: '2', ...READ, reason: 'thanks only', replyWorthy: false },
      { id: '0', ...READ },
      { id: '1', ...READ, relevant: false, replyWorthy: false, intent: 'other', score: 0, reason: 'food' },
    ])
    const fits = await anthropicClassifier.classify(BRIEF)
    expect(fits.map((fit) => fit.reason)).toEqual(['about retries', 'food', 'thanks only'])
    const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))
    expect(body).toMatchObject({ model: 'claude-haiku-5-5', output_config: { effort: 'low' } })
  })

  it('refuses a read that leaves a post out or scores it outside 0 to 1', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')
    stubAnthropic([{ id: '0', ...READ }])
    await expect(anthropicClassifier.classify(BRIEF)).rejects.toThrow('The classifier left out post 1')
    stubAnthropic([
      { id: '0', ...READ, score: 1.4 },
      { id: '1', ...READ },
      { id: '2', ...READ },
    ])
    await expect(anthropicClassifier.classify(BRIEF)).rejects.toThrow('The classifier scored post 0 outside 0 to 1')
  })
})
