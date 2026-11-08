import {
  EXPERIMENT_CATALOG,
  PLATFORM_LABELS,
  POST_INTENTS,
  POST_LENGTHS,
  catalogControl,
  postLengthOf,
  postProblems,
  replyProblems,
  type PostLength,
} from '@influstep/shared'
import { describe, expect, it } from 'vitest'
import { mockLlm } from './mock'
import type { PostBrief, ReplyBrief } from './types'
import { postDisclosureProblems } from '../../core/disclosure'

const SPONSOR = 'Formstep'
const PITCH = 'Forms that workflows and AI agents send to one customer; the answers come back into the flow.'

const ACCOUNT = {
  name: 'Ada Automates',
  handle: 'ada_automates',
  platform: 'x' as const,
  placeName: 'X',
  niche: 'automation for small teams',
  tone: 'plain',
  bible: 'Ada says the point first.',
  pillars: ['n8n tutorials'],
}

const TRACKED = 'http://localhost:3300/go/abc1234'
const DIRECT = 'https://formstep.io/?utm_source=ada&utm_medium=reddit&utm_campaign=webhooks-ab12'

/** How often a draft carries its link. */
const linksIn = (text: string, link: string) => text.split(link).length - 1

function postBrief(overrides: Partial<PostBrief> & { length: PostLength }): PostBrief {
  return {
    account: ACCOUNT,
    kind: overrides.length === 'long' ? 'thread' : 'text',
    concept: 'React to: n8n webhooks that retry',
    pillar: 'n8n tutorials',
    sponsor: null,
    sponsorName: SPONSOR,
    sponsorPitch: PITCH,
    memory: { goal: 'Paying Formstep customers', standing: null, rules: [], facts: [], learnings: [] },
    directives: [],
    signals: [{ title: 'n8n webhooks that retry', summary: 'People ask how.', url: 'https://news.ycombinator.com/item?id=1' }],
    basis: null,
    research: { brief: null, problems: [] },
    community: null,
    affiliationLine: `I'm building ${SPONSOR}, so take this with salt.`,
    intent: 'teach',
    hook: catalogControl('hook'),
    callToAction: catalogControl('call_to_action'),
    voice: null,
    examples: [],
    posted: { texts: [], editShare: null },
    problems: [],
    judged: null,
    ...overrides,
  }
}

describe('the mock post writer', () => {
  it('writes a post in the shape and limits of each platform, under its title', async () => {
    const places = [
      { platform: 'linkedin' as const, community: null },
      { platform: 'reddit' as const, community: { name: 'n8n', rules: 'Be kind.' } },
      { platform: 'hackernews' as const, community: { name: 'Show HN', rules: null } },
      { platform: 'hackernews' as const, community: { name: 'Ask HN', rules: null } },
      { platform: 'hackernews' as const, community: { name: 'Hacker News', rules: null } },
    ]
    for (const place of places) {
      for (const sponsorSegment of ['none', 'mention'] as const) {
        const link = place.platform === 'linkedin' ? TRACKED : DIRECT
        const brief = postBrief({
          length: 'medium',
          kind: 'text',
          account: { ...ACCOUNT, platform: place.platform, placeName: PLATFORM_LABELS[place.platform] },
          community: place.community,
          sponsor: sponsorSegment === 'none' ? null : { link },
        })
        const draft = await mockLlm.writePost(brief)
        const where = `${place.platform}/${place.community?.name ?? '-'}/${sponsorSegment}`
        // Hacker News takes the link as the submission's URL, never in the talking points.
        const carried = sponsorSegment === 'none' || place.platform === 'hackernews' ? 0 : 1
        expect(linksIn(draft.parts.join('\n'), link), where).toBe(carried)
        expect(postProblems({ platform: place.platform, kind: 'text', community: place.community?.name ?? null }, draft), where).toEqual([])
        expect(
          postDisclosureProblems([draft.title, ...draft.parts].join('\n'), {
            sponsorName: SPONSOR,
            affiliationLine: brief.affiliationLine,
            sponsored: sponsorSegment !== 'none',
          }),
          where
        ).toEqual([])
      }
    }
  })

  it("writes every intent at every length within X's rules, at the length it was asked for", async () => {
    for (const intent of POST_INTENTS) {
      for (const length of POST_LENGTHS) {
        for (const sponsorSegment of ['none', 'mention'] as const) {
          const brief = postBrief({ intent, length, sponsor: sponsorSegment === 'none' ? null : { link: TRACKED } })
          const draft = await mockLlm.writePost(brief)
          // A one-liner never carries the sponsor (the planner gives it none), so it has no link to carry.
          if (sponsorSegment === 'mention' && length !== 'short') expect(linksIn(draft.parts.join('\n'), TRACKED)).toBe(1)
          expect(
            postProblems({ platform: 'x', kind: brief.kind, community: null }, draft),
            `${intent}/${length}/${sponsorSegment}`
          ).toEqual([])
          expect(
            postDisclosureProblems(draft.parts.join('\n'), {
              sponsorName: SPONSOR,
              affiliationLine: brief.affiliationLine,
              sponsored: sponsorSegment !== 'none',
            })
          ).toEqual([])
          expect(postLengthOf(draft.parts), `${intent}/${length}/${sponsorSegment}`).toBe(length)
        }
      }
    }
  })

  it('writes the same post with or without a morning brief and a problem log', async () => {
    const plain = await mockLlm.writePost(postBrief({ length: 'medium' }))
    const researched = await mockLlm.writePost(
      postBrief({ length: 'medium', research: { brief: 'Webhooks moved.', problems: ['Why does my retry loop?'] } })
    )
    expect(researched).toEqual(plain)
  })
})

describe('the mock reply writer', () => {
  /** A thread on X by `handle`, whose followers are its reach. */
  function thread(text: string, handle: string, reach: number): ReplyBrief['thread'] {
    return {
      url: `https://x.com/${handle}/status/1`,
      title: null,
      text,
      postedAt: 0,
      author: { handle, name: handle },
      reach,
      community: null,
    }
  }

  function replyBrief(overrides: Partial<ReplyBrief> = {}): ReplyBrief {
    return {
      account: { ...ACCOUNT, bible: '' },
      platform: 'x',
      origin: 'search',
      thread: thread('Politics aside, the new AI bill could change n8n for small shops.', 'kai', 25_800),
      pillar: 'n8n tutorials',
      sponsorName: SPONSOR,
      sponsorPitch: PITCH,
      affiliationLine: `I'm building ${SPONSOR}, so take this with salt.`,
      mayNameSponsor: true,
      community: null,
      operatorAsked: false,
      style: catalogControl('reply_style'),
      length: catalogControl('reply_length'),
      memory: { goal: 'Paying Formstep customers', standing: null, rules: ['Never reply to politics.'], facts: [], learnings: [] },
      directives: [],
      voice: null,
      posted: { texts: [], editShare: null },
      problems: [],
      ...overrides,
    }
  }

  it('passes on a post its rule covers, and answers it when the operator asks', async () => {
    expect(await mockLlm.writeReply(replyBrief())).toEqual({ kind: 'skip', reason: 'My rule "Never reply to politics." covers this post.' })
    const asked = await mockLlm.writeReply(replyBrief({ operatorAsked: true }))
    expect(asked.kind).toBe('reply')
  })

  it("answers a mention by name, within X's rules, and the sponsor only when the operator asked", async () => {
    const mention = await mockLlm.writeReply(
      replyBrief({
        origin: 'mention',
        thread: thread('@ada_automates which form tool?', 'tom', 410),
      })
    )
    if (mention.kind !== 'reply') throw new Error('the mention was passed on')
    expect(mention.text).toMatch(/^Thanks for the mention, @tom!/)
    expect(replyProblems(mention.text, 'x')).toEqual([])

    const sponsored = replyBrief({
      thread: thread('Has anyone tried Formstep?', 'mira', 5_400),
    })
    const plain = await mockLlm.writeReply(sponsored)
    if (plain.kind !== 'reply') throw new Error('the post was passed on')
    expect(plain.text).not.toContain(SPONSOR)
    const answered = await mockLlm.writeReply({ ...sponsored, operatorAsked: true })
    if (answered.kind !== 'reply') throw new Error('the asked post was passed on')
    expect(answered.text).toContain(`I'm building ${SPONSOR}, so take this with salt. ${SPONSOR} does that`)
  })

  it('answers in the reply style it is given', async () => {
    const write = async (key: string) => {
      const style = EXPERIMENT_CATALOG.reply_style.find((variant) => variant.key === key)
      if (!style) throw new Error(`no reply style "${key}"`)
      const draft = await mockLlm.writeReply(replyBrief({ style, memory: { ...replyBrief().memory, rules: [] } }))
      if (draft.kind !== 'reply') throw new Error('the post was passed on')
      expect(replyProblems(draft.text, 'x')).toEqual([])
      return draft.text
    }
    expect(await write('question')).toMatch(/\?$/)
    expect(await write('tip')).not.toMatch(/\?$/)
    expect(await write('story')).not.toEqual(await write('tip'))
  })
})
