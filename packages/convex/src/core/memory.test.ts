import { describe, expect, it } from 'vitest'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'
import { insertAccount, insertSignal } from '../../test/fixtures'
import { setup } from '../../test/setup'
import { rememberFromOperator, retireMemory, writerMemory } from './memory'
import { logRepeatedQuestions } from './research'

const HOUR = 3_600_000
const NOW = Date.UTC(2026, 9, 13, 6, 15)

async function insertEntry(
  ctx: MutationCtx,
  account: Doc<'accounts'>,
  fields: Pick<Doc<'memories'>, 'kind' | 'text' | 'createdAt'> & { status?: Doc<'memories'>['status'] }
): Promise<Id<'memories'>> {
  return ctx.db.insert('memories', {
    accountId: account._id,
    actor: fields.kind === 'fact' || fields.kind === 'rule' ? 'operator' : 'analyst',
    evidence: { postIds: [], signalIds: [] },
    status: 'active',
    ...fields,
  })
}

describe('rememberFromOperator', () => {
  it('stores a fact as a sentence with the chat message as its evidence, and never the same words twice as either kind', async () => {
    const t = setup()
    await t.run(async (ctx) => {
      const account = await insertAccount(ctx)
      const messageId = await ctx.db.insert('messages', {
        accountId: account._id,
        author: 'operator',
        text: 'Remember that viewers like dark mode',
        createdAt: NOW,
      })

      const stored = await rememberFromOperator(ctx, account, { kind: 'fact', text: 'viewers like dark mode', messageId, now: NOW })

      if (stored.status !== 'stored') throw new Error(`expected the fact stored, got ${stored.status}`)
      expect(await ctx.db.get(stored.memoryId)).toMatchObject({
        kind: 'fact',
        text: 'Viewers like dark mode.',
        actor: 'operator',
        evidence: { postIds: [], signalIds: [], messageId },
        status: 'active',
        createdAt: NOW,
      })
      expect(await rememberFromOperator(ctx, account, { kind: 'rule', text: 'Viewers like  dark mode', now: NOW })).toEqual({
        status: 'known',
        memoryId: stored.memoryId,
        text: 'Viewers like dark mode.',
      })
      expect(await rememberFromOperator(ctx, account, { kind: 'rule', text: '   ', now: NOW })).toEqual({
        status: 'invalid',
        problem: 'Say what to remember.',
      })
    })
  })
})

describe('retireMemory', () => {
  it('forgets what the operator told, and refuses what the agents keep and an entry already retired', async () => {
    const t = setup()
    await t.run(async (ctx) => {
      const account = await insertAccount(ctx)
      const ruleId = await insertEntry(ctx, account, { kind: 'rule', text: 'Never say "guys".', createdAt: NOW })
      const learningId = await insertEntry(ctx, account, { kind: 'learning', text: 'Questions hook better.', createdAt: NOW })

      await retireMemory(ctx, ruleId, NOW + HOUR)

      expect(await ctx.db.get(ruleId)).toMatchObject({ status: 'retired', retiredAt: NOW + HOUR })
      await expect(retireMemory(ctx, ruleId, NOW + HOUR)).rejects.toThrow('This entry is no longer active.')
      await expect(retireMemory(ctx, learningId, NOW + HOUR)).rejects.toThrow(
        "A learning is kept by the account's agents; it cannot be retired."
      )
    })
  })

  it('resolves a problem: its candidate is dismissed, and its comments never count toward the same problem again', async () => {
    const t = setup()
    await t.run(async (ctx) => {
      const account = await insertAccount(ctx)
      const asked = (title: string, hoursAgo: number) =>
        insertSignal(ctx, account, { title, source: 'comments', foundAt: NOW - hoursAgo * HOUR, publishedAt: NOW - hoursAgo * HOUR })
      await asked('Can you show how to retry a failed webhook step?', 50)
      await asked('How do I retry a failed webhook step in n8n?', 40)
      await asked('Is there a way to retry the failed webhook step?', 30)
      const [problemId] = await logRepeatedQuestions(ctx, account, NOW)
      if (problemId === undefined) throw new Error('no problem was logged')

      await retireMemory(ctx, problemId, NOW + HOUR)

      const candidate = await ctx.db
        .query('signals')
        .withIndex('by_account_external', (q) => q.eq('accountId', account._id).eq('source', 'problems').eq('externalId', problemId))
        .unique()
      expect(candidate?.status).toBe('dismissed')
      expect(await logRepeatedQuestions(ctx, account, NOW + 2 * HOUR)).toEqual([])

      // Asked three more times since: the question is open again, as a new problem.
      await asked('Can I retry a failed webhook step automatically?', 3)
      await asked('Retry a failed webhook step without rerunning everything?', 2)
      await asked('Does n8n retry a failed webhook step on its own?', 1)
      const [reopened] = await logRepeatedQuestions(ctx, account, NOW + 2 * HOUR)
      expect(reopened).toBeDefined()
      expect(reopened).not.toBe(problemId)
    })
  })
})

describe('writerMemory', () => {
  it('hands the writer the goal, the newest goal note, and the active rules, facts and learnings, newest first and at most ten', async () => {
    const t = setup()
    await t.run(async (ctx) => {
      const account = await insertAccount(ctx)
      await insertEntry(ctx, account, { kind: 'goal_note', text: 'An older note.', createdAt: NOW - 2 * HOUR, status: 'superseded' })
      await insertEntry(ctx, account, { kind: 'goal_note', text: 'The note in force.', createdAt: NOW - HOUR })
      await insertEntry(ctx, account, { kind: 'rule', text: 'Never say "guys".', createdAt: NOW - HOUR })
      await insertEntry(ctx, account, { kind: 'rule', text: 'Always show the URL bar.', createdAt: NOW })
      await insertEntry(ctx, account, { kind: 'rule', text: 'A forgotten rule.', createdAt: NOW, status: 'retired' })
      await insertEntry(ctx, account, { kind: 'fact', text: 'Viewers like dark mode.', createdAt: NOW })
      for (let index = 0; index < 12; index += 1) {
        await insertEntry(ctx, account, { kind: 'learning', text: `Learning ${index}.`, createdAt: NOW + index })
      }

      const memory = await writerMemory(ctx, account._id, 'Formstep')

      expect(memory).toEqual({
        goal: 'Paying Formstep customers',
        standing: 'The note in force.',
        rules: ['Always show the URL bar.', 'Never say "guys".'],
        facts: ['Viewers like dark mode.'],
        learnings: Array.from({ length: 10 }, (_, index) => `Learning ${11 - index}.`),
      })
    })
  })

  it('has no standing before the first review', async () => {
    const t = setup()
    await t.run(async (ctx) => {
      const account = await insertAccount(ctx)
      expect(await writerMemory(ctx, account._id, 'Formstep')).toEqual({
        goal: 'Paying Formstep customers',
        standing: null,
        rules: [],
        facts: [],
        learnings: [],
      })
    })
  })
})
