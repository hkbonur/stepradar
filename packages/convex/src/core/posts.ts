import {
  POST_STATUS_LABELS,
  MEASUREMENT_WINDOW_MS,
  lengthKindProblem,
  makeSlug,
  parsePostedLink,
  postHook,
  postProblems,
  saidPosted,
  wentOutAt,
  writeDayOf,
  slugify,
  textEditable,
  type PostIntent,
  type PostKind,
  type PostLength,
  type PlatformPlace,
  placeOf,
  editShareOf,
  canApply,
  type ImportedPost,
  itemTextOf,
} from '@influstep/shared'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { enqueueJob, markFailed } from '../jobs/queue'
import { refusal } from '../lib/errors'
import type { PostBasis } from '../lib/validators'
import { dayKey, instantAt } from './dates'
import { applyEvent, assertTransition } from './pipeline'
import { postingTimeOf, slotHourOf } from './variants'

/**
 * Post rules: how an idea is planned and when its draft is written, how a
 * written post is saved (the writer and the operator's editor both save
 * through `savePost`, so the hook is computed one way and no post is stored
 * that X would refuse), what the operator's "I posted it" records, and what
 * skipping, killing and moving a post do. Operator mutations and agent
 * actions both call these. Influstep never posts (ADR 0004): a written post
 * waits as a draft until the operator posts it by hand.
 */

/** One planned post on X, at one of the day's post slots (shared `postSlotHours`), with the planner's intent and length. */
export type PlannedPostInput = {
  plannedFor: string
  concept: string
  // A replacement keeps the pillar of the post it replaces, which a post planned without one never had.
  pillar?: string
  /** Where it is posted (core/planner.ts `placePost`); absent on X and LinkedIn. */
  community?: string
  sponsorSegment: Doc<'posts'>['sponsorSegment']
  signalIds: Id<'signals'>[]
  kind: PostKind
  publishHour: number
  intent: PostIntent
  length: PostLength
  /** The variant of the running post experiment the planner gave it. */
  experiment?: { experimentId: Id<'experiments'>; variantKey: string }
  /** The standout it is modeled on, or the questions it rounds up (core/niche.ts). */
  basis?: PostBasis
}

/** The signals a post's basis draws on: its model, or its round-up's questions. */
export function basisSignalIds(basis: PostBasis | undefined): Id<'signals'>[] {
  if (basis === undefined) return []
  switch (basis.kind) {
    case 'model':
      return [basis.thread.signalId]
    case 'roundup':
      return basis.questions.map((question) => question.signalId)
    case 'rework':
    case 'launch':
      return []
  }
}

/**
 * A thread is always long and a text post never is (shared
 * `lengthKindProblem`): the planner draws the length first and picks the kind
 * from it, so a mismatch is refused wherever a post's length is written.
 */
export function assertLengthFitsKind(kind: PostKind, length: PostLength): void {
  const problem = lengthKindProblem(kind, length)
  if (problem) throw refusal(problem)
}

/** Stores a written post and its hook, refusing a post X would not take or whose length does not fit its kind. */
export async function savePost(ctx: MutationCtx, postId: Id<'posts'>, args: { title: string; parts: string[] }): Promise<void> {
  const post = await ctx.db.get(postId)
  if (!post) throw new Error(`post ${postId} not found`)
  const account = await ctx.db.get(post.accountId)
  if (!account) throw new Error(`account ${post.accountId} of post ${postId} not found`)
  const [problem] = postProblems({ platform: account.platform, kind: post.kind, community: post.community ?? null }, args)
  if (problem) throw refusal(problem)
  assertLengthFitsKind(post.kind, post.length)
  await ctx.db.patch(postId, { title: args.title, parts: args.parts, hook: postHook(args.parts), updatedAt: Date.now() })
}

/**
 * The item a posted link names (shared `parsePostedLink`): its url and the id
 * the analyst reads the numbers by; null without a link, and a refusal for a
 * link that names nothing of the operator's where the account takes part.
 */
export function postedLinkOf(place: PlatformPlace, url: string | undefined): { url: string; externalId: string } | null {
  const link = parsePostedLink(place, url)
  if (link.kind === 'invalid') throw refusal(link.problem)
  if (link.kind === 'none') return null
  return { url: link.url, externalId: link.externalId }
}

/**
 * A new idea. The writer gets it the day before it is due (`queueWriteIfDue`),
 * so an idea for today or tomorrow is queued at once and a later one waits.
 */
export async function createIdea(ctx: MutationCtx, account: Doc<'accounts'>, input: PlannedPostInput): Promise<Id<'posts'>> {
  assertLengthFitsKind(input.kind, input.length)
  const now = Date.now()
  const postId = await ctx.db.insert('posts', {
    accountId: account._id,
    slug: `${slugify(input.concept) || 'post'}-${makeSlug(4)}`,
    kind: input.kind,
    intent: input.intent,
    length: input.length,
    status: 'idea',
    concept: input.concept,
    title: input.concept,
    hook: '',
    sponsorSegment: input.sponsorSegment,
    plannedFor: input.plannedFor,
    scheduledAt: instantAt(input.plannedFor, input.publishHour, account.timezone),
    signalIds: input.signalIds,
    pillar: input.pillar,
    community: input.community,
    ...(input.experiment === undefined ? {} : { experimentId: input.experiment.experimentId, variantKey: input.experiment.variantKey }),
    ...(input.basis === undefined ? {} : { basis: input.basis }),
    createdAt: now,
    updatedAt: now,
  })
  // Used, a signal is drawn on once and never ages out while its post may still be written.
  for (const signalId of [...input.signalIds, ...basisSignalIds(input.basis)]) await ctx.db.patch(signalId, { status: 'used' })
  await queueWriteIfDue(ctx, account, { _id: postId, status: 'idea', plannedFor: input.plannedFor }, now)
  return postId
}

/**
 * Whether the writer is on the post now: a write of it is queued or running.
 * The studio's "Writing now" and the chat's "The writer is on it" read it,
 * and `queueWriteIfDue` never queues a second write beside one.
 */
export async function postBeingWritten(ctx: { db: QueryCtx['db'] }, postId: Id<'posts'>): Promise<boolean> {
  const jobs = await ctx.db
    .query('jobs')
    .withIndex('by_post', (q) => q.eq('postId', postId))
    .collect()
  return jobs.some((job) => {
    if (job.kind !== 'write_post') return false
    return job.status === 'queued' || job.status === 'running'
  })
}

/** What `queueWriteIfDue` did: queued the write, found it already queued, or left the idea waiting for its day. */
export type WriteQueueOutcome = 'queued' | 'waiting' | 'already'

/**
 * The one place a post's write is queued (CONTEXT.md, "Just-in-time draft").
 * A post is written the day before it is due (shared `writeDayOf`), after
 * that morning's sweep, so the writer reads what moved and the last check can
 * swap a concept that went cold. An idea on or after its write day with no
 * write already queued or running is queued now; anything else waits. Today
 * is the account's own calendar day.
 */
export async function queueWriteIfDue(
  ctx: MutationCtx,
  account: Pick<Doc<'accounts'>, '_id' | 'timezone'>,
  post: Pick<Doc<'posts'>, '_id' | 'status' | 'plannedFor'>,
  now: number
): Promise<WriteQueueOutcome> {
  if (post.status !== 'idea') return 'waiting'
  if (await postBeingWritten(ctx, post._id)) return 'already'
  if (dayKey(now, account.timezone) < writeDayOf(post.plannedFor)) return 'waiting'
  await enqueueJob(ctx, { kind: 'write_post', accountId: account._id, postId: post._id })
  return 'queued'
}

/** Why the morning's due-draft pass skips an idea nobody wrote in time. */
export const DAY_PASSED = 'Its day passed before it was written.'

/**
 * The account's ideas on the morning's due-draft pass (internal/schedule.ts
 * `writeDuePosts`, after the sweep): an idea whose day is already past is
 * skipped, since a post for it would come late; every other idea goes
 * through `queueWriteIfDue`, so tomorrow's are written now, after the last
 * check.
 */
export async function queueDuePosts(
  ctx: MutationCtx,
  account: Pick<Doc<'accounts'>, '_id' | 'timezone'>,
  now: number
): Promise<{ queued: number; skipped: number }> {
  const today = dayKey(now, account.timezone)
  const posts = await ctx.db
    .query('posts')
    .withIndex('by_account', (q) => q.eq('accountId', account._id))
    .collect()
  let queued = 0
  let skipped = 0
  for (const post of posts) {
    if (post.status !== 'idea') continue
    if (post.plannedFor < today) {
      await applyEvent(ctx, post, { type: 'skipped', reason: DAY_PASSED })
      skipped += 1
      continue
    }
    if ((await queueWriteIfDue(ctx, account, post, now)) === 'queued') queued += 1
  }
  return { queued, skipped }
}

/** What a draft the operator passed on keeps as its reason. */
export const SKIPPED_BY_OPERATOR = 'You skipped it.'

/** Loads a post the operator acts on; a missing one is a bug, since the studio only names posts it read. */
async function postOf(ctx: { db: QueryCtx['db'] }, postId: Id<'posts'>): Promise<Doc<'posts'>> {
  const post = await ctx.db.get(postId)
  if (!post) throw new Error(`post ${postId} not found`)
  return post
}

/** The operator passes on an idea or a draft: it stays on the calendar, struck through, and is never written or posted. */
export async function skipPost(ctx: MutationCtx, postId: Id<'posts'>): Promise<void> {
  await applyEvent(ctx, await postOf(ctx, postId), { type: 'skipped', reason: SKIPPED_BY_OPERATOR })
}

/**
 * The operator edits what a post says, while it is still open (shared
 * `textEditable`): once they posted it or let it go, it is locked.
 */
export async function editPost(ctx: MutationCtx, postId: Id<'posts'>, edit: { title: string; parts: string[] }): Promise<void> {
  const post = await postOf(ctx, postId)
  if (!textEditable(post.status))
    throw refusal(`The post is locked once you posted it; this one is at "${POST_STATUS_LABELS[post.status]}".`)
  await savePost(ctx, postId, edit)
  // The judge reads the operator's words too, and only says what it finds: it never sends an edit back (internal/judge.ts).
  if (post.status === 'draft') await enqueueJob(ctx, { kind: 'judge_post', accountId: post.accountId, postId, wordsBy: 'operator' })
}

/**
 * The operator says they posted a draft, in the words they posted (the
 * draft, or their edit of it), with its link when they have it
 * (`postedLinkOf`).
 */
export async function markPostPosted(
  ctx: MutationCtx,
  postId: Id<'posts'>,
  posted: { title: string; parts: string[]; url: string | undefined },
  now: number
): Promise<void> {
  const post = await postOf(ctx, postId)
  const account = await ctx.db.get(post.accountId)
  if (!account) throw new Error(`account ${post.accountId} of post ${post._id} not found`)
  // Only a written draft can be posted, so once that holds it has the parts the operator's words are compared with.
  assertTransition(post, 'posted')
  const editShare = editShareOf(account.platform, postTextOf(post), posted.parts.join('\n\n'))
  await applyEvent(ctx, post, { type: 'posted', posted: saidPosted(now, postedLinkOf(placeOf(account), posted.url), editShare) })
  await savePost(ctx, postId, { title: posted.title, parts: posted.parts })
}

/** What a written post says, its parts in one text. Only a written post can be posted, so one with no parts is a bug. */
export function postTextOf(post: Doc<'posts'>): string {
  if (post.parts === undefined) throw new Error(`post ${post._id} at ${post.status} was never written`)
  return post.parts.join('\n\n')
}

/**
 * The match found a post among the account's own items (core/match.ts): it
 * is posted at the platform's time, id and link. A draft found this way on X
 * or LinkedIn gets its edit share, and a single post there takes the words
 * the operator posted, as marking it posted does; the platform took them, so
 * they are not checked again. Elsewhere the parts stay as written: a Reddit
 * or Hacker News item is a title and a body, and an X thread's item is its
 * first part alone. A post the operator moved meanwhile stays where it is.
 */
export async function matchPost(ctx: MutationCtx, account: Doc<'accounts'>, postId: Id<'posts'>, item: ImportedPost): Promise<boolean> {
  const post = await postOf(ctx, postId)
  if (!canApply(post.status, 'matched')) return false
  // A post the operator marked posted keeps the edit share and the words they gave it.
  const fresh = post.status === 'draft' ? editShareOf(account.platform, postTextOf(post), itemTextOf(item)) : null
  await applyEvent(ctx, post, { type: 'matched', item, editShare: fresh ?? post.posted?.editShare ?? null })
  if (fresh !== null && post.kind === 'text') await ctx.db.patch(post._id, { parts: item.parts, hook: postHook(item.parts) })
  return true
}

/** Posted posts past their measurement window become measured; one with no link closes the same way, with no numbers. */
export async function closeMeasuredPosts(ctx: MutationCtx, accountId: Id<'accounts'>, now: number): Promise<number> {
  const posts = await ctx.db
    .query('posts')
    .withIndex('by_account', (q) => q.eq('accountId', accountId))
    .collect()
  let measured = 0
  for (const post of posts) {
    if (post.status !== 'posted') continue
    if (wentOutAt(post) + MEASUREMENT_WINDOW_MS > now) continue
    await applyEvent(ctx, post, { type: 'measured' })
    measured += 1
  }
  return measured
}

/**
 * Sends a written post back to the writer. It is an idea again, so it is
 * written the day before it is due like any idea (`queueWriteIfDue`): at
 * once when that day has come, else on its write day.
 */
export async function rewritePost(ctx: MutationCtx, postId: Id<'posts'>, now: number): Promise<void> {
  const post = await postOf(ctx, postId)
  const status = await applyEvent(ctx, post, { type: 'rewrite' })
  await queueWriteIfDue(ctx, await accountOf(ctx, post), { _id: postId, status, plannedFor: post.plannedFor }, now)
}

/**
 * The judge sends a weak draft back to the writer (internal/judge.ts): an
 * idea again, written at once, since its writing day already came when it
 * was written, whatever day that was.
 */
export async function sendBackToWriter(ctx: MutationCtx, postId: Id<'posts'>): Promise<void> {
  const post = await postOf(ctx, postId)
  await applyEvent(ctx, post, { type: 'rewrite' })
  await enqueueJob(ctx, { kind: 'write_post', accountId: post.accountId, postId })
}

/**
 * Retries a failed post where it failed (shared POST_EVENTS): a write that
 * failed is an idea again and is queued when due; a draft keeps its words.
 */
export async function retryPost(ctx: MutationCtx, postId: Id<'posts'>, now: number): Promise<void> {
  const post = await postOf(ctx, postId)
  const status = await applyEvent(ctx, post, { type: 'retry' })
  await queueWriteIfDue(ctx, await accountOf(ctx, post), { _id: postId, status, plannedFor: post.plannedFor }, now)
}

async function accountOf(ctx: { db: QueryCtx['db'] }, post: Doc<'posts'>): Promise<Doc<'accounts'>> {
  const account = await ctx.db.get(post.accountId)
  if (!account) throw new Error(`account ${post.accountId} not found`)
  return account
}

/** What a job of a killed post that had not started yet fails with, so its row says why it never ran. */
export const KILLED_BEFORE_RUN = 'The post was killed before this ran.'

/**
 * The operator withdraws a post, on its page or in chat. Every job still
 * queued for it fails with the reason, so the writer never picks it up. A
 * write already running finishes against a killed post and stores nothing.
 */
export async function killPost(ctx: MutationCtx, postId: Id<'posts'>): Promise<void> {
  await applyEvent(ctx, await postOf(ctx, postId), { type: 'killed' })
  const jobs = await ctx.db
    .query('jobs')
    .withIndex('by_post', (q) => q.eq('postId', postId))
    .collect()
  for (const job of jobs) {
    if (job.status !== 'queued') continue
    await markFailed(ctx, job._id, KILLED_BEFORE_RUN)
  }
}

/**
 * Moves a post to another calendar day, on the calendar or in chat, while it
 * is still open (shared `textEditable`): never once it is posted. It keeps
 * its slot's hour. An idea moved to tomorrow or today gets its write queued;
 * a draft moved later keeps its words.
 */
export async function reschedulePost(ctx: MutationCtx, postId: Id<'posts'>, plannedFor: string): Promise<void> {
  const post = await postOf(ctx, postId)
  if (!textEditable(post.status)) throw refusal(`A post at "${POST_STATUS_LABELS[post.status]}" cannot be moved.`)
  const account = await accountOf(ctx, post)
  // A posting time test moves a whole day by one variant, so a post moved to another day leaves it, back at its slot's hour.
  const postingTime = await postingTimeOf(ctx, post)
  const scheduledAt = instantAt(plannedFor, slotHourOf(post, postingTime, account.timezone), account.timezone)
  const untested = postingTime === null ? {} : { experimentId: undefined, variantKey: undefined }
  await ctx.db.patch(postId, { plannedFor, scheduledAt, ...untested, updatedAt: Date.now() })
  await queueWriteIfDue(ctx, account, { _id: post._id, status: post.status, plannedFor }, Date.now())
}
