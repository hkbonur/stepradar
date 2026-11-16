import { v } from 'convex/values'
import {
  PLATFORMS,
  REACH_LABELS,
  communityLabel,
  placeOf,
  profileSearchTerms,
  type Platform,
  type PlatformPlace,
  type ProviderKey,
} from '@stepradar/shared'
import { internal } from '../_generated/api'
import type { Doc, Id } from '../_generated/dataModel'
import { internalAction, internalMutation, internalQuery, type ActionCtx } from '../_generated/server'
import { insertAccountPosts } from '../core/history'
import { missingKeys } from '../core/keys'
import { logRepeatedQuestions, writeDailyBrief } from '../core/research'
import { refusal } from '../lib/errors'
import { providersMode } from '../lib/env'
import { cannotRead, platformReader, readerKeys, type FoundSignal, type FoundThread } from '../providers/platforms'
import { suggestionsProvider } from '../providers/suggestions'
import { classifierProvider, classifyBriefOf } from '../providers/classifier'
import { importedPostValidator, signalSourceValidator } from '../lib/validators'
import { actionReader } from './connections'
import { searchTermGroups, threadMoves } from '../providers/platforms/found'

/**
 * The researcher (CONTEXT.md, "Agent"): searches the platforms and the search
 * suggestions for signals, runs the morning sweep, imports the account's own
 * posts and reads the comments under posted posts back into signals. Each action reads through internal queries,
 * calls a provider and writes through internal mutations; a thrown error
 * fails the job in dispatch.ts.
 */

export const pollSignals = internalAction({
  args: { accountId: v.id('accounts') },
  handler: async (ctx, args): Promise<PollResult> => {
    const { account, workspace } = await ctx.runQuery(internal.internal.data.getAccount, { accountId: args.accountId })
    return pollSources(ctx, account, workspace)
  },
})

/**
 * How many threads a poll searches for in each place: the classifier keeps
 * the ones on the account's niche, so the search reads past the few that
 * move most, which on a product's forum are often its outages.
 */
const RESEARCH_SEARCH_LIMIT = 20

/**
 * How many signals a poll stored new, how many of the threads it read for
 * the first time were on the account's niche and how many off it, and the
 * platforms it left unread for want of the operator's keys, with the keys.
 */
type PollResult = { found: number; kept: number; offNiche: number; unread: { platform: Platform; missing: ProviderKey[] }[] }

/**
 * One poll of every source the researcher reads, for the hourly poll and the
 * morning sweep alike: each platform whose reader searches, and each of the
 * workspace's forums, whatever the account's own platform, since a niche is
 * talked about everywhere, then the search suggestions. Comments and problems are not polled here: the comment
 * poll and the problem log write those.
 */
async function pollSources(ctx: ActionCtx, account: Doc<'accounts'>, workspace: Doc<'workspaces'>): Promise<PollResult> {
  const query = {
    terms: [...account.pillars, account.niche],
    since: Date.now() - 7 * 24 * 3_600_000,
    limit: RESEARCH_SEARCH_LIMIT,
    communities: null,
    sponsorName: workspace.sponsorName,
  }
  const profile = profileSearchTerms(workspace.sponsorProfile)
  const mock = providersMode() === 'mock'
  const forums = await ctx.runQuery(internal.internal.data.forums, {})
  const keys = await ctx.runQuery(internal.internal.keys.stored, {})
  const places: PlatformPlace[] = [
    ...PLATFORMS.flatMap((platform) => (platform === 'forum' ? [] : [{ platform }])),
    ...forums.map((forum) => ({ platform: 'forum' as const, forum })),
  ]
  const threads: FoundSignal[] = []
  const unread: PollResult['unread'] = []
  for (const place of places) {
    // A platform whose app keys are not set is left out and named, so the others are still read; nothing stands in for it (ADR 0002).
    const missing = providersMode() === 'real' ? missingKeys(keys, readerKeys(place.platform)) : []
    if (missing.length > 0) {
      unread.push({ platform: place.platform, missing })
      continue
    }
    // A search for the niche reads for no account, so it needs no connection.
    const reader = platformReader(place, null, keys)
    const search = reader.search
    if (!search) continue
    // The account's own terms, then what the sponsor's profile adds, each query with its own limit.
    const found = await searchTermGroups(reader, { own: query.terms, profile }, (terms) => search({ ...query, terms }))
    threads.push(...found.map((thread) => signalOf(place, thread)))
  }
  // The classifier reads each thread once: one already stored keeps its status, and only its numbers follow the source.
  const known = new Set<string>(
    await ctx.runQuery(internal.internal.researcher.storedSignalIds, {
      accountId: account._id,
      externalIds: threads.map((thread) => thread.externalId),
    })
  )
  const fresh = threads.filter((thread) => !known.has(thread.externalId))
  const fits =
    fresh.length === 0
      ? []
      : await classifierProvider(keys).classify(
          classifyBriefOf(
            account,
            workspace,
            fresh.map((thread) => ({ origin: 'search' as const, text: `${thread.title}\n\n${thread.summary}` }))
          )
        )
  const judged = fresh.map((thread, index) => {
    const fit = fits[index]
    if (fit === undefined) throw new Error(`the classifier read ${fits.length} of ${fresh.length} found threads`)
    // A thread off the account's niche is kept dismissed, so it is not read again and the operator can still see it.
    return { ...thread, status: fit.relevant ? ('new' as const) : ('dismissed' as const) }
  })
  const suggestions = (await suggestionsProvider().find(query)).map((signal) => ({ ...signal, status: 'new' as const }))
  const stored: number = await ctx.runMutation(internal.internal.researcher.storeSignals, {
    accountId: account._id,
    signals: [
      ...threads.filter((thread) => known.has(thread.externalId)).map((thread) => ({ ...thread, status: 'new' as const })),
      ...judged,
      ...suggestions,
    ],
    mock,
  })
  return {
    found: stored,
    kept: judged.filter((thread) => thread.status === 'new').length,
    offNiche: judged.filter((thread) => thread.status === 'dismissed').length,
    unread,
  }
}

/** The external ids of these the account has stored as signals already, from any source. */
export const storedSignalIds = internalQuery({
  args: { accountId: v.id('accounts'), externalIds: v.array(v.string()) },
  handler: async (ctx, args): Promise<string[]> => {
    const stored = await ctx.db
      .query('signals')
      .withIndex('by_account_external', (q) => q.eq('accountId', args.accountId))
      .collect()
    const asked = new Set(args.externalIds)
    return stored.filter((signal) => asked.has(signal.externalId)).map((signal) => signal.externalId)
  },
})

/** A found thread as the researcher keeps it: titled, summed up where it was said, its reach and comments, scored by how much it moves. */
function signalOf(place: PlatformPlace, thread: FoundThread): FoundSignal {
  const platform = place.platform
  const forum = place.platform === 'forum' ? [place.forum.name] : []
  const where = [...forum, ...(thread.community === null ? [] : [communityLabel(platform, thread.community)])]
  const numbers = [...where, `${thread.reach} ${REACH_LABELS[platform]}`, `${thread.comments} comments`].join(', ')
  return {
    source: platform,
    // Every forum numbers its topics from 1, so a forum's signal is named by the forum too.
    externalId: place.platform === 'forum' ? `${place.forum.origin}/t/${thread.externalId}` : thread.externalId,
    title: thread.title ?? thread.text.slice(0, 120),
    url: thread.url,
    summary: `${numbers}. ${thread.text.slice(0, 160)}`.trim(),
    score: threadMoves(thread),
    topics: thread.topics,
    publishedAt: thread.postedAt,
  }
}

/**
 * The morning sweep (docs/plan.md, v0.2 item 9): the researcher polls every
 * source, then logs the questions readers keep asking and writes the day's
 * brief from what moved, in that order, so the brief lists today's new
 * problems. It runs after the morning's comment poll, so the comments it
 * groups are today's.
 */
export const morningSweep = internalAction({
  args: { accountId: v.id('accounts') },
  handler: async (ctx, args): Promise<PollResult & { briefId: Id<'memories'>; problems: number }> => {
    const accountId = args.accountId
    const { account, workspace } = await ctx.runQuery(internal.internal.data.getAccount, { accountId })
    const poll = await pollSources(ctx, account, workspace)
    const sweep: { briefId: Id<'memories'>; problems: number } = await ctx.runMutation(internal.internal.researcher.morningSweepMutation, {
      accountId,
    })
    return { ...poll, ...sweep }
  },
})

/** The sweep's writes in one transaction: the problem log first, then the brief that reads it. `problems` counts the new problems. */
export const morningSweepMutation = internalMutation({
  args: { accountId: v.id('accounts') },
  handler: async (ctx, args): Promise<{ briefId: Id<'memories'>; problems: number }> => {
    const account = await ctx.db.get(args.accountId)
    if (!account) throw new Error(`account ${args.accountId} not found`)
    const now = Date.now()
    const problems = await logRepeatedQuestions(ctx, account, now)
    const briefId = await writeDailyBrief(ctx, account, now)
    return { briefId, problems: problems.length }
  },
})

/**
 * A re-found signal keeps its status and its first find; its score and
 * summary follow the source, and its post time too when the source gives
 * one, so a search suggestion people still type stays fresh.
 */
export const storeSignals = internalMutation({
  args: {
    accountId: v.id('accounts'),
    mock: v.boolean(),
    signals: v.array(
      v.object({
        source: signalSourceValidator,
        externalId: v.string(),
        title: v.string(),
        url: v.string(),
        summary: v.string(),
        score: v.number(),
        topics: v.array(v.string()),
        publishedAt: v.optional(v.number()),
        // A new signal's status: new, or dismissed when the classifier read it off the account's niche. A stored one keeps its own.
        status: v.union(v.literal('new'), v.literal('dismissed')),
      })
    ),
  },
  handler: async (ctx, args): Promise<number> => {
    let inserted = 0
    for (const signal of args.signals) {
      const existing = await ctx.db
        .query('signals')
        .withIndex('by_account_external', (q) =>
          q.eq('accountId', args.accountId).eq('source', signal.source).eq('externalId', signal.externalId)
        )
        .first()
      if (existing) {
        await ctx.db.patch(existing._id, {
          score: signal.score,
          summary: signal.summary,
          ...(signal.publishedAt === undefined ? {} : { publishedAt: signal.publishedAt }),
        })
        continue
      }
      await ctx.db.insert('signals', { ...signal, accountId: args.accountId, foundAt: Date.now(), mock: args.mock })
      if (signal.status === 'new') inserted += 1
    }
    return inserted
  },
})

/**
 * The account's own posts become its history, through its platform reader.
 * Reading only; nothing is posted, liked or followed. A reader that cannot
 * read the account's posts fails the job by name (private/history.ts refuses
 * to queue it, so this is a reader that changed since).
 */
export const importHistory = internalAction({
  args: { accountId: v.id('accounts') },
  handler: async (ctx, args): Promise<{ added: number; skipped: number }> => {
    const accountId = args.accountId
    const { account, connection } = await ctx.runQuery(internal.internal.data.getAccount, { accountId })
    const keys = await ctx.runQuery(internal.internal.keys.stored, {})
    const activity = actionReader(ctx, account, connection, keys).activity
    if (!activity) throw refusal(cannotRead(placeOf(account), 'activity'))
    const posts = await activity({ handle: account.handle, since: 0, niche: account.niche, pillars: account.pillars, now: Date.now() })
    return ctx.runMutation(internal.internal.researcher.storeAccountPosts, {
      accountId,
      source: providersMode() === 'mock' ? 'mock' : 'api',
      posts,
    })
  },
})

/** The reader's posts, through the same dedupe as the operator's import: a post already there is skipped. */
export const storeAccountPosts = internalMutation({
  args: {
    accountId: v.id('accounts'),
    source: v.union(v.literal('api'), v.literal('mock')),
    posts: v.array(importedPostValidator),
  },
  handler: async (ctx, args): Promise<{ added: number; skipped: number }> => {
    return insertAccountPosts(ctx, args)
  },
})
