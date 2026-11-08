import {
  MEASUREMENT_WINDOW_MS,
  REPLY_EVENTS,
  REPLY_PEER_MAX,
  STANDOUT_AGE_MS,
  STANDOUT_COMMENTS_MAX,
  REPLY_STATUS_LABELS,
  canApplyReply,
  communityLabel,
  effectiveVariant,
  fitVerdict,
  heardVerdict,
  isReplyExperimentKind,
  isReplyTargetKey,
  leastAssigned,
  replyProblems,
  type HeardFit,
  type HeardThread,
  risingRead,
  type RisingRead,
  type ThreadLink,
  type Platform,
  type HeardVerdict,
  type ReplyStatus,
  type ReplyTargetKey,
  byReach,
  editShareOf,
  staleAt,
  type ImportedPost,
  type Posted,
  asksForLink,
  itemTextOf,
  placeOf,
  foundPosted,
  saidPosted,
  wentOutAt,
} from '@influstep/shared'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { enqueueJob } from '../jobs/queue'
import { refusal } from '../lib/errors'
import { dayKey, instantAt } from './dates'
import { replyBudget } from './formats'
import { commentWaits, followAnswer } from './comments'
import { communitiesOf, sameCommunity } from './communities'
import { experimentLoader, taggedVariant } from './variants'
import { postedLinkOf } from './posts'
import { workspaceOf } from './workspace'

/**
 * Replies (shared replies.ts): what the listener keeps, what becomes
 * of a written reply, and the daily reply budget. Every written reply waits
 * as a draft until the operator posts it by hand and says so (ADR 0004).
 */

type Reader = { db: QueryCtx['db'] }

/** The account's replies at one status. */
export function repliesWithStatus(ctx: Reader, accountId: Id<'accounts'>, status: ReplyStatus): Promise<Doc<'replies'>[]> {
  return ctx.db
    .query('replies')
    .withIndex('by_account_status', (q) => q.eq('accountId', accountId).eq('status', status))
    .collect()
}

/** The account's replies the operator posted, measured or not. */
export async function postedReplies(ctx: Reader, accountId: Id<'accounts'>): Promise<Doc<'replies'>[]> {
  return [...(await repliesWithStatus(ctx, accountId, 'posted')), ...(await repliesWithStatus(ctx, accountId, 'measured'))]
}

const STALE_REASON = 'Went stale: nobody posted it within a day, and the conversation moved on.'

/** A reply's moves, each an event of the shared table (REPLY_EVENTS) with the fields it carries. */
type ReplyEvent =
  | { type: 'written'; text: string; at: number }
  | { type: 'passed'; reason: string; at: number }
  | { type: 'stale' }
  | { type: 'posted'; text: string; posted: Posted }
  | { type: 'matched'; item: ImportedPost; editShare: number | null }
  | { type: 'skipped' }
  | { type: 'asked' }
  | { type: 'measured' }

function replyFields(event: ReplyEvent): Partial<Doc<'replies'>> {
  switch (event.type) {
    case 'written':
      return { text: event.text, writtenAt: event.at }
    case 'passed':
      return { skipReason: event.reason, writtenAt: event.at }
    case 'stale':
      return { skipReason: STALE_REASON }
    case 'posted':
      return { text: event.text, posted: event.posted }
    case 'matched':
      return { text: itemTextOf(event.item), posted: foundPosted(event.item, event.editShare) }
    case 'skipped':
      return { skipReason: 'You passed on it.' }
    case 'asked':
      return { operatorAsked: true, skipReason: undefined, text: '' }
    case 'measured':
      return {}
  }
}

/** Moves a reply, or refuses with the event's own words (shared REPLY_EVENTS). */
async function moveReply(ctx: MutationCtx, reply: Doc<'replies'>, event: ReplyEvent): Promise<ReplyStatus> {
  const rule = REPLY_EVENTS[event.type]
  if (!canApplyReply(reply.status, event.type)) {
    if ('refusal' in rule) throw refusal(rule.refusal(REPLY_STATUS_LABELS[reply.status].toLowerCase()))
    throw new Error(`a reply at ${reply.status} cannot take "${event.type}"`)
  }
  await ctx.db.patch(reply._id, { status: rule.to, ...replyFields(event) })
  // An answer to a comment or a mention carries its comment along (shared COMMENT_STATUS_OF_ANSWER).
  if (answersComment(reply)) await followAnswer(ctx, reply.accountId, reply.inReplyTo, rule.to)
  return rule.to
}

/** Whether a reply answers a comment or a mention, whose status follows it. */
function answersComment(reply: Pick<Doc<'replies'>, 'origin'>): boolean {
  return reply.origin === 'comment' || reply.origin === 'mention'
}

/** Loads a reply the operator acts on; a missing one is a bug, since the studio only names replies it read. */
async function replyOf(ctx: Reader, replyId: Id<'replies'>): Promise<Doc<'replies'>> {
  const reply = await ctx.db.get(replyId)
  if (!reply) throw new Error(`reply ${replyId} not found`)
  return reply
}

/** How many found posts one sweep keeps, the ones with the most reach first, so drafts never pile up past a day's budget. */
export const REPLY_SEARCH_PER_SWEEP = 3

/** How many heard posts one write_replies job writes. */
export const REPLY_WRITES_PER_RUN = 10

/** Replies the writer drafted since the account's local midnight, passed-on posts aside: what the budget counts. */
export async function repliesDraftedToday(ctx: Reader, account: Doc<'accounts'>, now: number): Promise<number> {
  const midnight = instantAt(dayKey(now, account.timezone), 0, account.timezone)
  const rows = await ctx.db
    .query('replies')
    .withIndex('by_account_written', (q) => q.eq('accountId', account._id).gte('writtenAt', midnight))
    .collect()
  return rows.filter((reply) => reply.status !== 'skipped').length
}

/** What the replies page and the account page read of the budget. */
export async function budgetView(ctx: Reader, account: Doc<'accounts'>, now: number): Promise<{ budget: number; draftedToday: number }> {
  return { budget: replyBudget(account), draftedToday: await repliesDraftedToday(ctx, account, now) }
}

export interface HeardOutcome {
  kept: number
  skipped: number
  stale: number
  /** The kept thread drawing answers fastest, when one is rising (shared `isRising`); the operator is told at once. */
  rising: RisingThread | null
}

/** A rising thread as the push names it: where it was said, and how many answered in how long. */
export interface RisingThread {
  replyId: Id<'replies'>
  /** Its title, or its first words where the platform posts no title. */
  about: string
  community: string | null
  comments: number
  minutes: number
}

/** The variant a reply carries from the reply experiment that ran when it was heard. */
interface ReplyTag {
  experimentId: Id<'experiments'>
  variantKey: string
}

/**
 * What one sweep answers and how (the reply dimensions). The target picks
 * among the found posts: every one, the most reach first, or only where a
 * reply stands out (`targeted`). A running reply target experiment picks the
 * sweep's target by its variants, balanced by the replies each already has,
 * and every reply to a found post it keeps carries that variant; otherwise
 * the target in force does (shared `effectiveVariant`). A running experiment
 * on another reply dimension (style, length, sponsor mention) gives each kept
 * reply a variant the same way, one reply at a time. A post experiment tags
 * no reply.
 */
interface SweepPlan {
  target: ReplyTargetKey
  targetTag: ReplyTag | null
  /** The running experiment on a reply dimension the writer reads, whose variants the kept replies take in turn. */
  styles: { experimentId: Id<'experiments'>; keys: string[]; assigned: Record<string, number> } | null
}

async function sweepPlan(ctx: Reader, account: Doc<'accounts'>): Promise<SweepPlan> {
  const running = await ctx.db
    .query('experiments')
    .withIndex('by_account_status', (q) => q.eq('accountId', account._id).eq('status', 'running'))
    .first()
  const inForce = targetKey(effectiveVariant('reply_target', {}, account.strategy?.defaults).key)
  if (!running || !isReplyExperimentKind(running.kind)) return { target: inForce, targetTag: null, styles: null }
  const keys = running.variants.map((variant) => variant.key)
  const assigned: Record<string, number> = {}
  const tagged = await ctx.db
    .query('replies')
    .withIndex('by_experiment', (q) => q.eq('experimentId', running._id))
    .collect()
  for (const reply of tagged) {
    if (reply.variantKey === undefined) continue
    assigned[reply.variantKey] = (assigned[reply.variantKey] ?? 0) + 1
  }
  if (running.kind === 'reply_target') {
    const variantKey = leastAssigned(keys, assigned)
    return { target: targetKey(variantKey), targetTag: { experimentId: running._id, variantKey }, styles: null }
  }
  return { target: inForce, targetTag: null, styles: { experimentId: running._id, keys, assigned } }
}

/** `startExperiment` takes only reply targets the listener knows, and the default came from one, so another key is a bug. */
function targetKey(key: string): ReplyTargetKey {
  if (!isReplyTargetKey(key)) throw new Error(`"${key}" is no reply target the listener knows`)
  return key
}

/**
 * Whether a found post is one the target answers: under `reach`, every one;
 * where a reply stands out, on X an author under REPLY_PEER_MAX followers,
 * on Reddit, Hacker News and forums a thread younger than STANDOUT_AGE_MS
 * with at most STANDOUT_COMMENTS_MAX comments when heard.
 */
function targeted(target: ReplyTargetKey, platform: Platform, post: HeardThread, now: number): boolean {
  if (target === 'reach') return true
  if (platform === 'x') return post.reach !== null && post.reach < REPLY_PEER_MAX
  return now - post.postedAt < STANDOUT_AGE_MS && post.comments !== null && post.comments <= STANDOUT_COMMENTS_MAX
}

/** The variant a kept reply carries: the sweep's target for a reply to a found post, else the next balanced style, else none. */
function tagFor(plan: SweepPlan, post: HeardThread): ReplyTag | null {
  if (plan.targetTag !== null) return post.origin === 'search' ? plan.targetTag : null
  if (plan.styles === null) return null
  const variantKey = leastAssigned(plan.styles.keys, plan.styles.assigned)
  plan.styles.assigned[variantKey] = (plan.styles.assigned[variantKey] ?? 0) + 1
  return { experimentId: plan.styles.experimentId, variantKey }
}

/**
 * The rules' verdict on each heard post (shared `heardVerdict`): whose it is,
 * how old, how much reach, whether it was answered already or names the
 * sponsor. The listener asks before the classifier reads, so the classifier
 * reads only what the rules keep, and the store asks again as it stores.
 */
export async function ruledHeard(
  ctx: Reader,
  account: Doc<'accounts'>,
  posts: HeardThread[],
  now: number
): Promise<{ post: HeardThread; verdict: HeardVerdict }[]> {
  const workspace = await workspaceOf(ctx, account)
  const answered = new Set<string>()
  for (const post of posts) {
    const row = await ctx.db
      .query('replies')
      .withIndex('by_account_target', (q) => q.eq('accountId', account._id).eq('inReplyTo', post.externalId))
      .first()
    if (row) answered.add(post.externalId)
  }
  const context = { platform: account.platform, accountHandle: account.handle, sponsorName: workspace.sponsorName, answered, now }
  const removed = (await communitiesOf(ctx, account._id)).filter((community) => community.removedAt !== undefined)
  return posts.map((post) => {
    const verdict = heardVerdict(post, context)
    const name = post.community
    // A community that removed one of the account's items gets no new replies until the operator looks (core/communities.ts `recordRemoval`).
    if (verdict.kind !== 'keep' || post.origin !== 'search' || name === null) return { post, verdict }
    if (!removed.some((community) => sameCommunity(community.name, name))) return { post, verdict }
    const label = communityLabel(account.platform, name)
    return {
      post,
      verdict: {
        kind: 'skip' as const,
        reason: `${label} removed one of your posts or replies; the account answers there again once you look.`,
      },
    }
  })
}

/**
 * What the listener heard becomes rows: a post worth answering is heard and
 * waits for the writer, a post naming the sponsor is passed on with the
 * reason, everything else is dropped unseen, by the rules (`ruledHeard`) or
 * by the classifier's read (shared `fitVerdict`). Every row keeps the read;
 * Today ranks drafts by it (docs/plan.md, slice 7). Found
 * posts are kept by the sweep's target (`SweepPlan`), the ones with the most
 * reach first, at most REPLY_SEARCH_PER_SWEEP a sweep; a mention or a reply
 * under the account's post is always kept. A kept reply carries the variant a
 * running reply experiment gives it; a passed one carries none, since only
 * the operator can ask for it. Drafts nobody posted within a day go stale
 * first.
 */
export async function storeHeard(
  ctx: MutationCtx,
  account: Doc<'accounts'>,
  args: { heard: { post: HeardThread; fit: HeardFit }[]; now: number; mock: boolean }
): Promise<HeardOutcome> {
  // The pass judged these while the operator could still let a comment go or answer it: those get no answer now.
  const heard = []
  for (const row of args.heard)
    if (!answersComment(row.post) || (await commentWaits(ctx, account._id, row.post.externalId))) heard.push(row)
  return storeJudged(ctx, account, { ...args, heard })
}

async function storeJudged(
  ctx: MutationCtx,
  account: Doc<'accounts'>,
  args: { heard: { post: HeardThread; fit: HeardFit }[]; now: number; mock: boolean }
): Promise<HeardOutcome> {
  const stale = await skipStale(ctx, account._id, args.now)
  const plan = await sweepPlan(ctx, account)
  const ruled = await ruledHeard(
    ctx,
    account,
    args.heard.map(({ post }) => post),
    args.now
  )
  // The rules first, then the classifier's read of what they keep.
  const judged = args.heard.map(({ post, fit }, index) => {
    const verdict = ruled[index]?.verdict
    if (verdict === undefined) throw new Error(`the rules judged ${ruled.length} of ${args.heard.length} heard posts`)
    return { post, fit, verdict: verdict.kind === 'keep' ? fitVerdict(fit) : verdict }
  })
  const found = judged
    .filter(
      ({ post, verdict }) => verdict.kind === 'keep' && post.origin === 'search' && targeted(plan.target, account.platform, post, args.now)
    )
    .sort((a, b) => byReach(a.post, b.post))
    .slice(0, REPLY_SEARCH_PER_SWEEP)
  let kept = 0
  let skipped = 0
  const rising: { replyId: Id<'replies'>; post: HeardThread; read: RisingRead }[] = []
  for (const { post, fit, verdict } of judged) {
    if (verdict.kind === 'drop') continue
    if (verdict.kind === 'keep' && post.origin === 'search' && !found.some((candidate) => candidate.post === post)) continue
    const tag = verdict.kind === 'keep' ? tagFor(plan, post) : null
    // The comment count picked the target when it was heard; the reply keeps the thread as it was said.
    const { origin, externalId, pillar, comments: _comments, ...thread } = post
    const replyId = await ctx.db.insert('replies', {
      accountId: account._id,
      origin,
      inReplyTo: externalId,
      thread,
      pillar: pillar ?? undefined,
      fit,
      ...(tag === null ? {} : tag),
      status: verdict.kind === 'keep' ? 'heard' : 'skipped',
      text: '',
      skipReason: verdict.kind === 'skip' ? verdict.reason : undefined,
      operatorAsked: false,
      heardAt: args.now,
      mock: args.mock,
    })
    const read = verdict.kind === 'keep' && origin === 'search' ? risingRead(post, args.now) : null
    if (read !== null) rising.push({ replyId, post, read })
    if (verdict.kind === 'keep') kept += 1
    else skipped += 1
  }
  // One push a sweep, for the thread drawing answers fastest: the rest wait on the replies page like any other.
  const [fastest] = rising.sort((a, b) => b.read.perHour - a.read.perHour)
  for (const { post } of args.heard) {
    if (!answersComment(post)) continue
    const answer = await ctx.db
      .query('replies')
      .withIndex('by_account_target', (q) => q.eq('accountId', account._id).eq('inReplyTo', post.externalId))
      .first()
    await followAnswer(ctx, account._id, post.externalId, answer?.status ?? null)
  }
  return {
    kept,
    skipped,
    stale,
    rising:
      fastest === undefined
        ? null
        : {
            replyId: fastest.replyId,
            about: fastest.post.title ?? fastest.post.text,
            community: fastest.post.community,
            comments: fastest.read.comments,
            minutes: fastest.read.minutes,
          },
  }
}

/**
 * Drafts, and heard posts the budget left unwritten, past their time (shared
 * `staleAt`) are passed on: the conversation moved on.
 */
async function skipStale(ctx: MutationCtx, accountId: Id<'accounts'>, now: number): Promise<number> {
  let stale = 0
  for (const status of ['draft', 'heard'] as const) {
    for (const reply of await repliesWithStatus(ctx, accountId, status)) {
      if (now <= staleAt(reply)) continue
      await moveReply(ctx, reply, { type: 'stale' })
      stale += 1
    }
  }
  return stale
}

/** What the writer made of a heard post: the reply, or why the account passes on it. */
export type WrittenReply = { kind: 'reply'; text: string } | { kind: 'skip'; reason: string }

/**
 * A written reply waits for the operator as a draft. A post the operator
 * passed on meanwhile stays passed on.
 */
export async function storeWritten(ctx: MutationCtx, replyId: Id<'replies'>, written: WrittenReply, now: number): Promise<ReplyStatus> {
  const reply = await replyOf(ctx, replyId)
  if (!canApplyReply(reply.status, 'written')) return reply.status
  if (written.kind === 'skip') return moveReply(ctx, reply, { type: 'passed', reason: written.reason, at: now })
  return moveReply(ctx, reply, { type: 'written', text: written.text, at: now })
}

/**
 * The operator posted a draft by hand and says so, with the words they
 * posted (the draft, or their edit of it) and its link when they have it
 * (core/posts.ts `postedLinkOf`).
 */
export async function markReplyPosted(
  ctx: MutationCtx,
  replyId: Id<'replies'>,
  posted: { text: string; url: string | undefined },
  now: number
): Promise<void> {
  const reply = await replyOf(ctx, replyId)
  const account = await ctx.db.get(reply.accountId)
  if (!account) throw new Error(`account ${reply.accountId} of reply ${reply._id} not found`)
  // The operator answers for what they post themselves, the sponsor included; only the platform's own rules hold.
  const problems = replyProblems(posted.text, account.platform)
  if (problems.length > 0) throw refusal(problems.join(' '))
  const text = posted.text.trim()
  await moveReply(ctx, reply, {
    type: 'posted',
    text,
    posted: saidPosted(now, postedLinkOf(placeOf(account), posted.url), editShareOf(account.platform, reply.text, text)),
  })
}

/**
 * The match found a reply among the account's own items (core/match.ts): it
 * is posted in the platform's words, time, id and link. A draft found this
 * way gets its edit share now; a reply the operator marked posted keeps the
 * one their words gave it. A reply the operator moved meanwhile stays where
 * it is.
 */
export async function matchReply(ctx: MutationCtx, account: Doc<'accounts'>, replyId: Id<'replies'>, item: ImportedPost): Promise<boolean> {
  const reply = await replyOf(ctx, replyId)
  if (!canApplyReply(reply.status, 'matched')) return false
  // A reply the operator marked posted keeps the edit share their words gave it.
  const fresh = reply.status === 'draft' ? editShareOf(account.platform, reply.text, itemTextOf(item)) : null
  await moveReply(ctx, reply, { type: 'matched', item, editShare: fresh ?? reply.posted?.editShare ?? null })
  return true
}

/** The operator copied a draft or opened its thread: the match orders its candidates by when (docs/plan.md, slice 5). */
export async function openReply(ctx: MutationCtx, replyId: Id<'replies'>, now: number): Promise<void> {
  const reply = await replyOf(ctx, replyId)
  if (reply.status !== 'draft') return
  await ctx.db.patch(reply._id, { openedAt: now })
}

/**
 * The operator lets a comment go that waits for its answer: its answer,
 * waiting or being written, is passed on with it, so no draft lingers for a
 * comment nobody will answer.
 */
export async function dismissComment(ctx: MutationCtx, commentId: Id<'comments'>, now: number): Promise<void> {
  const comment = await ctx.db.get(commentId)
  if (!comment) throw new Error(`comment ${commentId} not found`)
  if (comment.status !== 'new') throw refusal('Only a comment that waits for its answer can be let go.')
  const answer = await ctx.db
    .query('replies')
    .withIndex('by_account_target', (q) => q.eq('accountId', comment.accountId).eq('inReplyTo', comment.externalId))
    .first()
  if (answer?.status === 'draft') await moveReply(ctx, answer, { type: 'skipped' })
  if (answer?.status === 'heard') await moveReply(ctx, answer, { type: 'passed', reason: 'You let the comment go.', at: now })
  await ctx.db.patch(commentId, { status: 'dismissed' })
}

/** The operator passes on a draft. */
export async function skipReply(ctx: MutationCtx, replyId: Id<'replies'>): Promise<void> {
  await moveReply(ctx, await replyOf(ctx, replyId), { type: 'skipped' })
}

/**
 * The operator asks for a reply to a post the account passed on: the writer
 * writes one whatever the rules say, it may answer about the sponsor, and it
 * waits as a draft for the operator to post.
 */
export async function askForReply(ctx: MutationCtx, replyId: Id<'replies'>): Promise<void> {
  const reply = await replyOf(ctx, replyId)
  await moveReply(ctx, reply, { type: 'asked' })
  await enqueueJob(ctx, { kind: 'write_replies', accountId: reply.accountId })
}

/** Posted replies past their measurement window become measured; one with no link closes the same way, with no numbers. */
export async function closeMeasuredReplies(ctx: MutationCtx, accountId: Id<'accounts'>, now: number): Promise<number> {
  let closed = 0
  for (const reply of await repliesWithStatus(ctx, accountId, 'posted')) {
    if (now - wentOutAt(reply) <= MEASUREMENT_WINDOW_MS) continue
    await moveReply(ctx, reply, { type: 'measured' })
    closed += 1
  }
  return closed
}

/** What the account page says of the replies: the budget, today's count, and what waits. */
export async function replySummary(ctx: Reader, account: Doc<'accounts'>, now: number) {
  return {
    ...(await budgetView(ctx, account, now)),
    waiting: (await repliesWithStatus(ctx, account._id, 'draft')).length,
    beingWritten: (await repliesWithStatus(ctx, account._id, 'heard')).length,
  }
}

/** How many rows of the posted and skipped lists the replies page shows, newest first. */
const HISTORY_ROWS = 30

/**
 * The replies page: what waits for the operator, what is being written, what
 * the operator posted with what it brought back, and what the
 * account passed on and why. A reply heard during a reply experiment names
 * the variant it tests.
 */
/** A reply as a page shows it: the row, the variant of the experiment it tests, and whether it asks for its link. */
export type ReplyRow = Doc<'replies'> & { variant: { label: string } | null; asksForLink: boolean }

/** The rows of the replies page and Today, read the same way. */
export async function replyRowsOf(ctx: Reader, rows: Doc<'replies'>[], now: number): Promise<ReplyRow[]> {
  const experimentOf = experimentLoader(ctx)
  const out: ReplyRow[] = []
  for (const reply of rows) {
    const experiment = reply.experimentId === undefined ? null : await experimentOf(reply.experimentId)
    const variant = taggedVariant(reply, experiment)
    out.push({ ...reply, variant: variant === undefined ? null : { label: variant.label }, asksForLink: asksForLink(reply, now) })
  }
  return out
}

export async function repliesView(ctx: Reader, account: Doc<'accounts'>, now: number) {
  const withVariant = (rows: Doc<'replies'>[]) => replyRowsOf(ctx, rows, now)
  const of = async (status: ReplyStatus) => withVariant(await repliesWithStatus(ctx, account._id, status))
  // Sorted copies, largest first: the history by when it happened.
  const by = <T extends Doc<'replies'>>(rows: T[], key: (reply: T) => number) => [...rows].sort((a, b) => key(b) - key(a))
  return {
    ...(await budgetView(ctx, account, now)),
    // What the operator asked for first, then the threads that reach most.
    waiting: (await of('draft')).sort((a, b) => Number(b.operatorAsked) - Number(a.operatorAsked) || byReach(a.thread, b.thread)),
    beingWritten: await of('heard'),
    posted: by(await withVariant(await postedReplies(ctx, account._id)), wentOutAt).slice(0, HISTORY_ROWS),
    skipped: by(await of('skipped'), (reply) => reply.writtenAt ?? reply.heardAt).slice(0, HISTORY_ROWS),
  }
}

/**
 * A thread the operator pasted, where no reader hears it: it waits for the
 * writer as a reply the operator asked for, with the classifier's read kept
 * though never used to drop it. A thread already answered or pasted is
 * refused.
 */
export async function storePasted(
  ctx: MutationCtx,
  account: Doc<'accounts'>,
  pasted: { link: Extract<ThreadLink, { kind: 'link' }>; text: string; fit: HeardFit },
  now: number
): Promise<Id<'replies'>> {
  const existing = await ctx.db
    .query('replies')
    .withIndex('by_account_target', (q) => q.eq('accountId', account._id).eq('inReplyTo', pasted.link.externalId))
    .first()
  if (existing) throw refusal('This thread already has a reply; it is on this page.')
  const replyId = await ctx.db.insert('replies', {
    accountId: account._id,
    origin: 'pasted',
    inReplyTo: pasted.link.externalId,
    thread: {
      url: pasted.link.url,
      title: null,
      text: pasted.text,
      postedAt: null,
      author: pasted.link.author === null ? null : { handle: pasted.link.author, name: pasted.link.author },
      reach: null,
      community: pasted.link.community,
    },
    fit: pasted.fit,
    status: 'heard',
    text: '',
    operatorAsked: true,
    heardAt: now,
    mock: false,
  })
  await enqueueJob(ctx, { kind: 'write_replies', accountId: account._id })
  return replyId
}
