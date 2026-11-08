import { describe, expect, it } from 'vitest'
import { pillarWeights, type Platform, type PlatformFormat, type PostIntent, type PostLength, type XCadence } from '@influstep/shared'
import type { Doc, Id } from '../_generated/dataModel'
import {
  placePost,
  planPostSlots,
  planWeek,
  type KindSwap,
  type PlannerCommunity,
  type PlannerRework,
  type PlannerRoundup,
  type PlannerSignal,
  type PlannerStandout,
  type PostExperimentPlan,
} from './planner'

/** A signal id for a planner test: the planner never reads the table, only compares ids. */
const signalId = (name: string) => name as Id<'signals'>

const account = { pillars: ['n8n tutorials', 'AI agents', 'automation fails'] }

/** Three days of the week of 2026-10-12 already hold a post, so four are left to plan. */
const TAKEN = ['2026-10-13', '2026-10-15', '2026-10-17']

const equal = { pillarWeights: pillarWeights(account.pillars, undefined), priorCounts: {} }

describe('planWeek', () => {
  it('plans every day of the week that has no post yet', () => {
    const plan = planWeek({ weekStart: '2026-10-12', account, ...equal, signals: [], takenDays: TAKEN })
    expect(plan.map((post) => post.plannedFor)).toEqual(['2026-10-12', '2026-10-14', '2026-10-16', '2026-10-18'])
  })

  it('reacts to the strongest signals first', () => {
    const plan = planWeek({
      weekStart: '2026-10-12',
      account,
      ...equal,
      signals: [
        { id: signalId('weak'), title: 'weak', score: 10, topics: ['agents'] },
        { id: signalId('strong'), title: 'strong', score: 90, topics: ['n8n'] },
      ],
      takenDays: TAKEN,
    })
    expect(plan[0]?.signalId).toBe('strong')
    expect(plan[0]?.pillar).toBe('n8n tutorials')
  })

  it('shares the evergreen slots out by weight, counting the posts the pillars already had', () => {
    const weights = [
      { pillar: 'n8n tutorials', weight: 0.5 },
      { pillar: 'AI agents', weight: 0.3 },
      { pillar: 'automation fails', weight: 0.2 },
    ]
    const fresh = planWeek({ weekStart: '2026-10-12', account, pillarWeights: weights, priorCounts: {}, signals: [], takenDays: TAKEN })
    expect(fresh.map((post) => post.pillar)).toEqual(['n8n tutorials', 'AI agents', 'automation fails', 'n8n tutorials'])
    // Four weeks of n8n tutorials already: the other pillars catch up first.
    const caughtUp = planWeek({
      weekStart: '2026-10-12',
      account,
      pillarWeights: weights,
      priorCounts: { 'n8n tutorials': 8, 'AI agents': 2, 'automation fails': 0 },
      signals: [],
      takenDays: TAKEN,
    })
    expect(caughtUp.map((post) => post.pillar)).toEqual(['automation fails', 'AI agents', 'automation fails', 'AI agents'])
  })

  it('counts this week’s reactive slots toward their pillar before sharing out the evergreen ones', () => {
    const plan = planWeek({
      weekStart: '2026-10-12',
      account,
      ...equal,
      signals: [{ id: signalId('strong'), title: 'strong', score: 90, topics: ['n8n'] }],
      takenDays: TAKEN,
    })
    expect(plan.map((post) => post.pillar)).toEqual(['n8n tutorials', 'AI agents', 'automation fails', 'n8n tutorials'])
  })
})

describe('planPostSlots', () => {
  const format: PlatformFormat = {
    platform: 'x',
    publishHour: 9,
    cadence: { postsPerDay: 1, kinds: ['text'], intents: ['teach'], repliesPerDay: 5 },
  }

  it('shares the post slots out by the account’s weights, counting its recent posts', () => {
    const posts = planPostSlots({
      experiment: null,
      kindSwaps: [],
      standouts: [],
      roundup: null,
      rework: null,
      weekStart: '2026-10-19',
      account: {
        platform: 'x',
        pillars: ['a', 'b'],
        sponsorDial: 0,
        sponsorRampPosts: 0,
        timezone: 'UTC',
        voice: undefined,
        strategy: {
          pillarWeights: [
            { pillar: 'a', weight: 0.75 },
            { pillar: 'b', weight: 0.25 },
          ],
          defaults: [],
        },
        publishHour: format.publishHour,
        cadence: format.cadence,
      },
      posts: [
        ...['01', '02', '03', '04', '05', '06'].map((day) => ({ plannedFor: `2026-10-${day}`, kind: 'text' as const, pillar: 'a' })),
        // Older than 28 days: no longer counts toward a's share.
        { plannedFor: '2026-08-01', kind: 'text', pillar: 'b' },
      ],
      communities: [],
      signals: [],
      now: Date.UTC(2026, 9, 13),
    })
    // Six of a in the last 28 days: b catches up first and ends with 3 of the 13. Without the history, or with
    // the August post counted, b would get 2.
    expect(posts).toHaveLength(7)
    expect(posts.filter((post) => post.pillar === 'b')).toHaveLength(3)
  })

  it('makes a long slot a thread when the cadence has threads, and a full post when it has none', () => {
    const plainAccount = {
      platform: 'x' as const,
      pillars: ['a'],
      sponsorDial: 0,
      sponsorRampPosts: 0,
      timezone: 'UTC',
      voice: undefined,
      strategy: { pillarWeights: [], defaults: [] },
    }
    const week = (cadence: XCadence) =>
      planPostSlots({
        experiment: null,
        kindSwaps: [],
        standouts: [],
        roundup: null,
        rework: null,
        weekStart: '2026-10-19',
        account: { ...plainAccount, publishHour: format.publishHour, cadence },
        posts: [],
        communities: [],
        signals: [],
        now: Date.UTC(2026, 9, 13),
      })
    const mixed = week({ postsPerDay: 3, kinds: ['text', 'thread'], intents: ['teach'], repliesPerDay: 5 })
    for (const post of mixed) expect(post.kind === 'thread').toBe(post.length === 'long')
    expect(mixed.some((post) => post.kind === 'thread')).toBe(true)
    const textOnly = week({ postsPerDay: 3, kinds: ['text'], intents: ['teach'], repliesPerDay: 5 })
    expect(textOnly.every((post) => post.kind === 'text' && post.length !== 'long')).toBe(true)
  })
})

describe('where a post goes', () => {
  const allowed = { name: 'n8n', selfPromotion: 'allowed' as const, weight: 1 }
  const forbidden = { name: 'automation', selfPromotion: 'forbidden' as const, weight: 1 }
  const full = (intent: PostIntent) => ({ intent, kind: 'text' as const, length: 'medium' as const })
  const place = (platform: Platform, intent: PostIntent, met: PlannerCommunity | null = null, length: PostLength = 'medium') =>
    placePost({ platform, shape: { ...full(intent), length }, sponsorWanted: true, met })

  it('never puts the sponsor in a question or a one-liner, and on Hacker News only in a Show HN', () => {
    expect(place('x', 'ask')).toEqual({ intent: 'ask', community: null, sponsorSegment: 'none' })
    expect(place('x', 'teach').sponsorSegment).toBe('mention')
    expect(place('x', 'teach', null, 'short').sponsorSegment).toBe('none')
    expect(place('hackernews', 'show')).toEqual({ intent: 'show', community: 'Show HN', sponsorSegment: 'mention' })
    expect(place('hackernews', 'ask')).toEqual({ intent: 'ask', community: 'Ask HN', sponsorSegment: 'none' })
    expect(place('hackernews', 'teach')).toEqual({ intent: 'teach', community: 'Hacker News', sponsorSegment: 'none' })
  })

  it('keeps the sponsor out of a subreddit that forbids it, and makes a show that cannot carry it a share', () => {
    expect(place('reddit', 'teach', forbidden).sponsorSegment).toBe('none')
    expect(place('reddit', 'show', forbidden)).toEqual({ intent: 'share', community: 'automation', sponsorSegment: 'none' })
    expect(place('reddit', 'show', allowed).sponsorSegment).toBe('mention')
    // A forum's category is placed like a subreddit, by the rules the listener read.
    expect(place('forum', 'teach', forbidden)).toEqual({ intent: 'teach', community: 'automation', sponsorSegment: 'none' })
    expect(place('forum', 'teach', allowed).sponsorSegment).toBe('mention')
    expect(placePost({ platform: 'hackernews', shape: full('show'), sponsorWanted: false, met: null })).toEqual({
      intent: 'share',
      community: 'Hacker News',
      sponsorSegment: 'none',
    })
  })
})

describe('the sponsor over a week', () => {
  const strategy: NonNullable<Doc<'accounts'>['strategy']> = { pillarWeights: [], defaults: [] }
  /** A thread as a post keeps it. */
  const thread = (signalId: string, title: string) => ({
    signalId: signalId as Id<'signals'>,
    title,
    summary: 'r/a, 400 points.',
    url: `https://www.reddit.com/r/a/comments/${signalId}/`,
  })
  const MODELED = { key: 'modeled', label: 'Modeled on what worked', description: 'Post on what people answered most.' }
  const base = {
    pillars: ['a'],
    sponsorDial: 0.4,
    sponsorRampPosts: 0,
    timezone: 'UTC',
    voice: undefined,
    strategy,
    publishHour: 9,
  }
  const week = (
    overrides: Partial<typeof base> & {
      platform: Platform
      intents: PostIntent[]
      experiment?: PostExperimentPlan
      kindSwaps?: KindSwap[]
      standouts?: PlannerStandout[]
      roundup?: PlannerRoundup
      rework?: PlannerRework
      signals?: PlannerSignal[]
    },
    posts: { plannedFor: string; kind: 'text'; basis?: PlannerRoundup | PlannerRework }[] = []
  ) =>
    planPostSlots({
      experiment: overrides.experiment ?? null,
      kindSwaps: overrides.kindSwaps ?? [],
      standouts: overrides.standouts ?? [],
      roundup: overrides.roundup ?? null,
      rework: overrides.rework ?? null,
      weekStart: '2026-10-19',
      account: { ...base, ...overrides, cadence: { postsPerDay: 1, kinds: ['text'], intents: overrides.intents, repliesPerDay: 5 } },
      posts,
      communities: [],
      signals: overrides.signals ?? [],
      now: Date.UTC(2026, 9, 13),
    })

  it('carries the sponsor on about the dial share of the slots past the ramp, never on a question', () => {
    expect(week({ platform: 'x', intents: ['teach'] }).filter((post) => post.sponsorSegment !== 'none')).toHaveLength(3)
    expect(week({ platform: 'x', intents: ['teach'], sponsorRampPosts: 10 }).every((post) => post.sponsorSegment === 'none')).toBe(true)
    expect(week({ platform: 'x', intents: ['ask'], sponsorDial: 1 }).every((post) => post.sponsorSegment === 'none')).toBe(true)
  })

  it('gives the sponsor to the shows first on Hacker News, where only a Show HN may carry it', () => {
    const posts = week({ platform: 'hackernews', intents: ['show', 'teach', 'ask', 'share', 'inform'] })
    const sponsored = posts.filter((post) => post.sponsorSegment !== 'none')
    expect(sponsored.length).toBeGreaterThan(0)
    expect(sponsored.every((post) => post.intent === 'show' && post.community === 'Show HN')).toBe(true)
    // Off X every post is a text post of a full post's length, whatever the cadence lists.
    expect(posts.every((post) => post.kind === 'text' && post.length === 'medium')).toBe(true)
    // With the dial at 0, a show has no sponsor to show: it is a share on the front page.
    const quiet = week({ platform: 'hackernews', intents: ['show'], sponsorDial: 0 })
    expect(quiet.every((post) => post.intent === 'share' && post.community === 'Hacker News')).toBe(true)
  })

  it('gives the slots a running post experiment’s variants in turn, and a post kind as the slot’s intent before it is placed', () => {
    const experimentId = 'e1' as Id<'experiments'>
    const hooks = week({
      platform: 'x',
      intents: ['teach'],
      experiment: { experimentId, kind: 'hook', keys: ['statement', 'question'], assigned: { sponsored: {}, plain: { statement: 2 } } },
    })
    expect(hooks.every((post) => post.intent === 'teach')).toBe(true)
    // Balanced within the posts that carry the sponsor and within the ones that do not, so the link favours neither variant.
    const keysOf = (sponsored: boolean) =>
      hooks.filter((post) => (post.sponsorSegment !== 'none') === sponsored).map((post) => post.experiment?.variantKey)
    expect(new Set(keysOf(true))).toEqual(new Set(['statement', 'question']))
    // The plain posts start with the variant that has fewer, then go in turn.
    expect(keysOf(false).slice(0, 3)).toEqual(['question', 'question', 'statement'])

    const kinds = week({
      platform: 'hackernews',
      intents: ['teach', 'ask'],
      experiment: { experimentId, kind: 'post_kind', keys: ['teach', 'ask'], assigned: { sponsored: {}, plain: {} } },
    })
    for (const post of kinds) {
      expect(post.intent).toBe(post.experiment?.variantKey)
      // Placed by the kind it was given: a question goes to Ask HN.
      expect(post.community).toBe(post.intent === 'ask' ? 'Ask HN' : 'Hacker News')
    }
  })

  it('leaves a post out of the experiment when placement changed the kind it was given, and gives a decided kind the turns of the one it beat', () => {
    const experimentId = 'e1' as Id<'experiments'>
    // With the dial at 0 a show cannot carry the sponsor, so it goes out as a share: no longer the variant it tests.
    const shows = week({
      platform: 'hackernews',
      intents: ['teach', 'show'],
      sponsorDial: 0,
      experiment: { experimentId, kind: 'post_kind', keys: ['teach', 'show'], assigned: { sponsored: {}, plain: {} } },
    })
    expect(shows.filter((post) => post.intent === 'share').every((post) => post.experiment === undefined)).toBe(true)
    expect(shows.filter((post) => post.intent === 'teach').every((post) => post.experiment?.variantKey === 'teach')).toBe(true)

    // A decided question takes the turns of the how-to it beat; the stories keep theirs.
    const swapped = week({ platform: 'x', intents: ['teach', 'share'], kindSwaps: [{ from: 'teach', to: 'ask' }] })
    expect(new Set(swapped.map((post) => post.intent))).toEqual(new Set(['ask', 'share']))
    // A later decision on the winner passes the turns on, and the kind that lost first does not come back.
    const chained = week({
      platform: 'x',
      intents: ['teach', 'share'],
      kindSwaps: [
        { from: 'teach', to: 'ask' },
        { from: 'ask', to: 'share' },
      ],
    })
    expect(chained.every((post) => post.intent === 'share')).toBe(true)
  })

  it('models a post on each standout in turn under a post model test, and plans the rest as usual once none is left', () => {
    const standouts: PlannerStandout[] = [
      { thread: thread('s1', 'I replaced three tools with one flow'), pillar: 'a' },
      { thread: thread('s2', 'What broke when we self-hosted'), pillar: 'a' },
    ]
    const experiment: PostExperimentPlan = {
      experimentId: 'e1' as Id<'experiments'>,
      kind: 'post_model',
      keys: ['planned', 'modeled'],
      assigned: { sponsored: {}, plain: {} },
    }
    const posts = week({ platform: 'x', intents: ['teach'], sponsorDial: 0, experiment, standouts })
    expect(posts.map((post) => [post.experiment?.variantKey, post.basis?.kind === 'model' ? post.basis.thread.signalId : null])).toEqual([
      ['planned', null],
      ['modeled', 's1'],
      ['planned', null],
      ['modeled', 's2'],
      // No standout left: the modeled turn goes to the control, which never waits on the niche.
      ['planned', null],
      ['planned', null],
      ['planned', null],
    ])
    expect(posts[1]).toMatchObject({ concept: 'Modeled on "I replaced three tools with one flow"', pillar: 'a', signalIds: [] })
    // The post keeps the thread itself: a signal can be dismissed and age out while its post waits.
    expect(posts[1]?.basis).toEqual({ kind: 'model', thread: thread('s1', 'I replaced three tools with one flow') })

    // A decided post model has every post take a standout while one is left.
    const modeledWon = { pillarWeights: [], defaults: [{ ...MODELED, kind: 'post_model' as const, since: 0 }] }
    const decided = week({ platform: 'x', intents: ['teach'], standouts, strategy: modeledWon })
    expect(decided.map((post) => post.basis?.kind ?? null)).toEqual(['model', 'model', null, null, null, null, null])
    expect(decided.every((post) => post.experiment === undefined)).toBe(true)
  })

  it("puts the week's round-up in its first full post that answers, and nowhere it cannot fit", () => {
    const roundup: PlannerRoundup = { kind: 'roundup', pillar: 'a', questions: ['q1', 'q2', 'q3', 'q4'].map((id) => thread(id, `${id}?`)) }
    const posts = week({ platform: 'linkedin', intents: ['teach'], roundup })
    const rounded = posts.filter((post) => post.basis?.kind === 'roundup')
    expect(rounded).toHaveLength(1)
    expect(rounded[0]).toMatchObject({
      concept: 'Round-up: what people asked about a',
      pillar: 'a',
      signalIds: [],
      basis: roundup,
    })
    expect(rounded[0]?.length).not.toBe('short')
    expect(posts.find((post) => post.length !== 'short')).toBe(rounded[0])
    // A question asks; Hacker News places a post by what it does; one post on X holds no round-up, a thread does.
    expect(week({ platform: 'linkedin', intents: ['ask'], roundup }).some((post) => post.basis !== undefined)).toBe(false)
    expect(week({ platform: 'hackernews', intents: ['teach'], roundup }).some((post) => post.basis !== undefined)).toBe(false)
    expect(week({ platform: 'x', intents: ['teach'], roundup }).some((post) => post.basis !== undefined)).toBe(false)
  })

  it('draws a post from what worked only in an evergreen slot, so a reactive one keeps its signal', () => {
    const fresh = { id: 'sig1' as Id<'signals'>, title: 'A thread from this morning', score: 90, topics: ['a'] }
    const modeledWon = { pillarWeights: [], defaults: [{ ...MODELED, kind: 'post_model' as const, since: 0 }] }
    const standouts: PlannerStandout[] = [{ thread: thread('s1', 'I replaced three tools with one flow'), pillar: 'a' }]
    const posts = week({ platform: 'linkedin', intents: ['teach'], standouts, strategy: modeledWon, signals: [fresh] })
    expect(posts.filter((post) => post.signalIds.includes(fresh.id))).toHaveLength(1)
    const modeled = posts.filter((post) => post.basis?.kind === 'model')
    expect(modeled).toHaveLength(1)
    expect(modeled[0]?.signalIds).toEqual([])
  })

  it('gives the questions of a round-up no week can hold back to the reactive posts', () => {
    const question = { id: 'q1' as Id<'signals'>, title: 'q1?', score: 90, topics: ['a'] }
    const roundup: PlannerRoundup = { kind: 'roundup', pillar: 'a', questions: ['q1', 'q2', 'q3', 'q4'].map((id) => thread(id, `${id}?`)) }
    // Hacker News holds no round-up: the question it would have answered is a reactive signal again.
    const posts = week({ platform: 'hackernews', intents: ['teach'], roundup, signals: [question] })
    expect(posts.some((post) => post.basis !== undefined)).toBe(false)
    expect(posts.some((post) => post.signalIds.includes(question.id))).toBe(true)
    // A week that already holds a round-up takes no other.
    const held = week({ platform: 'linkedin', intents: ['teach'], roundup }, [{ plannedFor: '2026-10-19', kind: 'text', basis: roundup }])
    expect(held.some((post) => post.basis !== undefined)).toBe(false)
  })

  it("puts the week's reworked post in the first full post that answers after the round-up, once a week", () => {
    const rework: PlannerRework = {
      kind: 'rework',
      post: { postId: 'p1' as Id<'posts'>, placeName: 'X', title: 'Retry the step, not the workflow', text: 'Retry the step.', url: null },
    }
    const roundup: PlannerRoundup = { kind: 'roundup', pillar: 'a', questions: ['q1', 'q2', 'q3', 'q4'].map((id) => thread(id, `${id}?`)) }
    const posts = week({ platform: 'linkedin', intents: ['teach'], roundup, rework })
    const drawn = posts.flatMap((post) => (post.basis === undefined ? [] : [post.basis.kind]))
    expect(drawn).toEqual(['roundup', 'rework'])
    expect(posts.find((post) => post.basis?.kind === 'rework')).toMatchObject({
      concept: 'From X: Retry the step, not the workflow',
      pillar: 'a',
    })
    // A week that holds one takes no other, and Hacker News has no place for one.
    const held = week({ platform: 'linkedin', intents: ['teach'], rework }, [{ plannedFor: '2026-10-19', kind: 'text', basis: rework }])
    expect(held.some((post) => post.basis !== undefined)).toBe(false)
    expect(week({ platform: 'hackernews', intents: ['teach'], rework }).some((post) => post.basis !== undefined)).toBe(false)
  })

  it("moves each day's posts by one posting time variant, the days in turn, and leaves out a day where a variant would move a post into the past", () => {
    const experiment: PostExperimentPlan = {
      experimentId: 'e1' as Id<'experiments'>,
      kind: 'posting_time',
      keys: ['usual', 'earlier'],
      assigned: { sponsored: {}, plain: {} },
    }
    const posts = planPostSlots({
      experiment,
      kindSwaps: [],
      standouts: [],
      roundup: null,
      rework: null,
      weekStart: '2026-10-19',
      account: {
        ...base,
        platform: 'x',
        publishHour: 10,
        cadence: { postsPerDay: 2, kinds: ['text'], intents: ['teach'], repliesPerDay: 5 },
      },
      posts: [],
      communities: [],
      signals: [],
      // Monday 09:30: Monday's 10:00 post is still ahead, but two hours earlier it would be gone.
      now: Date.UTC(2026, 9, 19, 9, 30),
    })
    const byDay = new Map<string, typeof posts>()
    for (const post of posts) byDay.set(post.plannedFor, [...(byDay.get(post.plannedFor) ?? []), post])
    expect(byDay.get('2026-10-19')?.map((post) => [post.publishHour, post.experiment])).toEqual([
      [10, undefined],
      [13, undefined],
    ])
    for (const [day, dayPosts] of byDay) {
      if (day === '2026-10-19') continue
      // A whole day moves by one variant, so its posts keep their three hours apart.
      const [key] = new Set(dayPosts.map((post) => post.experiment?.variantKey))
      expect(new Set(dayPosts.map((post) => post.experiment?.variantKey)).size).toBe(1)
      expect(dayPosts.map((post) => post.publishHour)).toEqual(key === 'earlier' ? [8, 11] : [10, 13])
    }
    // The variants take the days in turn: three days each.
    const keys = [...byDay.values()].flatMap((dayPosts) => (dayPosts[0]?.experiment ? [dayPosts[0].experiment.variantKey] : []))
    expect(keys.filter((key) => key === 'usual')).toHaveLength(3)
    expect(keys.filter((key) => key === 'earlier')).toHaveLength(3)
  })

  it('plans Reddit posts into the subreddits the account met, by their weights and their recent posts', () => {
    const plan = (communities: PlannerCommunity[], posts: { plannedFor: string; kind: 'text'; community: string }[] = []) =>
      planPostSlots({
        experiment: null,
        kindSwaps: [],
        standouts: [],
        roundup: null,
        rework: null,
        weekStart: '2026-10-19',
        account: { ...base, platform: 'reddit', cadence: { postsPerDay: 1, kinds: ['text'], intents: ['teach'], repliesPerDay: 5 } },
        posts,
        communities,
        signals: [],
        now: Date.UTC(2026, 9, 13),
      })
    const n8n = { name: 'n8n', selfPromotion: 'allowed' as const, weight: 3 }
    const zapier = { name: 'zapier', selfPromotion: 'forbidden' as const, weight: 1 }
    const posts = plan([n8n, zapier])
    expect(posts.filter((post) => post.community === 'n8n')).toHaveLength(5)
    expect(posts.filter((post) => post.community === 'zapier')).toHaveLength(2)
    // Never the sponsor in the subreddit that forbids it.
    expect(posts.filter((post) => post.community === 'zapier').every((post) => post.sponsorSegment === 'none')).toBe(true)
    // Ten recent posts in n8n hand this week to zapier; older ones no longer count.
    const recent = Array.from({ length: 10 }, (_, index) => ({
      plannedFor: `2026-10-0${(index % 9) + 1}`,
      kind: 'text' as const,
      community: 'n8n',
    }))
    expect(plan([n8n, zapier], recent).filter((post) => post.community === 'zapier').length).toBeGreaterThan(2)
    const old = recent.map((post) => ({ ...post, plannedFor: '2026-08-01' }))
    expect(plan([n8n, zapier], old).filter((post) => post.community === 'n8n')).toHaveLength(5)
  })
})
