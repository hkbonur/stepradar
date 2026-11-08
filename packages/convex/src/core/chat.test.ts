import { describe, expect, it } from 'vitest'
import { insertPost, insertAccount, TIMEZONE } from '../../test/fixtures'
import { setup } from '../../test/setup'
import { applyChatIntent, changeablePlan } from './chat'
import { addDays, dayKey, weekStart } from './dates'

describe('changeablePlan', () => {
  it('holds what a chat change may touch, from today to the end of next week, by the time each is due', async () => {
    const t = setup()
    const today = dayKey(Date.now(), TIMEZONE)
    const lastDay = addDays(weekStart(today), 13)
    const { account, expected } = await t.run(async (ctx) => {
      const account = await insertAccount(ctx)
      const at = (status: Parameters<typeof insertPost>[2]['status'], plannedFor: string, concept: string) =>
        insertPost(ctx, account, { status, plannedFor, concept })

      // In: every changeable status, today and the last day of next week included.
      const lastIdea = await at('idea', lastDay, 'last day idea')
      const todayIdea = await at('idea', today, 'today idea')
      const draft = await at('draft', today, 'draft')
      const failed = await at('failed', today, 'failed')

      // Out: posted, over, past, or beyond next week.
      await at('posted', today, 'posted')
      await at('killed', today, 'killed')
      await at('skipped', today, 'skipped')
      await at('measured', today, 'measured')
      await at('idea', addDays(today, -1), 'yesterday')
      await at('idea', addDays(weekStart(today), -3), 'last week')
      await at('idea', addDays(lastDay, 1), 'beyond next week')

      const expected = [todayIdea, draft, failed, lastIdea].map((post) => post.concept)
      return { account, expected }
    })

    const plan = await t.run((ctx) => changeablePlan(ctx, account._id))

    // Today's rows share a due time; insertion order breaks the tie through the index.
    expect(plan.map((post) => post.concept)).toEqual(expected)
  })
})

describe('applyChatIntent', () => {
  it('needs the provider reply for a directive or a conversation, and treats its absence as a bug', async () => {
    const t = setup()
    const { account, messageId } = await t.run(async (ctx) => {
      const account = await insertAccount(ctx)
      const messageId = await ctx.db.insert('messages', { accountId: account._id, author: 'operator', text: 'hi', createdAt: Date.now() })
      return { account, messageId }
    })
    await expect(t.run((ctx) => applyChatIntent(ctx, account, messageId, { kind: 'conversation' }, null))).rejects.toThrow(
      "a conversation message is answered with the provider's reply, and none was given"
    )
  })

  it('asks which one when a target matches several posts, and changes nothing', async () => {
    const t = setup()
    const today = dayKey(Date.now(), TIMEZONE)
    const { account, messageId } = await t.run(async (ctx) => {
      const account = await insertAccount(ctx)
      await insertPost(ctx, account, { status: 'idea', plannedFor: today, concept: 'n8n retries' })
      await insertPost(ctx, account, { status: 'idea', plannedFor: today, concept: 'n8n webhooks' })
      const messageId = await ctx.db.insert('messages', {
        accountId: account._id,
        author: 'operator',
        text: 'drop the n8n one',
        createdAt: Date.now(),
      })
      return { account, messageId }
    })

    const outcome = await t.run((ctx) => applyChatIntent(ctx, account, messageId, { kind: 'drop', target: { keyword: 'n8n' } }, null))

    expect(outcome.text).toMatch(/^That matches 2 posts: .+n8n retries; .+n8n webhooks\. Which one\?$/)
    const statuses = await t.run(async (ctx) => (await ctx.db.query('posts').collect()).map((post) => post.status))
    expect(statuses).toEqual(['idea', 'idea'])
  })
})
