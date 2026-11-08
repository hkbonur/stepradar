import {
  MEMORY_KINDS,
  MEMORY_KIND_LABELS,
  isRetirable,
  memorySentence,
  memoryTextProblem,
  sameMemoryText,
  workspaceGoal,
  type MemoryKind,
  type OperatorMemoryKind,
} from '@influstep/shared'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { refusal } from '../lib/errors'

/**
 * An account's memory (docs/plan.md, v0.2 item 10): what the writer reads of
 * it, what the operator adds and retires, and the one rule for an entry that
 * replaces an older one. Briefs and problems are written in core/research.ts,
 * learnings of decisions in core/experiments.ts, and the strategy review's
 * learnings and goal notes in core/strategy.ts.
 */

type Reader = { db: QueryCtx['db'] }

/** How many entries of one kind the writer reads, newest first, so its prompt stays short. */
const WRITER_ENTRIES_MAX = 10

/**
 * What the writer reads of the account's memory before every post and
 * reply, beside the research (core/research.ts `researchFor`: this morning's
 * brief and the open problems): the workspace's goal and where the account
 * stands against it (the goal note in force), the operator's rules and
 * facts, and the active learnings.
 */
export interface WriterMemory {
  goal: string
  /** The newest goal note, null before the first strategy review. */
  standing: string | null
  rules: string[]
  facts: string[]
  learnings: string[]
}

/** The account's active entries of one kind, newest first. */
export async function activeEntries(ctx: Reader, accountId: Id<'accounts'>, kind: MemoryKind): Promise<Doc<'memories'>[]> {
  const rows = await ctx.db
    .query('memories')
    .withIndex('by_account_kind_status', (q) => q.eq('accountId', accountId).eq('kind', kind).eq('status', 'active'))
    .collect()
  return rows.sort((a, b) => b.createdAt - a.createdAt)
}

export async function writerMemory(ctx: Reader, accountId: Id<'accounts'>, sponsorName: string): Promise<WriterMemory> {
  const texts = async (kind: MemoryKind) =>
    (await activeEntries(ctx, accountId, kind)).slice(0, WRITER_ENTRIES_MAX).map((entry) => entry.text)
  const [standing] = await activeEntries(ctx, accountId, 'goal_note')
  return {
    goal: workspaceGoal(sponsorName),
    standing: standing === undefined ? null : standing.text,
    rules: await texts('rule'),
    facts: await texts('fact'),
    learnings: await texts('learning'),
  }
}

/**
 * Supersedes the account's other active entries of `kind` that `replaces`
 * says the new entry stands in for. The rows stay, pointing at the new one.
 */
export async function supersedeOthers(
  ctx: MutationCtx,
  entry: { _id: Id<'memories'>; accountId: Id<'accounts'>; kind: MemoryKind },
  replaces: (older: Doc<'memories'>) => boolean
): Promise<void> {
  for (const older of await activeEntries(ctx, entry.accountId, entry.kind)) {
    if (older._id === entry._id || !replaces(older)) continue
    await ctx.db.patch(older._id, { status: 'superseded', supersededBy: entry._id })
  }
}

/** What remembering an operator's fact or rule did: stored it, found it already there, or could not take the text. */
export type Remembered =
  | { status: 'stored'; memoryId: Id<'memories'>; text: string }
  | { status: 'known'; memoryId: Id<'memories'>; text: string }
  | { status: 'invalid'; problem: string }

/**
 * Stores a fact or a rule the operator told the account, in the chat (with
 * the message as its evidence) or on the memory page. The same words already
 * active, as either kind, are not stored twice. Nothing throws: the chat
 * answers with the outcome and the page refuses with it.
 */
export async function rememberFromOperator(
  ctx: MutationCtx,
  account: Pick<Doc<'accounts'>, '_id'>,
  args: { kind: OperatorMemoryKind; text: string; messageId?: Id<'messages'>; now: number }
): Promise<Remembered> {
  const problem = memoryTextProblem(args.text)
  if (problem !== null) return { status: 'invalid', problem }
  const text = memorySentence(args.text)
  for (const kind of ['fact', 'rule'] as const) {
    const known = (await activeEntries(ctx, account._id, kind)).find((entry) => sameMemoryText(entry.text, text))
    if (known) return { status: 'known', memoryId: known._id, text: known.text }
  }
  const memoryId = await ctx.db.insert('memories', {
    accountId: account._id,
    kind: args.kind,
    text,
    actor: 'operator',
    evidence: { postIds: [], signalIds: [], ...(args.messageId === undefined ? {} : { messageId: args.messageId }) },
    status: 'active',
    createdAt: args.now,
  })
  return { status: 'stored', memoryId, text }
}

/**
 * The operator takes an entry back: forgets a fact or a rule, or marks a
 * problem resolved. The row stays, retired, and the writer no longer reads
 * it. A resolved problem's candidate signal is dismissed while no post
 * used it, so the planner stops offering it; the problem log does not log the
 * same comments again (core/research.ts).
 */
export async function retireMemory(ctx: MutationCtx, memoryId: Id<'memories'>, now: number): Promise<void> {
  const entry = await ctx.db.get(memoryId)
  if (!entry) throw new Error(`memory ${memoryId} not found`)
  if (!isRetirable(entry.kind))
    throw refusal(`A ${MEMORY_KIND_LABELS[entry.kind].toLowerCase()} is kept by the account's agents; it cannot be retired.`)
  if (entry.status !== 'active') throw refusal('This entry is no longer active.')
  await ctx.db.patch(entry._id, { status: 'retired', retiredAt: now })
  if (entry.kind !== 'problem') return
  const candidate = await ctx.db
    .query('signals')
    .withIndex('by_account_external', (q) => q.eq('accountId', entry.accountId).eq('source', 'problems').eq('externalId', entry._id))
    .first()
  if (candidate?.status === 'new') await ctx.db.patch(candidate._id, { status: 'dismissed' })
}

/**
 * What the memory page reads: the account's entries, newest first, with the
 * titles of the signals and the words of the chat messages their evidence
 * names, so an entry can say what it rests on. Of the briefs only the one in
 * force: one is written every morning and says nothing once the next is.
 */
export async function memoryView(
  ctx: Reader,
  account: Doc<'accounts'>
): Promise<{
  entries: Doc<'memories'>[]
  signals: Pick<Doc<'signals'>, '_id' | 'title'>[]
  messages: Pick<Doc<'messages'>, '_id' | 'text' | 'createdAt'>[]
}> {
  const entries: Doc<'memories'>[] = []
  for (const kind of MEMORY_KINDS) {
    const rows =
      kind === 'brief'
        ? await activeEntries(ctx, account._id, kind)
        : await ctx.db
            .query('memories')
            .withIndex('by_account_kind_status', (q) => q.eq('accountId', account._id).eq('kind', kind))
            .collect()
    entries.push(...rows)
  }
  entries.sort((a, b) => b.createdAt - a.createdAt)
  const signals: Pick<Doc<'signals'>, '_id' | 'title'>[] = []
  for (const signalId of new Set(entries.flatMap((entry) => entry.evidence.signalIds))) {
    const signal = await ctx.db.get(signalId)
    // A signal ages out after two weeks unless a post used it; the entry then names it no more.
    if (signal) signals.push({ _id: signal._id, title: signal.title })
  }
  const messages: Pick<Doc<'messages'>, '_id' | 'text' | 'createdAt'>[] = []
  for (const entry of entries) {
    if (entry.evidence.messageId === undefined) continue
    const message = await ctx.db.get(entry.evidence.messageId)
    if (message) messages.push({ _id: message._id, text: message.text, createdAt: message.createdAt })
  }
  return { entries, signals, messages }
}
