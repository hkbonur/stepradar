import { describe, expect, it } from 'vitest'
import type { Doc, Id } from '../_generated/dataModel'
import { nextSteps, type NextStepsInput } from './steps'

const HOUR = 3_600_000
const NOW = Date.UTC(2026, 9, 14, 12)

const ADA = { _id: 'a1' as Id<'accounts'>, platform: 'reddit', handle: 'ada' } as Doc<'accounts'>

const reply = (id: string, title: string | null) =>
  ({
    _id: id as Id<'replies'>,
    posted: { kind: 'linked', at: 0, url: `https://www.reddit.com/r/n8n/comments/${id}/`, externalId: `t1_${id}` },
    thread: { title, url: 'https://www.reddit.com/r/n8n/' },
  }) as Doc<'replies'>

const experiment = (name: string) => ({ _id: 'e1' as Id<'experiments'>, name, kind: 'reply_style', minItems: 15 }) as Doc<'experiments'>

const NONE: NextStepsInput = {
  comments: [],
  firstDrafts: [],
  takingOff: [],
  drafts: [],
  nearDecision: [],
  decided: [],
  standouts: [],
  behind: [],
  leaks: [],
}

describe('the next steps', () => {
  it('ranks comments first, then a thread taking off, a draft about to go stale and a near decision', () => {
    const steps = nextSteps(
      {
        comments: [{ account: ADA, waiting: 2 }],
        firstDrafts: [],
        takingOff: [{ account: ADA, reply: reply('r1', 'Webhook retries'), reach: 640, grew: 420 }],
        drafts: [{ account: ADA, reply: reply('r2', null), staleAt: NOW + 2 * HOUR }],
        nearDecision: [{ account: ADA, experiment: experiment('Reply style: Story vs Tip'), variantLabel: 'Story', items: 14 }],
        decided: [],
        standouts: [],
        behind: [],
        leaks: [],
      },
      NOW
    )
    expect(steps.map((step) => [step.kind, step.text, step.url])).toEqual([
      ['comments', 'Answer 2 comments for u/ada: the drafts wait under each.', '/'],
      [
        'taking_off',
        'Your reply on Webhook retries is taking off: 640 reach, up 420 since the read before. Answer what comes in.',
        'https://www.reddit.com/r/n8n/comments/r1/',
      ],
      ['draft', 'A draft for u/ada goes stale in 2 hours: post it or let it go.', '/accounts/a1/replies'],
      [
        'near_decision',
        '"Reply style: Story vs Tip" can be decided once "Story" has one more measured reply: it has 14 of 15.',
        '/experiments',
      ],
    ])
  })

  it('says what a decision of the last week changes, and nothing of a draft with time left or an older decision', () => {
    const decided = (daysAgo: number) => ({
      account: ADA,
      experiment: experiment('Reply length: Long vs Short'),
      winnerLabel: 'Long',
      description: 'Answer in a paragraph or more, with the detail that helps.',
      decidedAt: NOW - daysAgo * 24 * HOUR,
    })
    const steps = nextSteps(
      { ...NONE, drafts: [{ account: ADA, reply: reply('r2', null), staleAt: NOW + 20 * HOUR }], decided: [decided(2)] },
      NOW
    )
    expect(steps.map((step) => step.text)).toEqual([
      '"Long" won "Reply length: Long vs Short": from now on u/ada will answer in a paragraph or more, with the detail that helps.',
    ])
    expect(nextSteps({ ...NONE, decided: [decided(9)] }, NOW)).toEqual([])
  })

  it("asks for a new account's first post after the comments, on the replies page for a reply and on the post's page for a post", () => {
    const MAX = { _id: 'a2' as Id<'accounts'>, platform: 'x', handle: 'max' } as Doc<'accounts'>
    const steps = nextSteps(
      {
        ...NONE,
        comments: [{ account: ADA, waiting: 1 }],
        firstDrafts: [
          { account: ADA, draft: { kind: 'reply' } },
          { account: MAX, draft: { kind: 'post', postId: 'p1' as Id<'posts'> } },
        ],
      },
      NOW
    )
    expect(steps.map((step) => [step.kind, step.text, step.url])).toEqual([
      ['comments', 'Answer 1 comment for u/ada: the drafts wait under each.', '/'],
      ['first_post', "No draft of u/ada's has gone out yet: post one on Reddit yourself, then mark it posted.", '/accounts/a1/replies'],
      ['first_post', "No draft of @max's has gone out yet: post one on X yourself, then mark it posted.", '/posts/p1'],
    ])
  })

  it('proposes testing posts modeled on a thread that did well, after every other kind of step', () => {
    const steps = nextSteps(
      {
        ...NONE,
        comments: [{ account: ADA, waiting: 1 }],
        standouts: [{ account: ADA, title: 'I replaced three tools with one n8n flow' }],
      },
      NOW
    )
    expect(steps.map((step) => [step.kind, step.text, step.url])).toEqual([
      ['comments', 'Answer 1 comment for u/ada: the drafts wait under each.', '/'],
      [
        'standout',
        `People answered "I replaced three tools with one n8n flow" far more than the other threads found in u/ada's niche: test posts modeled on what worked.`,
        '/experiments',
      ],
    ])
  })

  it('asks an account that fell behind to post, after its first post, and says where each leak is to fix', () => {
    const MAX = { _id: 'a2' as Id<'accounts'>, platform: 'x', handle: 'max' } as Doc<'accounts'>
    const steps = nextSteps(
      {
        ...NONE,
        behind: [{ account: ADA, week: { due: 4, posted: 1 } }],
        leaks: [
          { account: MAX, leak: { step: 'click', rate: 0.004, before: 0.012, mock: false } },
          { account: ADA, leak: { step: 'signup', rate: 0, before: null, mock: true } },
        ],
      },
      NOW
    )
    expect(steps.map((step) => [step.kind, step.text, step.url])).toEqual([
      [
        'consistency',
        'u/ada posted 1 of the 4 posts due this week: an account that posts on schedule keeps growing. Its drafts wait on its page.',
        '/accounts/a1',
      ],
      [
        'leak',
        "0.40% of the people @max's linked posts reached in 28 days clicked through against 1.20% in the 28 days before. The strategy review tests how its posts open and end on that next.",
        '/reports/a2',
      ],
      [
        'leak',
        'None of the clicks from u/ada in 28 days became signups: the page they land on loses them, not the posts. Mock numbers.',
        '/reports/a1',
      ],
    ])
  })

  it('names how far a variant is from a decision', () => {
    const [step] = nextSteps(
      { ...NONE, nearDecision: [{ account: ADA, experiment: experiment('Reply style: Story vs Tip'), variantLabel: 'Story', items: 14 }] },
      NOW
    )
    expect(step).toMatchObject({
      kind: 'near_decision',
      text: '"Reply style: Story vs Tip" can be decided once "Story" has one more measured reply: it has 14 of 15.',
      items: 14,
      minItems: 15,
    })
  })
})
