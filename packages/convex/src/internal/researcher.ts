import { v } from 'convex/values'
import { PLATFORMS, REACH_LABELS, communityLabel, placeOf, type PlatformPlace } from '@influstep/shared'
import { internal } from '../_generated/api'
import type { Doc, Id } from '../_generated/dataModel'
import { internalAction, internalMutation, type ActionCtx } from '../_generated/server'
import { insertAccountPosts } from '../core/history'
import { logRepeatedQuestions, writeDailyBrief } from '../core/research'
import { refusal } from '../lib/errors'
import { providersMode } from '../lib/env'
import { cannotRead, platformReader, type FoundSignal, type FoundThread } from '../providers/platforms'
import { suggestionsProvider } from '../providers/suggestions'
import { importedPostValidator, signalSourceValidator } from '../lib/validators'
import { actionReader } from './connections'
import { threadMoves } from '../providers/platforms/found'

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
    return pollSources(ctx, account, workspace.sponsorName)
  },
})

/** How many signals a poll stored new. */
type PollResult = { found: number }

/**
 * One poll of every source the researcher reads, for the hourly poll and the
 * morning sweep alike: each platform whose reader searches, and each of the
 * workspace's forums, whatever the account's own platform, since a niche is
 * talked about everywhere, then the search suggestions. Comments and problems are not polled here: the comment
 * poll and the problem log write those.
 */
async function pollSources(ctx: ActionCtx, account: Doc<'accounts'>, sponsorName: string): Promise<PollResult> {
  const query = {
    terms: [...account.pillars, account.niche],
    since: Date.now() - 7 * 24 * 3_600_000,
    limit: 5,
    communities: null,
    sponsorName,
  }
  const mock = providersMode() === 'mock'
  const store = (signals: FoundSignal[]) =>
    ctx.runMutation(internal.internal.researcher.storeSignals, { accountId: account._id, signals, mock })
  const forums = await ctx.runQuery(internal.internal.data.forums, {})
  const places: PlatformPlace[] = [
    ...PLATFORMS.flatMap((platform) => (platform === 'forum' ? [] : [{ platform }])),
    ...forums.map((forum) => ({ platform: 'forum' as const, forum })),
  ]
  let found = 0
  for (const place of places) {
    // A search for the niche reads for no account, so it needs no connection.
    const search = platformReader(place, null).search
    if (search) found += await store((await search(query)).map((thread) => signalOf(place, thread)))
  }
  found += await store(await suggestionsProvider().find(query))
  return { found }
}

/** A found thread as the researcher keeps it: titled, summed up where it was said, its reach and comments, scored by how much it moves. */
function signalOf(place: PlatformPlace, thread: FoundThread): FoundSignal {
  const platform = place.platform
  const forum = place.platform === 'forum' ? [place.forum.name] : []
  const where = [...forum, ...(thread.community === null ? [] : [communityLabel(platform, thread.community)])]
  const numbers = [...where, `${thread.reach} ${REACH_LABELS[platform]}`, `${thread.comments} comments`].join(', ')
  return {
    source: platform,
    externalId: thread.externalId,
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
    const poll = await pollSources(ctx, account, workspace.sponsorName)
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
      await ctx.db.insert('signals', { ...signal, accountId: args.accountId, status: 'new', foundAt: Date.now(), mock: args.mock })
      inserted += 1
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
    const activity = actionReader(ctx, account, connection).activity
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
