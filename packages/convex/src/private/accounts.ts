import { v } from 'convex/values'
import { ITEM_REACH_LABELS, placeOf, wentOut } from '@influstep/shared'
import { internal } from '../_generated/api'
import type { Doc } from '../_generated/dataModel'
import { mutation, query } from '../_generated/server'
import { dayKey, weekStart } from '../core/dates'
import { postBeingWritten } from '../core/posts'
import { assertFormat } from '../core/formats'
import { workingAccountIds } from '../core/jobs'
import { replySummary } from '../core/replies'
import { assertAffiliation, createAccount, planWaitsOf } from '../core/accounts'
import { accountReader, connectionOf, connectionViewOf } from '../core/connections'
import { reportFunnel } from '../core/report'
import { requireWorkspace } from '../core/workspace'
import { enqueueJob } from '../jobs/queue'
import { assertHoursKept } from '../core/experiments'
import { formatFields } from '../lib/validators'
import { refusal } from '../lib/errors'
import { waitingCount, waitingOn } from '../core/waiting'
import { capabilitiesOf } from '../providers/platforms'
import { communitiesOf } from '../core/communities'
import { planWaits } from '../core/planner'
import { weekPosting } from '../core/growth'
import { bioLinkOf, makeBioLink as makeBioLinkRule } from '../core/links'
import { workspaceOf } from '../core/workspace'

/** What an account's settings change: everything but its handle and its platform, which name it and stay as it was made. */
const settingsFields = {
  name: v.string(),
  niche: v.string(),
  audience: v.optional(v.string()),
  tone: v.string(),
  bio: v.string(),
  bible: v.string(),
  affiliationLine: v.string(),
  pillars: v.array(v.string()),
  // The hour its posts start at and its cadence (core/formats.ts checks them against its platform).
  publishHour: formatFields.publishHour,
  cadence: formatFields.cadence,
  sponsorDial: v.number(),
  sponsorRampPosts: v.number(),
  timezone: v.string(),
}

/** An account as it is made: its settings, its handle and its platform. */
const accountFields = { ...settingsFields, handle: v.string(), platform: formatFields.platform }

/** The account page's header counts over the report's window. */
const HEADER_WINDOW_DAYS = 28

export const list = query({
  args: {},
  handler: async (ctx) => {
    const accounts = await ctx.db.query('accounts').collect()
    const working = await workingAccountIds(ctx)
    const out = []
    for (const account of accounts) {
      const posts = await ctx.db
        .query('posts')
        .withIndex('by_account', (q) => q.eq('accountId', account._id))
        .collect()
      const waiting = await waitingOn(ctx, account)
      out.push({
        ...account,
        working: working.has(account._id),
        counts: {
          posted: posts.filter((post) => wentOut(post.status)).length,
          drafts: waiting.drafts.length,
          failed: waiting.failed.length,
          checklist: waiting.checklist.length,
          // The sidebar's mark (core `waitingCount`).
          waitingTotal: waitingCount(waiting),
        },
      })
    }
    return out.sort((a, b) => a.createdAt - b.createdAt)
  },
})

export const get = query({
  args: { accountId: v.id('accounts') },
  handler: async (ctx, args) => {
    const account = await ctx.db.get(args.accountId)
    if (!account) return null
    const messages = (
      await ctx.db
        .query('messages')
        .withIndex('by_account', (q) => q.eq('accountId', account._id))
        .order('desc')
        .take(60)
    ).reverse()
    const directives = await ctx.db
      .query('directives')
      .withIndex('by_account_active', (q) => q.eq('accountId', account._id).eq('active', true))
      .collect()
    const rows = (
      await ctx.db
        .query('posts')
        .withIndex('by_account', (q) => q.eq('accountId', account._id))
        .collect()
    ).sort((a, b) => (a.plannedFor < b.plannedFor ? 1 : -1))
    // An idea says when it is written, or that the writer is on it now (core `postBeingWritten`).
    const posts: (Doc<'posts'> & { writing: boolean })[] = []
    for (const post of rows) {
      posts.push({ ...post, writing: post.status === 'idea' && (await postBeingWritten(ctx, post._id)) })
    }
    const jobs = await ctx.db
      .query('jobs')
      .withIndex('by_account', (q) => q.eq('accountId', account._id))
      .order('desc')
      .take(12)
    // Not from `jobs` above: those are only the newest few, and a job queued for hours can sit behind them.
    const working = (await workingAccountIds(ctx)).has(account._id)
    // The account's own numbers over the report's window, for the page's header (core `reportFunnel`, the report's reading).
    const window = await reportFunnel(ctx, account, HEADER_WINDOW_DAYS, Date.now())
    const communities = await communitiesOf(ctx, account._id)
    // The posts of its week due so far, and how many went out (core/growth.ts).
    const posting = await weekPosting(ctx, account, Date.now())
    return {
      account,
      numbers: {
        posting,
        days: HEADER_WINDOW_DAYS,
        value: window.funnel.value,
        paid: window.funnel.paid,
        reach: window.funnel.reach,
        reachLabel: ITEM_REACH_LABELS[account.platform],
        currency: window.currency,
        mock: window.funnel.mock,
      },
      messages,
      directives,
      // What waits on the operator (core `waitingOn`), as the side column's Waits on you lists it.
      waiting: await waitingOn(ctx, account),
      posts,
      jobs,
      working,
      // Replies (core/replies.ts): the reply budget and what waits.
      replies: await replySummary(ctx, account, Date.now()),
      connection: connectionViewOf(account, await connectionOf(ctx, account._id)),
      // The communities the listener met, and what their rules say of self-promotion.
      communities: communities.map(({ name, selfPromotion, reason, rulesReadAt }) => ({
        name,
        selfPromotion,
        reason,
        rulesReadAt,
      })),
      // The link the operator puts on the account's profile (core/links.ts); null until it is made.
      bioLink: await bioLinkOf(ctx, account, await workspaceOf(ctx, account)),
      // Why the writer plans no post yet, on Reddit and forums before the listener met a community (core/planner `planWaits`).
      planWaits: planWaits(placeOf(account), communities),
      // What the account's reader reads, so the studio offers only the steps it can take.
      reads: capabilitiesOf(await accountReader(ctx, account)),
    }
  },
})

export const create = mutation({
  args: accountFields,
  handler: async (ctx, args) => (await createAccount(ctx, await requireWorkspace(ctx), args))._id,
})

/** Save the settings. */
export const update = mutation({
  args: { accountId: v.id('accounts'), ...settingsFields },
  handler: async (ctx, args) => {
    const { accountId, ...fields } = args
    const account = await ctx.db.get(accountId)
    if (!account) throw new Error('account not found')
    assertFormat({ platform: account.platform, publishHour: fields.publishHour, cadence: fields.cadence })
    await assertHoursKept(ctx, account, fields)
    assertAffiliation(fields.affiliationLine, (await workspaceOf(ctx, account)).sponsorName)
    await ctx.db.patch(accountId, fields)
  },
})

export const setPaused = mutation({
  args: { accountId: v.id('accounts'), paused: v.boolean() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.accountId, { paused: args.paused })
  },
})

/** Queue the writer's plan for the week that holds `weekStart` (today's week by default). */
export const planWeek = mutation({
  args: { accountId: v.id('accounts'), weekStart: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const account = await ctx.db.get(args.accountId)
    if (!account) throw new Error('account not found')
    const waits = await planWaitsOf(ctx, account)
    if (waits !== null) throw refusal(waits)
    const start = args.weekStart ?? weekStart(dayKey(Date.now(), account.timezone))
    return enqueueJob(ctx, { kind: 'plan_week', accountId: account._id, weekStart: start })
  },
})

/**
 * Queue the writer's plan of one week for every account not paused, as
 * Today's week strip asks. An account that plans no post yet (core/planner
 * `planWaits`) is left out and counted; its page says why.
 */
export const planActiveWeek = mutation({
  args: { weekStart: v.string() },
  handler: async (ctx, args): Promise<{ queued: number; waiting: number }> => {
    let queued = 0
    let waiting = 0
    for (const account of await ctx.db.query('accounts').collect()) {
      if (account.paused) continue
      if ((await planWaitsOf(ctx, account)) !== null) {
        waiting += 1
        continue
      }
      await enqueueJob(ctx, { kind: 'plan_week', accountId: account._id, weekStart: args.weekStart })
      queued += 1
    }
    return { queued, waiting }
  },
})

/** Make the account's bio link, for an account made before every account got one. */
export const makeBioLink = mutation({
  args: { accountId: v.id('accounts') },
  handler: async (ctx, args) => {
    const account = await ctx.db.get(args.accountId)
    if (!account) throw new Error('account not found')
    return (await makeBioLinkRule(ctx, account, await workspaceOf(ctx, account))).url
  },
})

export const pollSignals = mutation({
  args: { accountId: v.id('accounts') },
  handler: async (ctx, args) => enqueueJob(ctx, { kind: 'poll_signals', accountId: args.accountId }),
})

export const pullMetrics = mutation({
  args: { accountId: v.id('accounts') },
  handler: async (ctx, args) => enqueueJob(ctx, { kind: 'pull_metrics', accountId: args.accountId }),
})

/**
 * Chat: the operator's message is stored and read once by the account
 * (internal/chat.ts, handleMessage), which decides whether it is a
 * question, a rule, a change to the plan or a task, applies it, and replies.
 */
export const sendMessage = mutation({
  args: { accountId: v.id('accounts'), text: v.string() },
  handler: async (ctx, args): Promise<void> => {
    const text = args.text.trim()
    if (!text) throw refusal('The message is empty.')
    const account = await ctx.db.get(args.accountId)
    if (!account) throw new Error(`account ${args.accountId} not found`)
    const messageId = await ctx.db.insert('messages', { accountId: account._id, author: 'operator', text, createdAt: Date.now() })
    await ctx.scheduler.runAfter(0, internal.internal.chat.handleMessage, { messageId })
  },
})

export const withdrawDirective = mutation({
  args: { directiveId: v.id('directives') },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.directiveId, { active: false, withdrawnAt: Date.now() })
  },
})
