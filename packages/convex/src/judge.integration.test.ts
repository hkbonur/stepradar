import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, internal } from './_generated/api'
import { addDays, dayKey } from './core/dates'
import { mockLlm } from './providers/llm/mock'
import { TIMEZONE, insertAccount, insertPost } from '../test/fixtures'
import { setup } from '../test/setup'

afterEach(() => {
  vi.restoreAllMocks()
})

/** An idea due tomorrow on X, a full post that teaches. */
async function idea(t: ReturnType<typeof setup>) {
  return t.run(async (ctx) => {
    const account = await insertAccount(ctx)
    const post = await insertPost(ctx, account, { status: 'idea', plannedFor: addDays(dayKey(Date.now(), TIMEZONE), 1) })
    await ctx.db.patch(post._id, { intent: 'teach', length: 'medium' })
    return post._id
  })
}

describe('the judge', () => {
  it('sends a draft that gives readers no reason to comment back to the writer once, then says what is still missing', async () => {
    const t = setup()
    const postId = await idea(t)
    const write = vi.spyOn(mockLlm, 'writePost')
    write.mockResolvedValue({
      title: 'Retries',
      parts: ['Cap the retries at three and alert on the last one. It saved me twice this month, both times on a Monday morning.'],
    })
    await t.action(internal.internal.writer.writePost, { postId })
    await t.finishAllScheduledFunctions(() => {})
    // Written twice: the second time with the judge's reading of the first.
    expect(write).toHaveBeenCalledTimes(2)
    expect(write.mock.calls[1]?.[0].judged).toEqual({
      missing: ['comment', 'like'],
      fix: 'Give readers a reason to comment and like: end on a question they can answer from their own work.',
    })
    const post = await t.run((ctx) => ctx.db.get(postId))
    expect(post).toMatchObject({ status: 'draft', judgment: { round: 2, reasons: { comment: null }, mock: true } })
    expect(post?.judgment?.reasons.read).not.toBeNull()
  })

  it('lets a draft that gives readers reasons to engage wait for the operator as it is', async () => {
    const t = setup()
    const postId = await idea(t)
    const write = vi.spyOn(mockLlm, 'writePost').mockResolvedValue({
      title: 'Retries',
      parts: ['Cap the retries at 3 and alert on the last one. How many retries do you allow before you page someone at night?'],
    })
    await t.action(internal.internal.writer.writePost, { postId })
    await t.finishAllScheduledFunctions(() => {})
    expect(write).toHaveBeenCalledTimes(1)
    expect(await t.run((ctx) => ctx.db.get(postId))).toMatchObject({ status: 'draft', judgment: { round: 1, fix: '' } })
  })

  it("reads the operator's edit again and only says what it finds, and a judge that fails leaves the draft alone", async () => {
    const t = setup()
    const postId = await idea(t)
    vi.spyOn(mockLlm, 'writePost').mockResolvedValue({
      title: 'Retries',
      parts: ['Cap the retries at 3 and alert on the last one. Which limit do you use for a webhook that calls a slow API?'],
    })
    await t.action(internal.internal.writer.writePost, { postId })
    await t.finishAllScheduledFunctions(() => {})
    await t.mutation(api.private.posts.updatePost, {
      postId,
      title: 'Retries',
      parts: ['Cap the retries at three and alert on the last one, so a failing webhook never runs twice for one customer.'],
    })
    await t.finishAllScheduledFunctions(() => {})
    // Weak, but the operator's own words: nothing sends them back.
    expect(await t.run((ctx) => ctx.db.get(postId))).toMatchObject({
      status: 'draft',
      parts: ['Cap the retries at three and alert on the last one, so a failing webhook never runs twice for one customer.'],
      judgment: { round: 2, reasons: { comment: null } },
    })
    vi.spyOn(mockLlm, 'judgePost').mockRejectedValue(new Error('the model is down'))
    await t.mutation(api.private.posts.updatePost, {
      postId,
      title: 'Retries',
      parts: ['Cap the retries at three and alert on the last one. Which limit do you use for a webhook that calls a slow API?'],
    })
    await t.finishAllScheduledFunctions(() => {})
    expect(await t.run((ctx) => ctx.db.get(postId))).toMatchObject({ status: 'draft' })
  })

  it("never sends back the operator's edit of a draft the judge has not read yet", async () => {
    const t = setup()
    // A draft written before the judge, or whose reading was dropped or failed: it has no judgment.
    const postId = await t.run(async (ctx) => {
      const account = await insertAccount(ctx)
      const post = await insertPost(ctx, account, { status: 'draft', plannedFor: addDays(dayKey(Date.now(), TIMEZONE), 1) })
      await ctx.db.patch(post._id, { parts: ['Cap the retries at three.'] })
      return post._id
    })
    const write = vi.spyOn(mockLlm, 'writePost')
    await t.mutation(api.private.posts.updatePost, {
      postId,
      title: 'Retries',
      parts: ['Cap the retries at three and alert on the last one, so a failing webhook never runs twice for one customer.'],
    })
    await t.finishAllScheduledFunctions(() => {})
    expect(write).not.toHaveBeenCalled()
    expect(await t.run((ctx) => ctx.db.get(postId))).toMatchObject({
      status: 'draft',
      parts: ['Cap the retries at three and alert on the last one, so a failing webhook never runs twice for one customer.'],
      judgment: { round: 1, reasons: { comment: null } },
    })
  })
})
