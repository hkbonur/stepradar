import {
  POST_INTENTS,
  postHook,
  postProblems,
  postSlotHours,
  type PlatformFormat,
  type PostKind,
  type SelfPromotion,
} from '@influstep/shared'
import { describe, expect, it } from 'vitest'
import { api, internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { addDays, dayKey, instantAt, weekStart } from './core/dates'
import { writePostsDueBefore } from '../test/writes'
import { insertAccount, insertPost } from '../test/fixtures'
import { setup } from '../test/setup'

const TIMEZONE = 'Europe/Oslo'
const KINDS: PostKind[] = ['text', 'thread']

// Two posts a day from 22:00 run past midnight, so the slots move back to 20:00 and 23:00.
const X_FORMAT: PlatformFormat = {
  platform: 'x',
  publishHour: 22,
  cadence: { postsPerDay: 2, kinds: KINDS, intents: [...POST_INTENTS], repliesPerDay: 5 },
}

type Test = ReturnType<typeof setup>

/** A workspace and one account on X, inserted directly so the test owns every row it reads. */
async function xAccount(t: Test): Promise<Id<'accounts'>> {
  return t.run(async (ctx) => {
    const workspaceId = await ctx.db.insert('workspaces', {
      name: 'Test',
      sponsorName: 'Formstep',
      sponsorUrl: 'https://formstep.io',
      sponsorPitch: 'Forms that workflows and AI agents send to one customer; the answers come back into the flow.',
      appUrl: 'http://localhost:3300',
      valuePerPaid: 29,
      currency: 'EUR',
    })
    return ctx.db.insert('accounts', {
      workspaceId,
      name: 'Xena Posts',
      handle: 'xena.posts',
      niche: 'automation for small teams',
      tone: 'plain',
      bio: 'One automation a day.',
      bible: 'Xena says the point first and never says "guys".',
      affiliationLine: "I'm building Formstep, so take this with salt.",
      pillars: ['n8n tutorials', 'AI agent workflows'],
      ...X_FORMAT,
      sponsorDial: 0.5,
      sponsorRampPosts: 0,
      paused: false,
      timezone: TIMEZONE,
      createdAt: Date.now(),
    })
  })
}

async function postsOf(t: Test, accountId: Id<'accounts'>) {
  return t.run((ctx) =>
    ctx.db
      .query('posts')
      .withIndex('by_account', (q) => q.eq('accountId', accountId))
      .collect()
  )
}

describe('posts on X', () => {
  it('plans post slots by the cadence and drafts every post inside X limits', async () => {
    const t = setup()
    const accountId = await xAccount(t)
    await t.run(async (ctx) => {
      for (const [index, title] of ['n8n webhooks that retry', 'Agents that ask for approval'].entries()) {
        await ctx.db.insert('signals', {
          accountId,
          source: 'hackernews',
          externalId: `hn-${index}`,
          title,
          url: `https://news.ycombinator.com/item?id=${index}`,
          summary: 'People ask how.',
          score: 100 - index,
          topics: ['n8n'],
          status: 'new',
          foundAt: Date.now(),
          mock: true,
        })
      }
    })

    // Next week, so no slot is in the past.
    const nextMonday = addDays(weekStart(dayKey(Date.now(), TIMEZONE)), 7)
    const first = await t.mutation(internal.internal.writer.planWeek, { accountId, weekStart: nextMonday })
    expect(first).toEqual({ planned: 7 * 2 })
    const posts = (await postsOf(t, accountId)).sort((a, b) => a.scheduledAt - b.scheduledAt)

    // Every day at the cadence's hours. The kind follows the planned length (voice.integration.test.ts pinned the mix):
    // a thread exactly when the post is long, and every kind one the cadence has.
    const hours = postSlotHours(X_FORMAT)
    const week = Array.from({ length: 7 }, (_, offset) => addDays(nextMonday, offset))
    expect(posts.map((post) => [post.plannedFor, post.scheduledAt])).toEqual(
      week.flatMap((day) => hours.map((hour) => [day, instantAt(day, hour, TIMEZONE)]))
    )
    for (const post of posts) {
      expect(KINDS).toContain(post.kind)
      expect(post.kind === 'thread').toBe(post.length === 'long')
    }
    expect(posts.every((post) => post.status === 'idea')).toBe(true)

    // The dial sponsors some posts, as a mention.
    expect(posts.some((post) => post.sponsorSegment === 'mention')).toBe(true)

    // Both signals feed a post; no signal feeds two.
    const fed = posts.flatMap((post) => post.signalIds)
    expect(fed.length).toBe(2)
    expect(new Set(fed).size).toBe(2)

    // A second plan of the same week finds every slot taken.
    const second = await t.mutation(internal.internal.writer.planWeek, { accountId, weekStart: nextMonday })
    expect(second).toEqual({ planned: 0 })

    // Nothing is written at plan time: each day's posts are written the morning before it, one pass a morning.
    await t.finishAllScheduledFunctions(() => {})
    expect((await postsOf(t, accountId)).every((post) => post.status === 'idea')).toBe(true)
    for (const day of week) {
      const pass = await writePostsDueBefore(t, accountId, day)
      expect(pass.skipped).toBe(0)
    }

    // The writer: every post is a draft with parts that pass X's rules as they stand, since the operator posts them.
    const written = await postsOf(t, accountId)
    expect(written.length).toBe(14)
    for (const post of written) {
      expect(post.status).toBe('draft')
      if (!post.parts) throw new Error(`post ${post._id} was not written`)
      expect(postProblems({ platform: 'x', kind: post.kind, community: null }, { title: post.title, parts: post.parts })).toEqual([])
      expect(post.hook).toBe(postHook(post.parts))
      expect(post.hook.length).toBeGreaterThan(0)
    }
    expect(written.find((post) => post.kind === 'thread')?.parts?.length).toBeGreaterThan(1)
  })

  it('plans nothing for a paused account', async () => {
    const t = setup()
    const accountId = await xAccount(t)
    await t.run((ctx) => ctx.db.patch(accountId, { paused: true }))
    const nextMonday = addDays(weekStart(dayKey(Date.now(), TIMEZONE)), 7)
    expect(await t.mutation(internal.internal.writer.planWeek, { accountId, weekStart: nextMonday })).toEqual({ planned: 0 })
  })
})

describe('posts on Reddit', () => {
  it('names the sponsor only in a subreddit whose rules still allow it when the post is written', async () => {
    const t = setup()
    const account = await t.run((ctx) => insertAccount(ctx, { platform: 'reddit', handle: 'ada' }))
    const tomorrow = addDays(dayKey(Date.now(), TIMEZONE), 1)
    // Both were planned with the sponsor; since then, r/n8n's rules were read again and forbid it.
    const planned = async (community: string, selfPromotion: SelfPromotion) =>
      t.run(async (ctx) => {
        await ctx.db.insert('communities', {
          accountId: account._id,
          name: community,
          rulesText: 'Be kind.',
          selfPromotion,
          reason: 'the rules say so',
          weight: 1,
          rulesReadAt: Date.now(),
        })
        const post = await insertPost(ctx, account, { status: 'idea', plannedFor: tomorrow })
        await ctx.db.patch(post._id, { community, intent: 'share', length: 'medium', sponsorSegment: 'mention' })
        return post._id
      })
    const forbidden = await planned('n8n', 'forbidden')
    const allowed = await planned('zapier', 'allowed')
    for (const postId of [forbidden, allowed]) await t.action(internal.internal.writer.writePost, { postId })

    const textOf = async (postId: Id<'posts'>) => {
      const post = await t.run((ctx) => ctx.db.get(postId))
      return [post?.title, ...(post?.parts ?? [])].join('\n')
    }
    expect(await textOf(forbidden)).not.toContain('Formstep')
    expect(await textOf(allowed)).toContain(account.affiliationLine)
    // Reddit distrusts redirects: the sponsored post links to the sponsor itself, with the UTM parameters in the link.
    const [plain, sponsored] = await Promise.all([forbidden, allowed].map((postId) => t.run((ctx) => ctx.db.get(postId))))
    expect(plain?.sponsorLink).toBeUndefined()
    const link = new URL(sponsored?.sponsorLink ?? '')
    expect([
      link.origin,
      link.searchParams.get('utm_source'),
      link.searchParams.get('utm_medium'),
      link.searchParams.get('utm_campaign'),
    ]).toEqual(['https://formstep.io', 'ada', 'reddit', sponsored?.slug])
    expect(await textOf(allowed)).toContain(link.toString())
    expect(await t.run((ctx) => ctx.db.query('links').collect())).toEqual([])
  })

  it('gives a sponsored post on X one tracked link, which counts the click and redirects with its variant', async () => {
    const t = setup()
    const account = await t.run((ctx) => insertAccount(ctx))
    const postId = await t.run(async (ctx) => {
      const post = await insertPost(ctx, account, { status: 'idea', plannedFor: addDays(dayKey(Date.now(), TIMEZONE), 1) })
      const experimentId = await ctx.db.insert('experiments', {
        accountId: account._id,
        name: 'Hook: Question vs Plain statement',
        hypothesis: 'A question opens more clicks.',
        kind: 'hook',
        metric: 'clicks',
        variants: [
          { key: 'statement', label: 'Plain statement', description: 'Open on what the post gives.', isControl: true },
          { key: 'question', label: 'Question', description: 'Open on a question.', isControl: false },
        ],
        minItems: 15,
        minConfidence: 0.9,
        status: 'running',
        createdAt: Date.now(),
      })
      await ctx.db.patch(post._id, { intent: 'share', length: 'medium', sponsorSegment: 'mention', experimentId, variantKey: 'question' })
      return post._id
    })
    await t.action(internal.internal.writer.writePost, { postId })
    // A rewrite keeps the link, and the clicks it counted.
    await t.run((ctx) => ctx.db.patch(postId, { status: 'idea' }))
    await t.action(internal.internal.writer.writePost, { postId })

    const post = await t.run((ctx) => ctx.db.get(postId))
    const links = await t.run((ctx) => ctx.db.query('links').collect())
    expect(links).toMatchObject([{ kind: 'post', postId, target: 'https://formstep.io' }])
    const [link] = links
    if (!link) throw new Error('the writer made no tracked link')
    expect(post?.sponsorLink).toBe(`http://localhost:3300/go/${link.slug}`)
    expect(post?.parts?.join('\n')).toContain(post?.sponsorLink)

    const clicked = await t.mutation(api.public.links.click, { slug: link.slug })
    const target = new URL(clicked?.target ?? '')
    expect([
      target.searchParams.get('utm_source'),
      target.searchParams.get('utm_campaign'),
      target.searchParams.get('utm_content'),
    ]).toEqual([account.handle, post?.slug, 'question'])
    expect(await t.run((ctx) => ctx.db.query('linkClicks').collect())).toHaveLength(1)
  })
})
