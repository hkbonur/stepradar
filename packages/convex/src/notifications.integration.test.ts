import webpush from 'web-push'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, internal } from './_generated/api'
import type { Doc } from './_generated/dataModel'
import { instantAt } from './core/dates'
import { queueNotification } from './core/notifications'
import { mockComments } from './providers/platforms/mock/items'
import { TIMEZONE, insertAccount, insertPost, insertPostedReply } from '../test/fixtures'
import { setup } from '../test/setup'

vi.mock('./providers/platforms/mock/items', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./providers/platforms/mock/items')>()
  return { ...actual, mockComments: vi.fn(actual.mockComments) }
})

// The push service, by endpoint: a device it no longer knows answers 410, as a real one does.
vi.mock('web-push', () => {
  class WebPushError extends Error {
    constructor(
      message: string,
      readonly statusCode: number
    ) {
      super(message)
    }
  }
  const sendNotification = vi.fn(async (subscription: { endpoint: string }) => {
    if (subscription.endpoint.endsWith('/gone')) throw new WebPushError('Received unexpected response code', 410)
    if (subscription.endpoint.endsWith('/broken')) throw new WebPushError('Received unexpected response code', 500)
    return { statusCode: 201 }
  })
  return { default: { sendNotification, WebPushError } }
})

type Test = ReturnType<typeof setup>

const HOUR = 3_600_000
const NOW = instantAt('2026-10-14', 12, TIMEZONE)

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'], shouldAdvanceTime: true })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.mocked(mockComments).mockReset()
  vi.mocked(webpush.sendNotification).mockClear()
})

async function withComments(t: Test, ages: number[]): Promise<Doc<'accounts'>> {
  const account = await t.run((ctx) => insertAccount(ctx))
  const replyId = await t.run((ctx) => insertPostedReply(ctx, account, { heardAt: NOW - HOUR, impressions: 0, follows: 0 }))
  const posted = (await t.run((ctx) => ctx.db.get(replyId)))?.posted
  if (posted?.kind !== 'linked') throw new Error('the posted reply has no id')
  const parentId = posted.externalId
  vi.mocked(mockComments).mockReturnValue(async () =>
    ages.map((age, index) => ({
      externalId: `c-${index}`,
      parentId,
      author: { handle: 'dana_ops', name: 'Dana' },
      text: `Which queue do you use? ${'And why that one. '.repeat(10)}`,
      url: `https://x.com/dana_ops/status/c-${index}`,
      community: null,
      likes: 0,
      at: NOW - age,
    }))
  )
  return account
}

async function subscribe(t: Test, endpoint: string) {
  return t.mutation(api.private.notifications.subscribe, { endpoint, p256dh: 'key', auth: 'secret', label: endpoint })
}

describe('notifications', () => {
  it("announces one poll's fresh comments in one notification, and records it in mock mode without pushing", async () => {
    const t = setup()
    const account = await withComments(t, [10 * 60_000, 20 * 60_000, 72 * HOUR])
    await subscribe(t, 'https://push.example/phone')
    await t.action(internal.internal.comments.poll, { accountId: account._id })
    await t.finishAllScheduledFunctions(() => {})
    await t.action(internal.internal.comments.poll, { accountId: account._id })
    await t.finishAllScheduledFunctions(() => {})

    const notifications = await t.query(api.private.notifications.recent, {})
    // The two fresh comments and the mention; the three-day-old comment is not announced, and the second poll adds nothing.
    expect(notifications).toHaveLength(1)
    const [notification] = notifications
    expect(notification).toMatchObject({ kind: 'comment', status: 'sent', devices: 0, mock: true, url: `/accounts/${account._id}/posted` })
    expect(notification?.commentIds).toHaveLength(3)
    expect(notification?.title).toBe('3 new comments for @ada_automates')
    expect(notification?.body.length).toBeLessThanOrEqual('@dana_ops: '.length + 120)
    expect(webpush.sendNotification).not.toHaveBeenCalled()
  })

  it("sends the morning digest at 07:00 where the accounts are, once, and holds it in the operator's quiet hours", async () => {
    const t = setup()
    const account = await t.run((ctx) => insertAccount(ctx))
    // The morning digest has something to say: a post due today.
    await t.run((ctx) => insertPost(ctx, account, { status: 'draft', plannedFor: '2026-10-14' }))
    await expect(
      t.mutation(api.private.notifications.setQuietHours, { quietHours: { start: 25, end: 7, timezone: TIMEZONE } })
    ).rejects.toThrow('Quiet hours start and end on a whole hour, 0 to 23.')
    await t.mutation(api.private.notifications.setQuietHours, { quietHours: { start: 6, end: 9, timezone: TIMEZONE } })
    // At noon in the account's timezone it is nobody's morning.
    expect(await t.mutation(internal.internal.notifications.morningDigest, {})).toEqual({ queued: 0 })
    vi.setSystemTime(instantAt('2026-10-14', 7, TIMEZONE))
    expect(await t.mutation(internal.internal.notifications.morningDigest, {})).toEqual({ queued: 1 })
    expect(await t.mutation(internal.internal.notifications.morningDigest, {})).toEqual({ queued: 0 })
    await t.run(async (ctx) => {
      const [held] = await ctx.db.query('notifications').collect()
      expect(held).toMatchObject({
        kind: 'digest',
        status: 'queued',
        // No draft of the account's has gone out yet, so the digest's first step is its first post.
        body: "1 post due today. No draft of @ada_automates's has gone out yet: post one on X yourself, then mark it posted.",
        dueAt: instantAt('2026-10-14', 9, TIMEZONE),
      })
    })
  })

  it('says on Monday what the week brought against the week before', async () => {
    const t = setup()
    const account = await t.run((ctx) => insertAccount(ctx))
    const monday = instantAt('2026-10-19', 7, TIMEZONE)
    const DAY = 86_400_000
    await t.run(async (ctx) => {
      const conversion = (kind: 'signup' | 'paid', at: number) =>
        ctx.db.insert('conversions', { accountId: account._id, kind, distinctId: `${kind}-${at}`, at, mock: true })
      await conversion('signup', monday - 2 * DAY)
      await conversion('signup', monday - 3 * DAY)
      await conversion('paid', monday - 3 * DAY)
      await conversion('signup', monday - 9 * DAY)
    })
    vi.setSystemTime(monday)
    expect(await t.mutation(internal.internal.notifications.morningDigest, {})).toEqual({ queued: 1 })
    const [digest] = await t.run((ctx) => ctx.db.query('notifications').collect())
    expect(digest?.body).toContain('Last week: 2 signups (+1), 1 paid (+1).')
    // A Monday with nothing waiting and no week to tell of says nothing.
    vi.setSystemTime(instantAt('2026-11-02', 7, TIMEZONE))
    expect(await t.mutation(internal.internal.notifications.morningDigest, {})).toEqual({ queued: 0 })
  })

  it('folds the comments of the quiet hours into the one notification held for their end', async () => {
    const t = setup()
    const account = await withComments(t, [10 * 60_000])
    await t.mutation(api.private.notifications.setQuietHours, { quietHours: { start: 11, end: 14, timezone: TIMEZONE } })
    await t.action(internal.internal.comments.poll, { accountId: account._id })
    vi.mocked(mockComments).mockReturnValue(async () => [
      {
        externalId: 'c-later',
        parentId: 'any',
        author: { handle: 'tomtries', name: 'Tom' },
        text: 'Me too.',
        url: 'https://x.com/tomtries/status/c-later',
        community: null,
        likes: 0,
        at: NOW - 60_000,
      },
    ])
    await t.action(internal.internal.comments.poll, { accountId: account._id })
    const notifications = await t.run((ctx) => ctx.db.query('notifications').collect())
    expect(notifications).toHaveLength(1)
    expect(notifications[0]).toMatchObject({ status: 'queued', dueAt: instantAt('2026-10-14', 14, TIMEZONE) })
    expect(notifications[0]?.commentIds.length).toBe(3)
  })

  it('pushes to every device, removes one the push service no longer knows, and records what failed', async () => {
    vi.stubEnv('PROVIDERS_MODE', 'real')
    vi.stubEnv('VAPID_SUBJECT', 'mailto:operator@example.com')
    vi.stubEnv('VAPID_PUBLIC_KEY', 'public')
    vi.stubEnv('VAPID_PRIVATE_KEY', 'private')
    const t = setup()
    await t.run((ctx) => insertAccount(ctx))
    const phone = await subscribe(t, 'https://push.example/phone')
    await subscribe(t, 'https://push.example/gone')
    const queue = () =>
      t.run(async (ctx) => {
        const workspace = await ctx.db.query('workspaces').first()
        if (!workspace) throw new Error('no workspace')
        await queueNotification(
          ctx,
          workspace,
          { kind: 'digest', commentIds: [], title: 'This morning', body: '2 replies to post.', url: '/', tag: 'digest' },
          { now: Date.now(), mock: false }
        )
      })
    await queue()
    await t.finishAllScheduledFunctions(() => {})
    const devices = await t.query(api.private.notifications.settings, {})
    expect(devices.devices.map((device) => device._id)).toEqual([phone])
    expect((await t.query(api.private.notifications.recent, {}))[0]).toMatchObject({ status: 'sent', devices: 1 })

    // A push service error other than a gone device is kept on the notification; with no device reached, it failed.
    await t.mutation(api.private.notifications.removeDevice, { subscriptionId: phone })
    await subscribe(t, 'https://push.example/broken')
    await queue()
    await t.finishAllScheduledFunctions(() => {})
    expect((await t.query(api.private.notifications.recent, {}))[0]).toMatchObject({
      status: 'failed',
      devices: 0,
      error: 'Received unexpected response code',
    })
    expect((await t.query(api.private.notifications.settings, {})).lastError?.error).toBe('Received unexpected response code')

    // A missing key fails the push by name (ADR 0002).
    vi.stubEnv('VAPID_PRIVATE_KEY', '')
    await queue()
    await t.finishAllScheduledFunctions(() => {})
    expect((await t.query(api.private.notifications.recent, {}))[0]).toMatchObject({
      status: 'failed',
      error: 'VAPID_PRIVATE_KEY is not set on this deployment. The Providers page lists the keys each provider needs.',
    })
  })

  it('keeps going when a device was removed while its push went out', async () => {
    const t = setup()
    await t.run((ctx) => insertAccount(ctx))
    const phone = await subscribe(t, 'https://push.example/phone')
    const notificationId = await t.run(async (ctx) => {
      const workspace = await ctx.db.query('workspaces').first()
      if (!workspace) throw new Error('no workspace')
      return queueNotification(
        ctx,
        workspace,
        { kind: 'digest', commentIds: [], title: 'T', body: 'B', url: '/', tag: 't' },
        { now: NOW + 3_600_000, mock: false }
      )
    })
    await t.mutation(api.private.notifications.removeDevice, { subscriptionId: phone })
    await t.mutation(internal.internal.notifications.delivered, {
      notificationId,
      outcomes: [{ subscriptionId: phone, outcome: { kind: 'sent' } }],
    })
    expect(await t.run((ctx) => ctx.db.get(notificationId))).toMatchObject({ status: 'sent', devices: 1 })
  })
})
