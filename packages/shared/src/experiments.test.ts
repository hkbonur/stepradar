import { describe, expect, it } from 'vitest'
import {
  EXPERIMENT_CATALOG,
  EXPERIMENT_KINDS,
  EXPERIMENT_METRICS,
  REPLY_TARGET_KEYS,
  allocatePillars,
  catalogControl,
  REVIEW_MIN_ITEMS,
  accountCatalog,
  contradictionMinItems,
  contradicts,
  experimentVerdict,
  metricsFor,
  metricsText,
  leastAssigned,
  pickNextExperiment,
  postedHourOf,
  postingTimeFits,
  POSTING_TIME_OFFSETS,
  POSTING_TIME_TOLERANCE_MS,
  pillarWeights,
  shiftPillarWeights,
  reviewMetric,
  type ExperimentHistoryRow,
  type ExperimentKind,
  type VariantStats,
} from './experiments'
import { POST_INTENTS } from './post-mix'
import type { StrategyDefault } from './strategy'

/** A variant's stats from its items' values. */
function stats(key: string, values: number[]): VariantStats {
  return {
    key,
    items: values.length,
    sum: values.reduce((sum, value) => sum + value, 0),
    sumSquares: values.reduce((sum, value) => sum + value * value, 0),
  }
}

/** `count` items of one value. */
const repeat = (value: number, count: number) => Array.from({ length: count }, () => value)

describe('experimentVerdict', () => {
  const options = { minItems: 5, minConfidence: 0.9, minEvents: 0 }

  it('waits until every variant has enough items, and at least two', () => {
    expect(experimentVerdict([stats('a', [1, 2, 1]), stats('b', repeat(9, 20))], options)).toEqual({ kind: 'waiting' })
    // One item has no spread to test against, whatever the experiment asked for.
    expect(experimentVerdict([stats('a', [1]), stats('b', [9])], { ...options, minItems: 1 })).toEqual({ kind: 'waiting' })
  })

  it('names the leader once its mean per item is confidently higher', () => {
    const verdict = experimentVerdict([stats('control', [1, 2, 1, 2, 1, 2, 1, 2]), stats('wrong', [3, 4, 3, 4, 3, 4, 3, 4])], {
      ...options,
      minConfidence: 0.95,
    })
    if (verdict.kind !== 'decided') throw new Error(`expected a decision, got ${verdict.kind}`)
    expect(verdict.decision.winnerKey).toBe('wrong')
    expect(verdict.decision.lift).toBeCloseTo(7 / 3 - 1, 5)
    expect(verdict.decision.confidence).toBeGreaterThan(0.99)
  })

  it('asks of either side, since the leader is picked after looking: a lead a one-sided test would take is inconclusive', () => {
    // t ≈ 1.5 over 15 items each: 93% one-sided, 86% two-sided.
    const base = [...repeat(0, 7), ...repeat(2, 7), 1]
    const verdict = experimentVerdict(
      [
        stats('control', base),
        stats(
          'challenger',
          base.map((value) => value + 0.55)
        ),
      ],
      {
        ...options,
        minItems: 15,
      }
    )
    expect(verdict).toEqual({ kind: 'inconclusive' })
  })

  it('finds reach that swings from item to item inconclusive, where counting events would have decided', () => {
    const verdict = experimentVerdict([stats('control', [0, 0, 1, 0, 9, 0, 1, 1]), stats('challenger', [0, 0, 0, 22, 0, 0, 1, 5])], options)
    expect(verdict).toEqual({ kind: 'inconclusive' })
  })

  it('needs the winner to bring enough events on a rare rung: two paid customers against none is luck', () => {
    const paid = [stats('control', repeat(0, 15)), stats('challenger', [1, 1, ...repeat(0, 13)])]
    expect(experimentVerdict(paid, { minItems: 15, minConfidence: 0.5, minEvents: 5 })).toEqual({ kind: 'inconclusive' })
  })

  it('decides nothing between two variants with no spread and the same mean, and never on a confidence that is not a number', () => {
    expect(experimentVerdict([stats('a', repeat(4, 5)), stats('b', repeat(4, 5))], options)).toEqual({ kind: 'inconclusive' })
    // No spread and different means: the means differ every time.
    expect(experimentVerdict([stats('a', repeat(4, 5)), stats('b', repeat(6, 5))], options)).toEqual({
      kind: 'decided',
      decision: { winnerKey: 'b', lift: 0.5, confidence: 1 },
    })
    for (const values of [[0, 0, 0, 0, 0], repeat(1e300, 5)]) {
      const verdict = experimentVerdict([stats('a', values), stats('b', values)], options)
      expect(verdict.kind === 'decided' ? Number.isFinite(verdict.decision.confidence) : true).toBe(true)
    }
  })
})

describe('the experiment catalog', () => {
  it('lists every dimension with its control first and unique keys', () => {
    for (const kind of EXPERIMENT_KINDS) {
      const variants = EXPERIMENT_CATALOG[kind]
      expect(variants.length, kind).toBeGreaterThanOrEqual(2)
      expect(
        variants.map((variant) => variant.isControl),
        kind
      ).toEqual(variants.map((_, index) => index === 0))
      expect(new Set(variants.map((variant) => variant.key)).size, kind).toBe(variants.length)
      for (const variant of variants) {
        expect(variant.description.trim(), `${kind}/${variant.key}`).not.toBe('')
        expect(variant.description, `${kind}/${variant.key}`).not.toContain('\u2014')
      }
    }
    expect(EXPERIMENT_KINDS).toEqual([
      'reply_style',
      'reply_target',
      'reply_length',
      'sponsor_mention',
      'post_kind',
      'hook',
      'call_to_action',
      'posting_time',
      'post_model',
    ])
    expect(EXPERIMENT_CATALOG.reply_style.map((variant) => variant.key)).toEqual(['tip', 'question', 'story'])
    // A post kind's keys are the intents the planner plans.
    for (const variant of EXPERIMENT_CATALOG.post_kind) expect(POST_INTENTS).toContain(variant.key)
  })

  it('keeps the reply target keys to the ones the listener knows', () => {
    expect(EXPERIMENT_CATALOG.reply_target.map((variant) => variant.key)).toEqual([...REPLY_TARGET_KEYS])
    expect(catalogControl('reply_style').key).toBe('tip')
  })

  it('climbs the goal metric ladder from paid down to reach, and decides a reply experiment on reach, since a reply carries no link', () => {
    expect(EXPERIMENT_METRICS).toEqual(['paid', 'signups', 'clicks', 'reach'])
    const brought = { paid: 5, signups: 40, clicks: 200 }
    const all = EXPERIMENT_METRICS
    expect(reviewMetric(['reach'], brought)).toBe('reach')
    expect(reviewMetric(all, brought)).toBe('paid')
    expect(reviewMetric(all, { ...brought, paid: 4 })).toBe('signups')
    expect(reviewMetric(all, { paid: 0, signups: 9, clicks: 30 })).toBe('clicks')
    expect(reviewMetric(all, { paid: 0, signups: 0, clicks: 29 })).toBe('reach')
    // Where the posts link to the sponsor directly no click is counted, so the ladder skips the rung.
    const direct = metricsFor('hook', 'reddit').metrics
    expect(reviewMetric(direct, { paid: 0, signups: 12, clicks: null })).toBe('signups')
    expect(reviewMetric(direct, { paid: 0, signups: 9, clicks: null })).toBe('reach')
    // Where reach is not read either, too few conversions leave nothing to decide on.
    expect(reviewMetric(['paid', 'signups', 'clicks'], { paid: 0, signups: 0, clicks: 3 })).toBeNull()
  })

  it('offers each dimension the metrics it can be decided on, on its platform, and says why when not every one', () => {
    expect(metricsFor('hook', 'x')).toEqual({ metrics: EXPERIMENT_METRICS, why: null })
    expect(metricsFor('post_kind', 'x')).toEqual({
      metrics: ['reach'],
      why: "A post's kind decides whether it may carry the sponsor's link at all.",
    })
    expect(metricsFor('reply_length', 'reddit')).toEqual({ metrics: ['reach'], why: 'A reply carries no link.' })
    expect(metricsFor('call_to_action', 'hackernews')).toEqual({
      metrics: ['paid', 'signups', 'reach'],
      why: 'A post on Hacker News links to the sponsor directly, so no click is counted.',
    })
    expect(metricsText(['paid', 'signups', 'reach'])).toBe('paid, signups or reach')
    expect(metricsText(['reach'])).toBe('reach')
  })
})

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 9, 13)

function decided(id: string, kind: ExperimentKind, keys: [string, string], winnerKey: string, daysAgo: number): ExperimentHistoryRow {
  const variants = keys.map((key, index) => {
    const listed = EXPERIMENT_CATALOG[kind].find((variant) => variant.key === key)
    if (!listed) throw new Error(`no ${kind} variant ${key}`)
    return { ...listed, isControl: index === 0 }
  })
  return { id, kind, variants, status: 'decided', winnerKey, decidedAt: NOW - daysAgo * DAY }
}

function defaultOf(kind: ExperimentKind, key: string, experimentId: string): StrategyDefault {
  const listed = EXPERIMENT_CATALOG[kind].find((variant) => variant.key === key)
  if (!listed) throw new Error(`no ${kind} variant ${key}`)
  return { kind, key, label: listed.label, description: listed.description, experimentId, since: NOW - 30 * DAY }
}

/** Every intent planned: the whole catalog. */
const CATALOG = accountCatalog(POST_INTENTS)

describe('accountCatalog', () => {
  it('tests only the post kinds the cadence plans, the first of them the control', () => {
    const catalog = accountCatalog(['ask', 'share', 'inform'])
    expect(catalog.post_kind.map((variant) => [variant.key, variant.isControl])).toEqual([
      ['ask', true],
      ['share', false],
    ])
    expect(catalog.hook).toBe(EXPERIMENT_CATALOG.hook)
    // A decided kind the cadence dropped gives way to the first kind left as the control.
    const decided = defaultOf('post_kind', 'teach', 'k1')
    expect(
      pickNextExperiment({ catalog, kinds: ['post_kind'], history: [], defaults: [decided], contradicted: [], now: NOW })?.control
    ).toMatchObject({ key: 'ask' })
    // One kind left is nothing to test.
    const one = accountCatalog(['teach'])
    expect(pickNextExperiment({ catalog: one, kinds: ['post_kind'], history: [], defaults: [], contradicted: [], now: NOW })).toBeNull()
  })
})

describe('posting time', () => {
  const format = (publishHour: number, postsPerDay: number) => ({
    publishHour,
    cadence: { postsPerDay, repliesPerDay: 5, kinds: ['text' as const], intents: ['teach' as const] },
  })

  it('fits a day only when every variant moves every post by its offset within the day', () => {
    expect(postingTimeFits(format(9, 2))).toBe(true)
    // Two posts from 19:00 are at 19:00 and 22:00: two hours later the second would leave the day.
    expect(postingTimeFits(format(19, 2))).toBe(false)
    expect(postingTimeFits(format(1, 1))).toBe(false)
    expect(postingTimeFits(format(21, 1))).toBe(true)
  })

  it('counts a post for its hour only at the time the match found it, within less than half the gap between two variants', () => {
    const offsets = Object.values(POSTING_TIME_OFFSETS).sort((a, b) => a - b)
    const gaps = offsets.slice(1).map((offset, index) => (offset - (offsets[index] ?? 0)) * 3_600_000)
    expect(2 * POSTING_TIME_TOLERANCE_MS).toBeLessThan(Math.min(...gaps))
    const found = { kind: 'found' as const, externalId: '1' }
    expect(postedHourOf({ scheduledAt: 0, posted: { ...found, at: 40 * 60_000 } })).toBe('on')
    expect(postedHourOf({ scheduledAt: 0, posted: { ...found, at: 50 * 60_000 } })).toBe('off')
    // Marked posted by hand, it went out whenever the operator said so: that tells nothing of its hour.
    expect(postedHourOf({ scheduledAt: 0, posted: { kind: 'said', at: 0 } })).toBe('unknown')
  })

  it('tests no posting time again within the memory of the last decision on it, since its variants moved with the hour', () => {
    const args = { catalog: CATALOG, kinds: ['posting_time'] as ExperimentKind[], defaults: [], contradicted: [], now: NOW }
    expect(pickNextExperiment({ ...args, history: [] })?.kind).toBe('posting_time')
    expect(pickNextExperiment({ ...args, history: [decided('t1', 'posting_time', ['usual', 'later'], 'later', 30)] })).toBeNull()
    expect(pickNextExperiment({ ...args, history: [decided('t1', 'posting_time', ['usual', 'later'], 'later', 200)] })?.kind).toBe(
      'posting_time'
    )
  })
})

describe('pickNextExperiment', () => {
  const kinds: ExperimentKind[] = ['reply_style', 'reply_target']

  it('starts with the first dimension in catalog order when nothing was ever decided', () => {
    const next = pickNextExperiment({ catalog: CATALOG, kinds, history: [], defaults: [], contradicted: [], now: NOW })
    expect(next?.kind).toBe('reply_style')
    expect(next?.control).toMatchObject({ key: 'tip', isControl: true })
    expect(next?.challenger).toMatchObject({ key: 'question', isControl: false })
    expect(next?.retestOf).toBeUndefined()
  })

  it('returns null when no dimension applies', () => {
    expect(pickNextExperiment({ catalog: CATALOG, kinds: [], history: [], defaults: [], contradicted: [], now: NOW })).toBeNull()
  })

  it('prefers the dimension with the fewest decisions in 180 days, never decided before decided, then the one decided longest ago', () => {
    const history = [decided('s1', 'reply_style', ['tip', 'question'], 'question', 10)]
    expect(pickNextExperiment({ catalog: CATALOG, kinds, history, defaults: [], contradicted: [], now: NOW })?.kind).toBe('reply_target')
    // Reply target's only decision is older than 180 days, so it ties style's recent one at none against one.
    const old = [...history, decided('t1', 'reply_target', ['reach', 'standout'], 'standout', 400)]
    expect(pickNextExperiment({ catalog: CATALOG, kinds, history: old, defaults: [], contradicted: [], now: NOW })?.kind).toBe(
      'reply_target'
    )
    // Both now have one recent decision; style's, 10 days ago, is older than target's.
    const recent = [...history, decided('t2', 'reply_target', ['reach', 'standout'], 'standout', 5)]
    expect(pickNextExperiment({ catalog: CATALOG, kinds, history: recent, defaults: [], contradicted: [], now: NOW })?.kind).toBe(
      'reply_style'
    )
  })

  it('tests a variant other than the default against the default as the control', () => {
    const history = [decided('s1', 'reply_style', ['tip', 'question'], 'question', 30)]
    const next = pickNextExperiment({
      catalog: CATALOG,
      kinds: ['reply_style'],
      history,
      defaults: [defaultOf('reply_style', 'question', 's1')],
      contradicted: [],
      now: NOW,
    })
    expect(next?.control).toMatchObject({ key: 'question', isControl: true })
    // Tip lost to question 30 days ago; story never ran.
    expect(next?.challenger).toMatchObject({ key: 'story', isControl: false })
  })

  it('takes the variant that lost longest ago once every other variant lost within 180 days', () => {
    const history = [
      decided('s1', 'reply_style', ['tip', 'question'], 'tip', 90),
      decided('s2', 'reply_style', ['tip', 'story'], 'tip', 30),
    ]
    const next = pickNextExperiment({ catalog: CATALOG, kinds: ['reply_style'], history, defaults: [], contradicted: [], now: NOW })
    expect(next?.challenger.key).toBe('question')
  })

  it('forgives a loss older than 180 days', () => {
    const history = [decided('s1', 'reply_style', ['tip', 'question'], 'tip', 200)]
    const next = pickNextExperiment({ catalog: CATALOG, kinds: ['reply_style'], history, defaults: [], contradicted: [], now: NOW })
    expect(next?.challenger.key).toBe('question')
  })

  it('tests a contradicted default again first, against the variant it beat', () => {
    const history = [decided('t1', 'reply_target', ['reach', 'standout'], 'standout', 30)]
    const next = pickNextExperiment({
      catalog: CATALOG,
      kinds,
      history,
      defaults: [defaultOf('reply_target', 'standout', 't1')],
      contradicted: ['reply_target'],
      now: NOW,
    })
    expect(next).toEqual({
      kind: 'reply_target',
      control: expect.objectContaining({ key: 'standout', isControl: true }),
      challenger: expect.objectContaining({ key: 'reach', isControl: false }),
      retestOf: 't1',
    })
  })

  it('tests a contradicted default of three variants again against its runner-up, not the control', () => {
    // The operator's experiment: control "Tip", "Question back" second, "Story" won.
    const [tip, question, story] = ['tip', 'question', 'story'].map((key, index) => {
      const listed = EXPERIMENT_CATALOG.reply_style.find((variant) => variant.key === key)
      if (!listed) throw new Error(`no reply style variant ${key}`)
      return { ...listed, isControl: index === 0 }
    })
    if (!tip || !question || !story) throw new Error('the reply style catalog lost a variant')
    const row: ExperimentHistoryRow = {
      id: 's1',
      kind: 'reply_style',
      variants: [tip, question, story],
      status: 'decided',
      winnerKey: 'story',
      decidedAt: NOW - 30 * DAY,
      runnerUpKey: 'question',
    }
    const args = {
      catalog: CATALOG,
      kinds,
      defaults: [defaultOf('reply_style', 'story', 's1')],
      contradicted: ['reply_style' as const],
      now: NOW,
    }
    expect(pickNextExperiment({ ...args, history: [row] })?.challenger).toMatchObject({ key: 'question', isControl: false })
    // A decision from before the runner-up's key was stored falls back to the control.
    const { runnerUpKey: _stored, ...older } = row
    expect(pickNextExperiment({ ...args, history: [older] })?.challenger).toMatchObject({ key: 'tip', isControl: false })
  })

  it('leaves a contradicted dimension alone when it no longer applies', () => {
    const history = [decided('t1', 'reply_target', ['reach', 'standout'], 'standout', 30)]
    const next = pickNextExperiment({
      catalog: CATALOG,
      kinds: ['reply_style'],
      history,
      defaults: [defaultOf('reply_target', 'standout', 't1')],
      contradicted: ['reply_target'],
      now: NOW,
    })
    expect(next?.kind).toBe('reply_style')
  })
})

describe('contradicts', () => {
  const decision = { winnerRate: 21, runnerUpRate: 14 }

  it('waits for the minimum items since the decision', () => {
    expect(contradicts(decision, stats('story', repeat(0, 14)), 15)).toBe(false)
  })

  it('flags a default that fell to the runner-up’s old mean or below', () => {
    expect(contradicts(decision, stats('story', repeat(14, 15)), 15)).toBe(true)
    expect(contradicts(decision, stats('story', repeat(10, 15)), 15)).toBe(true)
  })

  it('takes nothing since for no contradiction when the runner-up brought nothing either', () => {
    expect(contradicts({ winnerRate: 0.2, runnerUpRate: 0 }, stats('story', repeat(0, 15)), 15)).toBe(false)
  })

  it('trusts a default that stays above the runner-up’s old mean', () => {
    expect(contradicts(decision, stats('story', repeat(16, 15)), 15)).toBe(false)
  })
})

describe('contradictionMinItems', () => {
  it('asks for the review’s floor at the least, whatever the experiment asked for', () => {
    expect(contradictionMinItems(3)).toBe(REVIEW_MIN_ITEMS)
    expect(contradictionMinItems(40)).toBe(40)
  })
})

describe('pillarWeights', () => {
  const pillars = ['n8n tutorials', 'AI agents', 'Automation fails']

  it('gives equal shares when nothing is stored', () => {
    const weights = pillarWeights(pillars, undefined)
    expect(weights.map((entry) => entry.pillar)).toEqual(pillars)
    for (const entry of weights) expect(entry.weight).toBeCloseTo(1 / 3, 10)
    expect(pillarWeights(pillars, []).map((entry) => entry.weight)).toEqual(weights.map((entry) => entry.weight))
  })

  it('keeps stored weights, gives a new pillar the mean, drops a removed one, and normalizes', () => {
    const weights = pillarWeights(
      ['n8n tutorials', 'AI agents', 'Make'],
      [
        { pillar: 'n8n tutorials', weight: 0.5 },
        { pillar: 'AI agents', weight: 0.3 },
        { pillar: 'Automation fails', weight: 0.2 },
      ]
    )
    // Make gets the mean of 0.5 and 0.3; the three sum to 1.2 before normalizing.
    expect(weights.map((entry) => entry.pillar)).toEqual(['n8n tutorials', 'AI agents', 'Make'])
    expect(weights.map((entry) => entry.weight)).toEqual([0.5 / 1.2, 0.3 / 1.2, 0.4 / 1.2].map((weight) => expect.closeTo(weight, 10)))
  })

  it('has nothing to weigh without pillars', () => {
    expect(pillarWeights([], [{ pillar: 'gone', weight: 1 }])).toEqual([])
  })
})

describe('shiftPillarWeights', () => {
  const equal = pillarWeights(['a', 'b', 'c'], undefined)

  it('moves 0.1 from the worst pillar to the best once the best leads by 20%', () => {
    const shift = shiftPillarWeights(equal, [
      { pillar: 'a', score: 30, tiebreak: 0.01, posts: 3 },
      { pillar: 'b', score: 20, tiebreak: 0.01, posts: 2 },
      { pillar: 'c', score: 24, tiebreak: 0.01, posts: 4 },
    ])
    expect(shift?.change).toEqual({ up: 'a', down: 'b' })
    expect(shift?.weights.map((entry) => entry.weight)).toEqual(
      [1 / 3 + 0.1, 1 / 3 - 0.1, 1 / 3].map((weight) => expect.closeTo(weight, 10))
    )
  })

  it('changes nothing when the best leads by less than 20%', () => {
    const scores = [
      { pillar: 'a', score: 23.9, tiebreak: 0.05, posts: 3 },
      { pillar: 'b', score: 20, tiebreak: 0.01, posts: 3 },
    ]
    expect(shiftPillarWeights(equal, scores)).toBeNull()
  })

  it('breaks a tie on value with clicks per view, by the same 20%', () => {
    const tie = (tiebreak: number) => [
      { pillar: 'a', score: 0, tiebreak: 0.01, posts: 3 },
      { pillar: 'b', score: 0, tiebreak, posts: 3 },
    ]
    expect(shiftPillarWeights(equal, tie(0.012))?.change).toEqual({ up: 'b', down: 'a' })
    expect(shiftPillarWeights(equal, tie(0.0119))).toBeNull()
  })

  it('counts only pillars with two measured posts, and needs two of them', () => {
    expect(
      shiftPillarWeights(equal, [
        { pillar: 'a', score: 50, tiebreak: 0, posts: 1 },
        { pillar: 'b', score: 10, tiebreak: 0, posts: 2 },
      ])
    ).toBeNull()
    expect(shiftPillarWeights(equal, [])).toBeNull()
  })

  it('never takes a pillar under the floor', () => {
    const lopsided = [
      { pillar: 'a', weight: 0.75 },
      { pillar: 'b', weight: 0.15 },
      { pillar: 'c', weight: 0.1 },
    ]
    const scores = [
      { pillar: 'a', score: 30, tiebreak: 0, posts: 3 },
      { pillar: 'b', score: 20, tiebreak: 0, posts: 3 },
      { pillar: 'c', score: 10, tiebreak: 0, posts: 3 },
    ]
    expect(shiftPillarWeights(lopsided, scores)).toBeNull()
    const partial = shiftPillarWeights(lopsided, scores.slice(0, 2))
    expect(partial?.weights.map((entry) => entry.weight)).toEqual([0.8, 0.1, 0.1].map((weight) => expect.closeTo(weight, 10)))
  })

  it('ignores a score for a pillar without a weight', () => {
    const scores = [
      { pillar: 'gone', score: 90, tiebreak: 0, posts: 5 },
      { pillar: 'a', score: 10, tiebreak: 0, posts: 3 },
    ]
    expect(shiftPillarWeights(equal, scores)).toBeNull()
  })
})

describe('allocatePillars', () => {
  it('shares slots by weight, ties to the pillar listed first', () => {
    const weights = pillarWeights(['a', 'b', 'c'], undefined)
    expect(allocatePillars(weights, {}, 3)).toEqual(['a', 'b', 'c'])
    expect(allocatePillars(weights, {}, 0)).toEqual([])
  })

  it('tops up the pillars the recent weeks gave less than their weight', () => {
    const weights = pillarWeights(['a', 'b', 'c'], undefined)
    expect(allocatePillars(weights, { a: 4, b: 4, c: 1 }, 3)).toEqual(['c', 'c', 'c'])
  })

  it('follows the weights over a month of slots', () => {
    const weights = [
      { pillar: 'a', weight: 0.5 },
      { pillar: 'b', weight: 0.3 },
      { pillar: 'c', weight: 0.2 },
    ]
    const picks = allocatePillars(weights, {}, 20)
    expect(picks.filter((pillar) => pillar === 'a')).toHaveLength(10)
    expect(picks.filter((pillar) => pillar === 'b')).toHaveLength(6)
    expect(picks.filter((pillar) => pillar === 'c')).toHaveLength(4)
  })

  it('ignores prior posts of a pillar the account no longer has', () => {
    const weights = pillarWeights(['a', 'b'], undefined)
    expect(allocatePillars(weights, { gone: 10, a: 1 }, 1)).toEqual(['b'])
  })
})

describe('leastAssigned', () => {
  it('picks the variant with the fewest so far, the first listed on a tie, and refuses none', () => {
    expect(leastAssigned(['tip', 'question'], {})).toBe('tip')
    expect(leastAssigned(['tip', 'question'], { tip: 3, question: 2 })).toBe('question')
    expect(leastAssigned(['reach', 'standout'], { reach: 1, standout: 1 })).toBe('reach')
    expect(() => leastAssigned([], {})).toThrow('an experiment without variants has none to assign')
  })
})
