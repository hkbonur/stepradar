import { ConvexError } from 'convex/values'
import {
  AGENT_ROLE_LABELS,
  JOB_KINDS,
  JOB_KIND_LABELS,
  MODELED_KEY,
  WEEKDAYS,
  WEEKDAY_LABELS,
  isChatTask,
  matchPosts,
  writeDayOf,
  shortDayLabel,
  textEditable,
  weekdayOf,
  type ChatIntent,
  type PostTarget,
  type Weekday,
} from '@influstep/shared'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { enqueueJob } from '../jobs/queue'
import { addDays, dayKey, hourAt, weekStart } from './dates'
import { createIdea, killPost, reschedulePost, postBeingWritten } from './posts'
import { rememberFromOperator } from './memory'

/**
 * The account's chat as a way to change things (docs/plan.md, slice 7). An
 * operator message is read once into an intent (shared `ChatIntent`); the
 * rules here apply it and store what the account says back. Nothing here
 * throws a refusal at the operator: a change that cannot apply is a reply
 * that says why, and nothing changes.
 */

type Reader = { db: QueryCtx['db'] }

/** How many planned posts a reply lists when the message named none of them. */
const PLAN_LINES = 5

/**
 * The posts a chat message may change: the account's own from today (in its
 * timezone) through the end of next week, at a changeable status. Sorted by
 * the time they are due. This list is what the interpreter sees and the only
 * thing a chat change can touch.
 */
export async function changeablePlan(ctx: Reader, accountId: Id<'accounts'>): Promise<Doc<'posts'>[]> {
  const account = await ctx.db.get(accountId)
  if (!account) throw new Error(`account ${accountId} not found`)
  const today = dayKey(Date.now(), account.timezone)
  const lastDay = addDays(weekStart(today), 13)
  const posts = await ctx.db
    .query('posts')
    .withIndex('by_account_day', (q) => q.eq('accountId', accountId).gte('plannedFor', today).lte('plannedFor', lastDay))
    .collect()
  // What a chat change may touch is what the operator can still edit: nothing posted, measured, skipped or killed.
  return posts.filter((post) => textEditable(post.status)).sort((a, b) => a.scheduledAt - b.scheduledAt)
}

/** What a chat message did: the account's reply, the post it touched or created, the job it queued. */
export interface ChatOutcome {
  text: string
  postId?: Id<'posts'>
  jobId?: Id<'jobs'>
}

/**
 * Applies an operator message's intent and stores the account's reply, linked
 * to the post and the job when there is one; returns what it stored. A
 * directive or a conversation is answered with `reply`, the provider's reply
 * written in the action before this mutation; every other kind is answered
 * here and takes null.
 */
export async function applyChatIntent(
  ctx: MutationCtx,
  account: Doc<'accounts'>,
  messageId: Id<'messages'>,
  intent: ChatIntent,
  reply: string | null
): Promise<ChatOutcome> {
  switch (intent.kind) {
    case 'conversation':
      return storeReply(ctx, account, { text: providerReply(reply, intent.kind) })
    case 'directive':
      return applyDirective(ctx, account, messageId, intent.text, providerReply(reply, intent.kind))
    case 'replace':
      return storeReply(ctx, account, await replacePost(ctx, account, intent.target, intent.concept))
    case 'move':
      return storeReply(ctx, account, await movePost(ctx, account, intent.target, intent.to))
    case 'drop':
      return storeReply(ctx, account, await dropPost(ctx, account, intent.target))
    case 'task':
      return storeReply(ctx, account, await askForTask(ctx, account, messageId, intent))
    case 'remember':
      return storeReply(ctx, account, await remember(ctx, account, messageId, intent))
  }
}

/**
 * A fact or a rule the operator asked the account to remember goes into its
 * memory with the message as its evidence, and the reply says it in the
 * account's words. Words already remembered are not stored twice.
 */
async function remember(
  ctx: MutationCtx,
  account: Doc<'accounts'>,
  messageId: Id<'messages'>,
  intent: Extract<ChatIntent, { kind: 'remember' }>
): Promise<ChatOutcome> {
  const outcome = await rememberFromOperator(ctx, account, { kind: intent.memory, text: intent.text, messageId, now: Date.now() })
  switch (outcome.status) {
    case 'invalid':
      return { text: `I could not keep that. ${outcome.problem}` }
    case 'known':
      return { text: `I already remember that: "${outcome.text}"` }
    case 'stored':
      return {
        text:
          intent.memory === 'rule'
            ? `I will keep this rule: "${outcome.text}" I read my rules before every post and reply.`
            : `I will remember that: "${outcome.text}" I read what I know before every post and reply.`,
      }
  }
}

function providerReply(reply: string | null, kind: ChatIntent['kind']): string {
  if (reply === null) throw new Error(`a ${kind} message is answered with the provider's reply, and none was given`)
  return reply
}

async function storeReply(
  ctx: MutationCtx,
  account: Doc<'accounts'>,
  outcome: ChatOutcome,
  directiveId?: Id<'directives'>
): Promise<ChatOutcome> {
  await ctx.db.insert('messages', {
    accountId: account._id,
    author: 'account',
    text: outcome.text,
    directiveId,
    postId: outcome.postId,
    jobId: outcome.jobId,
    createdAt: Date.now(),
  })
  return outcome
}

type Attempt<T> = { ok: true; value: T } | { ok: false; refusal: string }

/**
 * Runs a rule and hands back its refusal as the text of the reply instead of
 * throwing it. Every rule called this way refuses before its first write, so
 * a refusal leaves nothing changed. A bug still throws.
 */
async function attempt<T>(rule: () => Promise<T>): Promise<Attempt<T>> {
  try {
    return { ok: true, value: await rule() }
  } catch (error) {
    if (error instanceof ConvexError && typeof error.data === 'string') return { ok: false, refusal: error.data }
    throw error
  }
}

/** "Tue 13 Oct: Retry a failed webhook". */
function planLine(post: Doc<'posts'>): string {
  return `${shortDayLabel(post.plannedFor)}: ${post.title}`
}

function weekdayLabel(day: string): string {
  return WEEKDAY_LABELS[weekdayOf(day)]
}

type Resolved = { ok: true; post: Doc<'posts'> } | { ok: false; text: string }

/** The one post of the changeable plan a target names, or the reply that says there is none or that there are several. */
async function resolveTarget(ctx: Reader, account: Doc<'accounts'>, target: PostTarget): Promise<Resolved> {
  const plan = await changeablePlan(ctx, account._id)
  const matches = matchPosts(plan, target)
  const [only] = matches
  if (only && matches.length === 1) return { ok: true, post: only }
  if (matches.length > 1)
    return { ok: false, text: `That matches ${matches.length} posts: ${matches.map(planLine).join('; ')}. Which one?` }
  const notFound = 'I could not find a post of mine that matches.'
  if (plan.length === 0) return { ok: false, text: `${notFound} Nothing of mine can change between today and the end of next week.` }
  return { ok: false, text: `${notFound} Planned:\n${plan.slice(0, PLAN_LINES).map(planLine).join('\n')}` }
}

/**
 * The target is killed and a new idea takes its day: the same kind, sponsor
 * segment, slot, intent, length, community and variant, the pillar kept, with the concept the
 * operator asked for. No signal feeds it. The writer gets it as any idea, the
 * day before it is due (core `queueWriteIfDue`), and the reply says when.
 *
 * The kill cannot refuse a post of the changeable plan, which holds only
 * statuses that can be killed, so a refusal there is a bug and throws.
 */
async function replacePost(ctx: MutationCtx, account: Doc<'accounts'>, target: PostTarget, concept: string): Promise<ChatOutcome> {
  const resolved = await resolveTarget(ctx, account, target)
  if (!resolved.ok) return { text: resolved.text }
  const old = resolved.post
  const newConcept = concept.trim()
  if (newConcept === '') return { text: `What should replace "${old.title}"? Say what the new post is about.`, postId: old._id }
  const postId = await createIdea(ctx, account, {
    kind: old.kind,
    publishHour: hourAt(old.scheduledAt, account.timezone),
    intent: old.intent,
    length: old.length,
    plannedFor: old.plannedFor,
    concept: newConcept,
    pillar: old.pillar,
    community: old.community,
    sponsorSegment: old.sponsorSegment,
    signalIds: [],
    // It takes the slot, so it keeps the variant the slot carried, and on a posting time test the hour the variant moved it to.
    // A modeled post's variant under a post model test is the standout it was modeled on, which the operator's words replace:
    // the replacement leaves the test, as a post kind the placement changed does.
    ...(old.experimentId === undefined || old.variantKey === undefined || (old.variantKey === MODELED_KEY && old.basis?.kind === 'model')
      ? {}
      : { experiment: { experimentId: old.experimentId, variantKey: old.variantKey } }),
  })
  await killPost(ctx, old._id)
  const when = (await postBeingWritten(ctx, postId))
    ? 'The writer is on it.'
    : `The writer writes it on ${shortDayLabel(writeDayOf(old.plannedFor))}.`
  return { text: `Replaced ${weekdayLabel(old.plannedFor)}'s "${old.title}" with "${newConcept}". ${when}`, postId }
}

/** To the named weekday of the post's own week (Monday first, in the account's timezone), never to a day that has passed. */
async function movePost(ctx: MutationCtx, account: Doc<'accounts'>, target: PostTarget, to: Weekday): Promise<ChatOutcome> {
  const resolved = await resolveTarget(ctx, account, target)
  if (!resolved.ok) return { text: resolved.text }
  const post = resolved.post
  const from = weekdayLabel(post.plannedFor)
  const plannedFor = addDays(weekStart(post.plannedFor), WEEKDAYS.indexOf(to))
  if (plannedFor === post.plannedFor) return { text: `"${post.title}" is already on ${from}.`, postId: post._id }
  if (plannedFor < dayKey(Date.now(), account.timezone)) {
    return { text: `${shortDayLabel(plannedFor)} has passed, so "${post.title}" stays on ${from}.`, postId: post._id }
  }
  const moved = await attempt(() => reschedulePost(ctx, post._id, plannedFor))
  if (!moved.ok) return { text: moved.refusal, postId: post._id }
  return { text: `Moved "${post.title}" from ${from} to ${WEEKDAY_LABELS[to]}.`, postId: post._id }
}

async function dropPost(ctx: MutationCtx, account: Doc<'accounts'>, target: PostTarget): Promise<ChatOutcome> {
  const resolved = await resolveTarget(ctx, account, target)
  if (!resolved.ok) return { text: resolved.text }
  const post = resolved.post
  const killed = await attempt(() => killPost(ctx, post._id))
  if (!killed.ok) return { text: killed.refusal, postId: post._id }
  return {
    text: `Dropped "${post.title}" (${weekdayLabel(post.plannedFor)}). It stays on the calendar as killed.`,
    postId: post._id,
  }
}

/**
 * A directive is stored as it is today: the operator's message carries its
 * id, so the chat marks it and Withdraw reaches it, and the account's reply
 * carries it too. The interpreter may restate the directive; the words it
 * stores are the interpreter's, or the operator's own message when the
 * interpreter gave none.
 */
async function applyDirective(
  ctx: MutationCtx,
  account: Doc<'accounts'>,
  messageId: Id<'messages'>,
  restated: string,
  reply: string
): Promise<ChatOutcome> {
  const message = await ctx.db.get(messageId)
  if (!message) throw new Error(`message ${messageId} not found`)
  if (message.accountId !== account._id) throw new Error(`message ${messageId} belongs to another account`)
  const text = restated.trim() === '' ? message.text : restated.trim()
  const directiveId = await ctx.db.insert('directives', { accountId: account._id, text, active: true, createdAt: Date.now() })
  await ctx.db.patch(messageId, { directiveId })
  return storeReply(ctx, account, { text: reply }, directiveId)
}

/** "a research brief", "an analytics summary". */
function withArticle(noun: string): string {
  return `${/^[aeiou]/i.test(noun) ? 'an' : 'a'} ${noun}`
}

/** The task goes to the queue of the role that owns its data; its answer comes back as a message of its own. */
async function askForTask(
  ctx: MutationCtx,
  account: Doc<'accounts'>,
  messageId: Id<'messages'>,
  intent: Extract<ChatIntent, { kind: 'task' }>
): Promise<ChatOutcome> {
  const topic = (intent.topic ?? '').trim()
  const jobId = await enqueueJob(ctx, {
    kind: intent.task,
    accountId: account._id,
    messageId,
    topic: topic === '' ? undefined : topic,
  })
  const role = AGENT_ROLE_LABELS[JOB_KINDS[intent.task].role].toLowerCase()
  const task = withArticle(JOB_KIND_LABELS[intent.task].toLowerCase())
  const on = topic === '' ? '' : ` on ${topic}`
  return { text: `Asked the ${role} for ${task}${on}. It lands here when it is done.`, jobId }
}

/**
 * A chat task that failed still answers in the chat, linked to its job, so
 * the operator who asked is never left waiting. Dispatch calls this when the
 * task's action throws; the action itself posts nothing on failure.
 */
export async function reportChatTaskFailure(ctx: MutationCtx, job: Doc<'jobs'>, error: string): Promise<void> {
  if (!isChatTask(job.kind)) throw new Error(`job ${job._id} is ${job.kind}, not a chat task`)
  const role = AGENT_ROLE_LABELS[job.role].toLowerCase()
  await ctx.db.insert('messages', {
    accountId: job.accountId,
    author: 'account',
    text: `The ${role} could not finish the ${JOB_KIND_LABELS[job.kind].toLowerCase()}: ${error}`,
    jobId: job._id,
    createdAt: Date.now(),
  })
}
