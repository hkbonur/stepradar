import { ConvexError, v } from 'convex/values'
import {
  ITEM_REACH_LABELS,
  POST_STATUS_LABELS,
  chatIntentSchema,
  isChatTask,
  signalFreshness,
  weekdayOf,
  type ChatIntent,
} from '@influstep/shared'
import { internal } from '../_generated/api'
import type { Doc, Id } from '../_generated/dataModel'
import { internalAction, internalMutation, internalQuery, type MutationCtx, type QueryCtx } from '../_generated/server'
import { applyChatIntent, changeablePlan } from '../core/chat'
import { reportFunnel } from '../core/report'
import { accountBriefOf } from '../core/accounts'
import { llmProvider, type ChatTurn, type AccountBrief, type PlanRow, type TaskReportArgs, type TaskSignal } from '../providers/llm'

/**
 * The account's chat: the account reads each message once and answers with
 * what it did, and a chat task is a report one agent writes and posts back in
 * the chat. A thrown error fails the job in dispatch.ts.
 */

// ---------------------------------------------------------------------------
// Account chat
// ---------------------------------------------------------------------------

/** How many earlier messages the account reads before it answers. */
const CHAT_HISTORY = 20

/**
 * Every operator message is read once (docs/plan.md, slice 7). The action
 * reads the chat and the changeable plan, asks the language model what the
 * message asks for, and for a directive or a conversation also writes the
 * account's reply, so the one mutation that follows only applies and stores:
 * a change and the words that report it land in the same transaction.
 * Nothing here throws at the operator. A message the model cannot read, or a
 * change that fails, still gets an account message that says so.
 */
export const handleMessage = internalAction({
  args: { messageId: v.id('messages') },
  handler: async (ctx, args): Promise<void> => {
    const chat: ChatReading = await ctx.runQuery(internal.internal.chat.chatReading, { messageId: args.messageId })
    const understood = await understand(chat)
    if (!understood.ok) {
      await ctx.runMutation(internal.internal.chat.storeReply, {
        accountId: chat.accountId,
        text: `I could not read that just now: ${understood.error}`,
      })
      return
    }
    try {
      await ctx.runMutation(internal.internal.chat.applyIntent, {
        messageId: args.messageId,
        intent: understood.intent,
        reply: understood.reply,
      })
    } catch (error) {
      // applyChatIntent turns every refusal into a reply, so this is a bug: the operator still hears about
      // it, nothing changed (the mutation rolled back), and the rethrow keeps it in the logs.
      await ctx.runMutation(internal.internal.chat.storeReply, {
        accountId: chat.accountId,
        text: `Something went wrong while I worked on that, so nothing changed: ${errorText(error)}`,
      })
      throw error
    }
  },
})

interface ChatReading {
  accountId: Id<'accounts'>
  account: AccountBrief
  /** The message to read. */
  text: string
  /** The chat before it, oldest first. */
  history: ChatTurn[]
  plan: PlanRow[]
}

/** The message, the chat before it, and the plan rows the interpreter may change (core `changeablePlan`). */
export const chatReading = internalQuery({
  args: { messageId: v.id('messages') },
  handler: async (ctx, args): Promise<ChatReading> => {
    const message = await ctx.db.get(args.messageId)
    if (!message) throw new Error(`message ${args.messageId} not found`)
    if (message.author !== 'operator') throw new Error(`message ${message._id} is the account's own; only operator messages are read`)
    const account = await ctx.db.get(message.accountId)
    if (!account) throw new Error(`account ${message.accountId} not found`)
    const earlier = await ctx.db
      .query('messages')
      .withIndex('by_account', (q) => q.eq('accountId', account._id).lt('_creationTime', message._creationTime))
      .order('desc')
      .take(CHAT_HISTORY)
    const plan = await changeablePlan(ctx, account._id)
    return {
      accountId: account._id,
      account: accountBriefOf(account),
      text: message.text,
      history: earlier.reverse().map((turn) => ({ author: turn.author, text: turn.text })),
      plan: plan.map((post) => ({
        id: post._id,
        weekday: weekdayOf(post.plannedFor),
        plannedFor: post.plannedFor,
        kind: post.kind,
        title: post.title,
        pillar: post.pillar ?? null,
        status: POST_STATUS_LABELS[post.status],
      })),
    }
  },
})

/** What the model made of a message: an intent, with the account's reply when the intent is a directive or a conversation. */
type Understood = { ok: true; intent: ChatIntent; reply: string | null } | { ok: false; error: string }

async function understand(chat: ChatReading): Promise<Understood> {
  const llm = llmProvider()
  try {
    const intent = validIntent(await llm.interpret(chat))
    if (intent.kind !== 'directive' && intent.kind !== 'conversation') return { ok: true, intent, reply: null }
    const reply = await llm.reply({
      account: chat.account,
      history: [...chat.history, { author: 'operator', text: chat.text }],
      directive: intent.kind === 'directive' ? directiveText(intent.text, chat.text) : undefined,
    })
    return { ok: true, intent, reply }
  } catch (error) {
    return { ok: false, error: errorText(error) }
  }
}

/** The words a directive is stored with, as core `applyDirective` picks them: the restatement, or the message when it is empty. */
function directiveText(restated: string, message: string): string {
  const text = restated.trim()
  return text === '' ? message : text
}

/** The interpreter's answer, held to the shared schema. One that does not fit changes nothing: it is conversation. */
function validIntent(answer: unknown): ChatIntent {
  const parsed = chatIntentSchema.safeParse(answer)
  if (parsed.success) return parsed.data
  console.warn(`The interpreter's answer did not fit the chat intent schema; it is read as conversation. ${parsed.error.message}`)
  return { kind: 'conversation' }
}

/**
 * Applies what the message asks for and stores the account's reply with the
 * post, job or directive it is about; core `applyChatIntent` does both. The
 * reply of a directive or a conversation was written in the action and comes
 * in as `reply`; every other kind is answered by the core and takes null.
 */
export const applyIntent = internalMutation({
  // The intent was checked against chatIntentSchema in the action and is parsed again here, at the boundary.
  args: { messageId: v.id('messages'), intent: v.any(), reply: v.union(v.string(), v.null()) },
  handler: async (ctx, args): Promise<void> => {
    const message = await ctx.db.get(args.messageId)
    if (!message) throw new Error(`message ${args.messageId} not found`)
    const account = await ctx.db.get(message.accountId)
    if (!account) throw new Error(`account ${message.accountId} not found`)
    const intent = chatIntentSchema.parse(args.intent)
    await applyChatIntent(ctx, account, message._id, intent, args.reply)
  },
})

/** An account message that belongs to no change and no task: the answer when a message could not be read or applied. */
export const storeReply = internalMutation({
  args: { accountId: v.id('accounts'), text: v.string() },
  handler: async (ctx, args): Promise<void> => {
    await insertAccountMessage(ctx, { accountId: args.accountId, text: args.text })
  },
})

async function insertAccountMessage(
  ctx: MutationCtx,
  args: { accountId: Id<'accounts'>; text: string; jobId?: Id<'jobs'> }
): Promise<Id<'messages'>> {
  return ctx.db.insert('messages', {
    accountId: args.accountId,
    author: 'account',
    text: args.text,
    jobId: args.jobId,
    createdAt: Date.now(),
  })
}

/** A refusal's own words, or the message of anything else; the chat shows it as it is, like the studio does. */
function errorText(error: unknown): string {
  if (error instanceof ConvexError && typeof error.data === 'string') return error.data
  return error instanceof Error ? error.message : String(error)
}

// ---------------------------------------------------------------------------
// Chat tasks: a report one agent writes and posts back in the account's chat
// ---------------------------------------------------------------------------

/** How many unused signals a research brief reads, freshest first. */
const RESEARCH_BRIEF_SIGNALS = 10
/** How far back a comment digest and an analytics summary look. */
const TASK_WINDOW_DAYS = 7
/** How many of the window's comments the writer of a digest reads, most liked first; the count covers them all. */
const COMMENT_DIGEST_COMMENTS = 30

/**
 * A chat task (shared CHAT_TASKS): gathers the task's data in code, has the
 * model put it in words, and posts the words in the account's chat with the
 * job; the message is the job's result. A task that fails posts nothing here
 * and throws: dispatch fails the job and posts why in the chat (core
 * `reportChatTaskFailure`), so the operator who asked is never left waiting
 * and hears it once.
 */
export const runTask = internalAction({
  args: { jobId: v.id('jobs') },
  handler: async (ctx, args): Promise<{ messageId: Id<'messages'> }> => {
    const report: TaskReportArgs = await ctx.runQuery(internal.internal.chat.taskReading, { jobId: args.jobId })
    const text = await llmProvider().taskReport(report)
    const messageId: Id<'messages'> = await ctx.runMutation(internal.internal.chat.storeTaskMessage, { jobId: args.jobId, text })
    return { messageId }
  },
})

/** The account, the topic and the data of a chat task job, as the report's writer reads them. */
export const taskReading = internalQuery({
  args: { jobId: v.id('jobs') },
  handler: async (ctx, args): Promise<TaskReportArgs> => {
    const job = await ctx.db.get(args.jobId)
    if (!job) throw new Error(`job ${args.jobId} not found`)
    if (!isChatTask(job.kind)) throw new Error(`job ${job._id} is a ${job.kind} job, not a chat task`)
    const account = await ctx.db.get(job.accountId)
    if (!account) throw new Error(`account ${job.accountId} not found`)
    const topic = job.topic ?? null
    const brief = accountBriefOf(account)
    const now = Date.now()
    if (job.kind === 'research_brief') {
      return { account: brief, task: job.kind, topic, data: { signals: await unusedSignals(ctx, account._id, topic, now) } }
    }
    if (job.kind === 'comment_digest') {
      const comments = await commentsSince(ctx, account._id, now - TASK_WINDOW_DAYS * 86_400_000)
      return {
        account: brief,
        task: job.kind,
        topic,
        data: { days: TASK_WINDOW_DAYS, total: comments.length, comments: comments.slice(0, COMMENT_DIGEST_COMMENTS).map(taskSignalOf) },
      }
    }
    // The report's own funnel over the window (core `reportFunnel`), so the chat and the page never disagree about a week.
    const window = await reportFunnel(ctx, account, TASK_WINDOW_DAYS, now)
    const data = { days: window.days, funnel: window.funnel, reachLabel: ITEM_REACH_LABELS[account.platform], currency: window.currency }
    return { account: brief, task: job.kind, topic, data }
  },
})

/** The chat task's report in the account's chat, with the job it answers. */
export const storeTaskMessage = internalMutation({
  args: { jobId: v.id('jobs'), text: v.string() },
  handler: async (ctx, args): Promise<Id<'messages'>> => {
    const job = await ctx.db.get(args.jobId)
    if (!job) throw new Error(`job ${args.jobId} not found`)
    return insertAccountMessage(ctx, { accountId: job.accountId, text: args.text, jobId: job._id })
  },
})

/**
 * The account's freshest signals nobody used yet (shared `signalFreshness`),
 * those that mention the topic when there is one. A cold signal still counts
 * here, last: the operator asked what there is, and an old story is still an
 * answer.
 */
async function unusedSignals(ctx: QueryCtx, accountId: Id<'accounts'>, topic: string | null, now: number): Promise<TaskSignal[]> {
  const signals = await ctx.db
    .query('signals')
    .withIndex('by_account_status', (q) => q.eq('accountId', accountId).eq('status', 'new'))
    // Newest first, so two signals of the same freshness rank the newer one first.
    .order('desc')
    .collect()
  const terms = topic === null ? null : topicTerms(topic)
  return signals
    .filter((signal) => terms === null || mentionsAny(signal, terms))
    .map((signal) => ({ signal, freshness: signalFreshness(signal, now) }))
    .sort((a, b) => b.freshness - a.freshness)
    .slice(0, RESEARCH_BRIEF_SIGNALS)
    .map((ranked) => taskSignalOf(ranked.signal))
}

/** Where a topic names more than one subject: "Make vs n8n", "Zapier, Make and n8n". */
const TOPIC_CONNECTOR = /\s*,\s*|\s+(?:vs\.?|versus|and|or)\s+/i
/** An article opening a subject says nothing about it: "the n8n error trigger" is about "n8n error trigger". */
const LEADING_ARTICLE = /^(?:the|a|an)\s+/i

/**
 * The subjects of a topic; a signal has to mention one of them whole. A
 * comparison such as "Make vs n8n" is about either side, so the topic splits
 * at its connectors, but never at a plain space: a single word of a phrase
 * ("the", "sign" of "sign-off") is part of too many titles to filter by. A
 * topic of commas alone names no subject, so no signal mentions it.
 */
function topicTerms(topic: string): string[] {
  return topic
    .toLowerCase()
    .split(TOPIC_CONNECTOR)
    .map((subject) => subject.trim().replace(LEADING_ARTICLE, ''))
    .filter((subject) => subject !== '')
}

function mentionsAny(signal: Doc<'signals'>, terms: string[]): boolean {
  const texts = [signal.title, ...signal.topics].map((text) => text.toLowerCase())
  return terms.some((term) => texts.some((text) => text.includes(term)))
}

/** Every comment the comment poll read under the account's posts since `since`, most liked first. */
async function commentsSince(ctx: QueryCtx, accountId: Id<'accounts'>, since: number): Promise<Doc<'signals'>[]> {
  const comments = await ctx.db
    .query('signals')
    .withIndex('by_account_external', (q) => q.eq('accountId', accountId).eq('source', 'comments'))
    .collect()
  return comments.filter((comment) => comment.foundAt >= since).sort((a, b) => b.score - a.score)
}

function taskSignalOf(signal: Doc<'signals'>): TaskSignal {
  return { source: signal.source, title: signal.title, summary: signal.summary, url: signal.url, topics: signal.topics }
}
