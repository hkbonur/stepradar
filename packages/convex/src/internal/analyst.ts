import { v } from 'convex/values'
import {
  EXPERIMENT_METRIC_LABELS,
  METRIC_MIN_EVENTS,
  experimentVerdict,
  itemsNoun,
  variantRate,
  reachOf,
  voiceStatsOf,
  forumHost,
  placeOf,
  utmMediumOf,
  type ItemCounts,
} from '@influstep/shared'
import { internal } from '../_generated/api'
import type { Doc } from '../_generated/dataModel'
import { internalAction, internalMutation, internalQuery, type ActionCtx } from '../_generated/server'
import { accountCountsOf, examplePostsOf, newestOriginalsOf, topOriginalsOf, voiceSampleOf } from '../core/history'
import {
  closeMeasured as closeMeasuredRule,
  itemsToMeasure,
  storeNumbers as storeNumbersRule,
  type ItemRef,
  type ToMeasure,
} from '../core/measure'
import { analystDecisionNote, applyExperimentDecision, postModelStall, stopExperiment, variantStatsFor } from '../core/experiments'
import { reviewStrategy as reviewStrategyRule, type ReviewOutcome } from '../core/strategy'
import { accountBriefOf } from '../core/accounts'
import { closeItemsWith } from '../core/checklist'
import { shownClicks } from '../core/posted'
import { providersMode } from '../lib/env'
import { analyticsProvider, type FoundConversion, type MockPostVisits } from '../providers/analytics'
import type { PlatformReader } from '../providers/platforms'
import { llmProvider, type AccountPostSample } from '../providers/llm'
import {
  accountReachValidator,
  foundConversionValidator,
  foundProbableValidator,
  itemCountsValidator,
  itemRefValidator,
  voiceValidator,
} from '../lib/validators'
import { actionReader } from './connections'

/**
 * The analyst (CONTEXT.md, "Agent"): reads the numbers and the conversions,
 * closes measured posts, decides experiments, reviews the strategy and learns
 * the voice. A thrown error fails the job in dispatch.ts.
 */

/**
 * The analyst's read of an account's numbers: each post and reply in its
 * measurement window (core/measure.ts) and the account's karma or followers
 * through its reader, then the conversions, the items past their window, and
 * the experiments. A reader that cannot read numbers leaves them to the
 * operator, and the pull reads the conversions all the same.
 */
export const pullMetrics = internalAction({
  args: { accountId: v.id('accounts') },
  handler: async (
    ctx,
    args
  ): Promise<{ counted: number; removed: number; conversions: number; measured: { posts: number; replies: number } }> => {
    const accountId = args.accountId
    const { account, connection } = await ctx.runQuery(internal.internal.data.getAccount, { accountId })
    const reader = actionReader(ctx, account, connection)
    const mock = providersMode() === 'mock'
    const { numbers, removed } = await readNumbers(ctx, account, reader)
    const reach = reader.account ? await reader.account(account.handle) : null
    await ctx.runMutation(internal.internal.analyst.storeNumbers, { accountId, numbers, removed, reach, mock })
    const since = Date.now() - 30 * 24 * 3_600_000
    // Only the mock reads the visits; the product's own analytics have the conversions.
    const mockVisits = mock ? await ctx.runQuery(internal.internal.analyst.mockVisits, { accountId, since }) : []
    const medium = utmMediumOf(placeOf(account))
    const found = await analyticsProvider().conversions({ accountHandle: account.handle, medium, since, mockVisits })
    const conversions = await ctx.runMutation(internal.internal.analyst.storeConversions, { accountId, conversions: found, mock })
    const measured = await ctx.runMutation(internal.internal.analyst.closeMeasured, { accountId })
    await ctx.runMutation(internal.internal.analyst.evaluateExperiments, { accountId })
    return { counted: numbers.length, removed: removed.length, conversions, measured }
  },
})

/**
 * The numbers of the account's items in their window, each paired with its
 * post or reply, and the ones their community removed; an item its platform
 * no longer shows has neither.
 */
async function readNumbers(
  ctx: ActionCtx,
  account: Doc<'accounts'>,
  reader: PlatformReader
): Promise<{ numbers: { item: ItemRef; counts: ItemCounts }[]; removed: ItemRef[] }> {
  const read = { numbers: [] as { item: ItemRef; counts: ItemCounts }[], removed: [] as ItemRef[] }
  if (!reader.counts) return read
  const items = await ctx.runQuery(internal.internal.analyst.toMeasure, { accountId: account._id })
  if (items.length === 0) return read
  for (const counted of await reader.counts(items.map(({ item, externalId, postedAt }) => ({ externalId, kind: item.kind, postedAt })))) {
    const asked = items.filter((item) => item.externalId === counted.externalId)
    if (asked.length === 0) throw new Error(`the ${account.platform} reader counted ${counted.externalId}, which it was not asked for`)
    for (const { item } of asked) {
      if ('removed' in counted) read.removed.push(item)
      else read.numbers.push({ item, counts: counted.counts })
    }
  }
  return read
}

export const toMeasure = internalQuery({
  args: { accountId: v.id('accounts') },
  handler: async (ctx, args): Promise<ToMeasure[]> => itemsToMeasure(ctx, args.accountId, Date.now()),
})

/**
 * The account's sponsored posts since a time as the mock analytics reads
 * them (providers/analytics MockPostVisits): a tracked link's clicks, or on a
 * platform whose posts link to the sponsor directly, the post's reach at its
 * last read.
 */
export const mockVisits = internalQuery({
  args: { accountId: v.id('accounts'), since: v.number() },
  handler: async (ctx, args): Promise<MockPostVisits[]> => {
    const account = await ctx.db.get(args.accountId)
    if (!account) throw new Error(`account ${args.accountId} not found`)
    const posts = await ctx.db
      .query('posts')
      .withIndex('by_account_posted', (q) => q.eq('accountId', args.accountId).gte('posted.at', args.since))
      .collect()
    const sponsored = posts.flatMap((post) =>
      post.sponsorLink === undefined || post.posted === undefined ? [] : [{ post, postedAt: post.posted.at }]
    )
    return Promise.all(
      sponsored.map(async ({ post, postedAt }) => {
        const clicks = await shownClicks(ctx, account.platform, post._id)
        // Where no click is counted, the post's reach at its last read stands in for its visits.
        const visits = clicks ?? (post.numbers === undefined ? 0 : (reachOf(post.numbers.counts) ?? 0))
        return { slug: post.slug, variantKey: post.variantKey, postedAt, visits }
      })
    )
  },
})

export const storeNumbers = internalMutation({
  args: {
    accountId: v.id('accounts'),
    numbers: v.array(v.object({ item: itemRefValidator, counts: itemCountsValidator })),
    removed: v.array(itemRefValidator),
    reach: v.union(accountReachValidator, v.null()),
    mock: v.boolean(),
  },
  handler: async (ctx, args) => storeNumbersRule(ctx, args.accountId, args, Date.now()),
})

function postOfConversion(conversion: FoundConversion, posts: Doc<'posts'>[]): Doc<'posts'> | undefined {
  if (!conversion.utm.campaign) return undefined
  return posts.find((candidate) => candidate.slug === conversion.utm.campaign)
}

export const storeConversions = internalMutation({
  args: {
    accountId: v.id('accounts'),
    mock: v.boolean(),
    conversions: v.array(foundConversionValidator),
  },
  handler: async (ctx, args): Promise<number> => {
    let inserted = 0
    const posts = await ctx.db
      .query('posts')
      .withIndex('by_account', (q) => q.eq('accountId', args.accountId))
      .collect()
    for (const conversion of args.conversions) {
      const kind = conversion.kind
      const existing = await ctx.db
        .query('conversions')
        .withIndex('by_distinct', (q) => q.eq('distinctId', conversion.distinctId).eq('kind', kind))
        .first()
      if (existing) continue
      const post = postOfConversion(conversion, posts)
      await ctx.db.insert('conversions', {
        accountId: args.accountId,
        postId: post?._id,
        variantKey: conversion.utm.content,
        kind,
        distinctId: conversion.distinctId,
        at: conversion.at,
        mock: args.mock,
      })
      inserted += 1
    }
    return inserted
  },
})

/**
 * The workspace's probable conversions of the last 30 days (shared
 * probable.ts), read once a day for every platform: they name a platform,
 * not an account. A forum's visitors come from the workspace's forums.
 */
export const pullProbable = internalAction({
  args: {},
  handler: async (ctx): Promise<{ probable: number }> => {
    const forums = await ctx.runQuery(internal.internal.data.forums, {})
    const found = await analyticsProvider().probableConversions({
      since: Date.now() - 30 * 24 * 3_600_000,
      forumHosts: forums.map(forumHost),
    })
    const mock = providersMode() === 'mock'
    return { probable: await ctx.runMutation(internal.internal.analyst.storeProbable, { conversions: found, mock }) }
  },
})

/** The probable conversions found, each person's conversion of a kind once. */
export const storeProbable = internalMutation({
  args: { mock: v.boolean(), conversions: v.array(foundProbableValidator) },
  handler: async (ctx, args): Promise<number> => {
    let inserted = 0
    for (const conversion of args.conversions) {
      const existing = await ctx.db
        .query('probableConversions')
        .withIndex('by_distinct', (q) => q.eq('distinctId', conversion.distinctId).eq('kind', conversion.kind))
        .first()
      if (existing) continue
      await ctx.db.insert('probableConversions', { ...conversion, mock: args.mock })
      inserted += 1
    }
    return inserted
  },
})

/** Posts and replies past their measurement window become measured (core/measure.ts). */
export const closeMeasured = internalMutation({
  args: { accountId: v.id('accounts') },
  handler: async (ctx, args): Promise<{ posts: number; replies: number }> => closeMeasuredRule(ctx, args.accountId, Date.now()),
})

/**
 * The verdict on the account's running experiments, after every metrics
 * pull, asked once every variant has its items (shared `experimentVerdict`):
 * asking again with each new item would find a winner by chance. A decision
 * lands through core `applyExperimentDecision`, the one place a decision
 * lands for the analyst and the operator alike: the winner becomes the
 * account's default for the dimension, a learning, a journal entry and one
 * chat message. The winner's rate and the runner-up's, at the moment of the
 * decision, go with it, so the strategy review can tell when later data
 * contradicts the winner, and the runner-up's key, which a re-test runs
 * against. A test with no clear winner stops, and the account's one slot is
 * free for the next.
 */
export const evaluateExperiments = internalMutation({
  args: { accountId: v.id('accounts') },
  handler: async (ctx, args): Promise<{ decided: number }> => {
    const experiments = await ctx.db
      .query('experiments')
      .withIndex('by_account_status', (q) => q.eq('accountId', args.accountId).eq('status', 'running'))
      .collect()
    let decided = 0
    for (const experiment of experiments) {
      const stalled = await postModelStall(ctx, experiment, Date.now())
      if (stalled !== null) {
        await stopExperiment(ctx, experiment._id, { actor: 'analyst', why: stalled })
        continue
      }
      const stats = await variantStatsFor(ctx, experiment)
      const verdict = experimentVerdict(stats, {
        minItems: experiment.minItems,
        minConfidence: experiment.minConfidence,
        minEvents: METRIC_MIN_EVENTS[experiment.metric],
      })
      if (verdict.kind === 'waiting') continue
      if (verdict.kind === 'inconclusive') {
        const why = `Every variant reached ${experiment.minItems} ${itemsNoun(experiment.kind)} and none led on ${EXPERIMENT_METRIC_LABELS[experiment.metric]} with ${Math.round(experiment.minConfidence * 100)}% confidence.`
        await stopExperiment(ctx, experiment._id, { actor: 'analyst', why })
        continue
      }
      const decision = verdict.decision
      if (!experiment.variants.some((variant) => variant.key === decision.winnerKey))
        throw new Error(`experiment ${experiment._id} was decided for "${decision.winnerKey}", which is not one of its variants`)
      // The same order decideExperiment ranks by, so the runner-up is the variant the winner was tested against.
      const ranked = [...stats].sort((a, b) => variantRate(b) - variantRate(a))
      const winnerStats = ranked.find((stat) => stat.key === decision.winnerKey)
      const runnerUp = ranked.find((stat) => stat.key !== decision.winnerKey)
      if (!winnerStats || !runnerUp)
        throw new Error(`experiment ${experiment._id} was decided without a winner and a runner-up in its stats`)
      await applyExperimentDecision(
        ctx,
        experiment,
        { ...decision, winnerRate: variantRate(winnerStats), runnerUpRate: variantRate(runnerUp), runnerUpKey: runnerUp.key },
        'analyst',
        analystDecisionNote(experiment, decision)
      )
      decided += 1
    }
    return { decided }
  },
})

/**
 * The weekly strategy review (docs/plan.md, v0.2 item 8). Every rule it
 * applies is deterministic code in core `reviewStrategy` (pillar weights,
 * publish hours, contradicted defaults, the next experiment), so the review
 * calls no model and runs in one mutation: its changes, journal entries and
 * chat message land together or not at all. The outcome is the job's result.
 */
export const reviewStrategy = internalMutation({
  args: { accountId: v.id('accounts') },
  handler: async (ctx, args): Promise<ReviewOutcome> => {
    const account = await ctx.db.get(args.accountId)
    if (!account) throw new Error(`account ${args.accountId} not found`)
    return reviewStrategyRule(ctx, account, Date.now())
  },
})

/** How many of the account's most engaging originals the analyst marks as examples when it learns the voice. */
const LEARNED_EXAMPLES = 5
/** How many of the top and of the newest originals the model reads verbatim. */
const VOICE_READ_POSTS = 30

/**
 * Learn the voice (docs/plan.md, slice 5). Everything countable comes from
 * the counts kept as posts are imported (shared `voiceStatsOf`), and the
 * examples are the originals with the most likes plus reposts; the language
 * model writes only the language, the summary and the traits, from the top
 * and the newest originals verbatim. Nothing here reads every post, so an
 * archive of any size can be learned from. Learning again replaces the voice
 * and every example mark.
 */
export const learnVoice = internalAction({
  args: { accountId: v.id('accounts') },
  handler: async (ctx, args): Promise<{ language: string; sampleSize: number; examples: number }> => {
    const accountId = args.accountId
    const { account } = await ctx.runQuery(internal.internal.data.getAccount, { accountId })
    const reading: VoiceReading = await ctx.runQuery(internal.internal.analyst.voiceReading, { accountId, read: VOICE_READ_POSTS })
    const stats = voiceStatsOf(voiceSampleOf(reading.counts))
    const draft = await llmProvider().learnVoice({
      account: accountBriefOf(account),
      stats,
      top: reading.top.map(sampleOf),
      newest: reading.newest.map(sampleOf),
    })
    const examples = reading.top.slice(0, LEARNED_EXAMPLES).map((post) => post._id)
    await ctx.runMutation(internal.internal.analyst.storeVoice, {
      accountId,
      voice: {
        ...draft,
        lengthMix: stats.lengthMix,
        emoji: stats.emoji,
        hashtags: stats.hashtags,
        sampleSize: stats.sampleSize,
        learnedAt: Date.now(),
      },
      exampleIds: examples,
    })
    return { language: draft.language, sampleSize: stats.sampleSize, examples: examples.length }
  },
})

interface VoiceReading {
  /** The account's counts row, null before its first import. */
  counts: Doc<'accountCounts'> | null
  /** The `read` most engaging originals, most engaging first. */
  top: Doc<'accountPosts'>[]
  /** The `read` newest originals that are not among the top, newest first. */
  newest: Doc<'accountPosts'>[]
}

/** What the analyst learns a voice from, in one read: the counts, and the originals the model reads verbatim. */
export const voiceReading = internalQuery({
  args: { accountId: v.id('accounts'), read: v.number() },
  handler: async (ctx, args): Promise<VoiceReading> => {
    const counts = await accountCountsOf(ctx, args.accountId)
    const top = await topOriginalsOf(ctx, args.accountId, args.read)
    const topIds = new Set(top.map((post) => post._id))
    // Every top post can be among the newest too, so reading that many more still leaves `read` others.
    const newest = (await newestOriginalsOf(ctx, args.accountId, args.read + top.length))
      .filter((post) => !topIds.has(post._id))
      .slice(0, args.read)
    return { counts, top, newest }
  },
})

/** The learned voice, and exactly these posts as the examples: every earlier mark is cleared. */
export const storeVoice = internalMutation({
  args: { accountId: v.id('accounts'), voice: voiceValidator, exampleIds: v.array(v.id('accountPosts')) },
  handler: async (ctx, args) => {
    const marked = await examplePostsOf(ctx, args.accountId)
    for (const post of marked) if (!args.exampleIds.includes(post._id)) await ctx.db.patch(post._id, { example: false })
    for (const id of args.exampleIds) {
      const post = await ctx.db.get(id)
      if (!post || post.accountId !== args.accountId) throw new Error(`account post ${id} is not ${args.accountId}'s`)
      await ctx.db.patch(id, { example: true })
    }
    await ctx.db.patch(args.accountId, { voice: args.voice })
    await closeItemsWith(ctx, args.accountId, 'learn_voice', Date.now())
  },
})

function sampleOf(post: Doc<'accountPosts'>): AccountPostSample {
  return { parts: post.parts, lang: post.lang ?? null, likes: post.likes, reposts: post.reposts }
}
