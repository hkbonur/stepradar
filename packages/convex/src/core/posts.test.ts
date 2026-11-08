import { describe, expect, it } from 'vitest'
import { api } from '../_generated/api'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'
import { POST_HOUR, insertPost, insertJob, insertAccount, TIMEZONE } from '../../test/fixtures'
import { setup } from '../../test/setup'
import { addDays, dayKey, instantAt } from './dates'
import { DAY_PASSED, KILLED_BEFORE_RUN, createIdea, killPost, queueDuePosts, queueWriteIfDue, reschedulePost } from './posts'

describe('killPost', () => {
  it('fails the jobs still queued and leaves the running and finished ones as they are', async () => {
    const t = setup()
    const today = dayKey(Date.now(), TIMEZONE)
    const { post, rows } = await t.run(async (ctx) => {
      const account = await insertAccount(ctx)
      const post = await insertPost(ctx, account, { status: 'idea', plannedFor: today })
      const rows = {
        queuedJob: await insertJob(ctx, post, { kind: 'write_post', status: 'queued' }),
        runningJob: await insertJob(ctx, post, { kind: 'write_post', status: 'running' }),
        doneJob: await insertJob(ctx, post, { kind: 'write_post', status: 'done' }),
      }
      return { post, rows }
    })

    await t.run((ctx) => killPost(ctx, post._id))

    const after = await t.run(async (ctx) => ({
      post: await ctx.db.get(post._id),
      queuedJob: await ctx.db.get(rows.queuedJob._id),
      runningJob: await ctx.db.get(rows.runningJob._id),
      doneJob: await ctx.db.get(rows.doneJob._id),
    }))
    expect(after.post?.status).toBe('killed')
    expect(after.queuedJob).toMatchObject({ status: 'failed', error: KILLED_BEFORE_RUN })
    expect(after.runningJob?.status).toBe('running')
    expect(after.doneJob?.status).toBe('done')
  })

  it('refuses a post the operator already posted', async () => {
    const t = setup()
    const post = await t.run(async (ctx) =>
      insertPost(ctx, await insertAccount(ctx), { status: 'posted', plannedFor: dayKey(Date.now(), TIMEZONE) })
    )
    await expect(t.run((ctx) => killPost(ctx, post._id))).rejects.toThrow('A post at "Posted" cannot be killed.')
  })
})

describe('a killed post afterwards', () => {
  it('refuses to retry the jobs the kill failed, so the writer never works for nothing', async () => {
    const t = setup()
    const write = await t.run(async (ctx) => {
      const post = await insertPost(ctx, await insertAccount(ctx), {
        status: 'killed',
        plannedFor: dayKey(Date.now(), TIMEZONE),
        concept: 'Retry a webhook',
      })
      return insertJob(ctx, post, { kind: 'write_post', status: 'failed' })
    })
    await expect(t.mutation(api.private.jobs.retry, { jobId: write._id })).rejects.toThrow(
      '"Retry a webhook" was killed; its jobs do not run again.'
    )
    const queued = await t.run(async (ctx) => (await ctx.db.query('jobs').collect()).filter((job) => job.status === 'queued'))
    expect(queued).toEqual([])
  })
})

describe('reschedulePost', () => {
  it('refuses a post past changing, saying it cannot be moved', async () => {
    const t = setup()
    const today = dayKey(Date.now(), TIMEZONE)
    const post = await t.run(async (ctx) => insertPost(ctx, await insertAccount(ctx), { status: 'measured', plannedFor: today }))
    await expect(t.run((ctx) => reschedulePost(ctx, post._id, addDays(today, 1)))).rejects.toThrow('A post at "Measured" cannot be moved.')
  })

  it("moves a draft to the new day at its slot's hour", async () => {
    const t = setup()
    const today = dayKey(Date.now(), TIMEZONE)
    const to = addDays(today, 2)
    const post = await t.run(async (ctx) => insertPost(ctx, await insertAccount(ctx), { status: 'draft', plannedFor: addDays(today, 1) }))
    await t.run((ctx) => reschedulePost(ctx, post._id, to))
    const after = await t.run((ctx) => ctx.db.get(post._id))
    expect(after?.plannedFor).toBe(to)
    expect(after?.scheduledAt).toBe(instantAt(to, POST_HOUR, TIMEZONE))
  })
})

/** The write_post jobs of a post, any status. */
async function writeJobsOf(ctx: MutationCtx, postId: Id<'posts'>): Promise<Doc<'jobs'>[]> {
  const jobs = await ctx.db
    .query('jobs')
    .withIndex('by_post', (q) => q.eq('postId', postId))
    .collect()
  return jobs.filter((job) => job.kind === 'write_post')
}

function textIdea(plannedFor: string) {
  return {
    kind: 'text' as const,
    intent: 'teach' as const,
    length: 'medium' as const,
    publishHour: POST_HOUR,
    plannedFor,
    concept: `Idea for ${plannedFor}`,
    sponsorSegment: 'none' as const,
    signalIds: [],
  }
}

describe('queueWriteIfDue', () => {
  it('queues the write on the day before the post, once, and only for an idea', async () => {
    const t = setup()
    await t.run(async (ctx) => {
      const account = await insertAccount(ctx)
      // 08:15 in Oslo on Tuesday 13 October.
      const now = Date.UTC(2026, 9, 13, 6, 15)
      const tomorrow = await insertPost(ctx, account, { status: 'idea', plannedFor: '2026-10-14' })
      const later = await insertPost(ctx, account, { status: 'idea', plannedFor: '2026-10-15' })
      const drafted = await insertPost(ctx, account, { status: 'draft', plannedFor: '2026-10-14' })

      expect(await queueWriteIfDue(ctx, account, later, now)).toBe('waiting')
      expect(await queueWriteIfDue(ctx, account, drafted, now)).toBe('waiting')
      expect(await queueWriteIfDue(ctx, account, tomorrow, now)).toBe('queued')
      expect(await queueWriteIfDue(ctx, account, tomorrow, now)).toBe('already')
      expect(await writeJobsOf(ctx, tomorrow._id)).toMatchObject([{ status: 'queued', postId: tomorrow._id }])
      expect(await writeJobsOf(ctx, later._id)).toEqual([])
      expect(await writeJobsOf(ctx, drafted._id)).toEqual([])

      // A write that failed is no write in progress: the idea is queued again.
      const [first] = await writeJobsOf(ctx, tomorrow._id)
      if (!first) throw new Error('no write job')
      await ctx.db.patch(first._id, { status: 'failed' })
      expect(await queueWriteIfDue(ctx, account, tomorrow, now)).toBe('queued')

      // Today in the account's timezone, not in UTC: 23:30 UTC on the 13th is already the 14th in Oslo.
      expect(await queueWriteIfDue(ctx, account, later, Date.UTC(2026, 9, 13, 23, 30))).toBe('queued')
    })
  })

  it('writes an idea for today or tomorrow at once and leaves a later one waiting as an idea', async () => {
    const t = setup()
    await t.run(async (ctx) => {
      const account = await insertAccount(ctx)
      const today = dayKey(Date.now(), TIMEZONE)
      const ids = []
      for (const offset of [0, 1, 2, 7]) ids.push(await createIdea(ctx, account, textIdea(addDays(today, offset))))
      const counts = []
      for (const id of ids) counts.push((await writeJobsOf(ctx, id)).length)
      expect(counts).toEqual([1, 1, 0, 0])
      for (const id of ids) expect((await ctx.db.get(id))?.status).toBe('idea')
    })
  })

  it('queues an idea moved to tomorrow, and keeps the words of a draft moved later', async () => {
    const t = setup()
    await t.run(async (ctx) => {
      const account = await insertAccount(ctx)
      const today = dayKey(Date.now(), TIMEZONE)
      const idea = await insertPost(ctx, account, { status: 'idea', plannedFor: addDays(today, 5) })
      const drafted = await insertPost(ctx, account, { status: 'draft', plannedFor: addDays(today, 1) })
      await reschedulePost(ctx, idea._id, addDays(today, 1))
      await reschedulePost(ctx, drafted._id, addDays(today, 4))
      expect(await writeJobsOf(ctx, idea._id)).toHaveLength(1)
      expect(await writeJobsOf(ctx, drafted._id)).toEqual([])
      expect((await ctx.db.get(drafted._id))?.status).toBe('draft')
    })
  })
})

describe('queueDuePosts', () => {
  it("skips an idea whose day passed, queues tomorrow's and today's, and leaves the rest alone", async () => {
    const t = setup()
    await t.run(async (ctx) => {
      const account = await insertAccount(ctx)
      const now = Date.UTC(2026, 9, 13, 5, 30)
      const passed = await insertPost(ctx, account, { status: 'idea', plannedFor: '2026-10-12' })
      const today = await insertPost(ctx, account, { status: 'idea', plannedFor: '2026-10-13' })
      const tomorrow = await insertPost(ctx, account, { status: 'idea', plannedFor: '2026-10-14', kind: 'thread' })
      const inProgress = await insertPost(ctx, account, { status: 'idea', plannedFor: '2026-10-14' })
      await insertJob(ctx, inProgress, { kind: 'write_post', status: 'running' })
      const waiting = await insertPost(ctx, account, { status: 'idea', plannedFor: '2026-10-16' })
      const drafted = await insertPost(ctx, account, { status: 'draft', plannedFor: '2026-10-12' })

      expect(await queueDuePosts(ctx, account, now)).toEqual({ queued: 2, skipped: 1 })
      expect(await ctx.db.get(passed._id)).toMatchObject({ status: 'skipped', skipReason: DAY_PASSED })
      expect(await writeJobsOf(ctx, passed._id)).toEqual([])
      expect(await writeJobsOf(ctx, today._id)).toHaveLength(1)
      expect(await writeJobsOf(ctx, tomorrow._id)).toHaveLength(1)
      expect(await writeJobsOf(ctx, inProgress._id)).toHaveLength(1)
      expect(await writeJobsOf(ctx, waiting._id)).toEqual([])
      // A draft whose day passed waits for the operator: they may still post it.
      expect((await ctx.db.get(drafted._id))?.status).toBe('draft')

      // The pass runs again: nothing is queued twice.
      expect(await queueDuePosts(ctx, account, now)).toEqual({ queued: 0, skipped: 0 })
    })
  })
})
