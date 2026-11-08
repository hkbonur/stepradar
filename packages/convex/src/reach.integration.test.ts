import { describe, expect, it } from 'vitest'
import { api, internal } from './_generated/api'
import { HEARD_FIT, insertAccount } from '../test/fixtures'
import { setup } from '../test/setup'

const MINUTE = 60_000

/** A thread the listener found on X, `minutes` old with `comments` answers. */
function found(externalId: string, minutes: number, comments: number) {
  return {
    post: {
      origin: 'search' as const,
      externalId,
      url: `https://x.com/dana_ops/status/${externalId}`,
      title: null,
      text: `How do you dedupe a webhook that fires twice? (${externalId})`,
      postedAt: Date.now() - minutes * MINUTE,
      author: { handle: 'dana_ops', name: 'Dana' },
      reach: 5_000,
      community: null,
      pillar: 'n8n tutorials',
      comments,
    },
    fit: HEARD_FIT,
  }
}

describe('reach', () => {
  it('pushes once, for the found thread drawing answers fastest, and never for one that is old or quiet', async () => {
    const t = setup()
    const account = await t.run((ctx) => insertAccount(ctx))
    const store = (heard: ReturnType<typeof found>[]) =>
      t.mutation(internal.internal.replies.storeHeardMutation, { accountId: account._id, mock: true, heard })
    // Old, quiet, and too few to say: none rises.
    expect((await store([found('1', 180, 90), found('2', 30, 3), found('3', 30, 4)])).rising).toBeNull()
    const outcome = await store([found('4', 40, 20), found('5', 20, 30)])
    expect(outcome.rising).toMatchObject({ comments: 30, minutes: 20 })
    await t.finishAllScheduledFunctions(() => {})
    const notifications = await t.run((ctx) => ctx.db.query('notifications').collect())
    expect(notifications).toMatchObject([
      {
        kind: 'rising',
        accountId: account._id,
        title: 'Rising in X: "How do you dedupe a webhook that fires twice? (5)"',
        body: "30 comments in 20 minutes. Answer while it is read: it waits on @ada_automates's replies.",
        url: `/accounts/${account._id}/replies`,
      },
    ])
  })

  it('pushes no rising thread in the quiet hours, since by their end it no longer rises', async () => {
    const t = setup()
    const account = await t.run(async (ctx) => {
      const account = await insertAccount(ctx)
      const hour = new Date().getUTCHours()
      await ctx.db.patch(account.workspaceId, { quietHours: { start: hour, end: (hour + 2) % 24, timezone: 'UTC' } })
      return account
    })
    const outcome = await t.mutation(internal.internal.replies.storeHeardMutation, {
      accountId: account._id,
      mock: true,
      heard: [found('5', 20, 30)],
    })
    expect(outcome.rising).toMatchObject({ comments: 30 })
    await t.finishAllScheduledFunctions(() => {})
    expect(await t.run((ctx) => ctx.db.query('notifications').collect())).toEqual([])
  })

  it("gives an account one bio link, which counts the profile's visits for the account, names no post, and follows the sponsor's website", async () => {
    const t = setup()
    const x = await t.run((ctx) => insertAccount(ctx))
    const page = () => t.query(api.private.accounts.get, { accountId: x._id })
    expect((await page())?.bioLink).toBeNull()
    const url = await t.mutation(api.private.accounts.makeBioLink, { accountId: x._id })
    expect(await t.mutation(api.private.accounts.makeBioLink, { accountId: x._id })).toBe(url)
    const slug = new URL(url).pathname.replace('/go/', '')
    const clicked = await t.mutation(api.public.links.click, { slug })
    const target = new URL(clicked?.target ?? '')
    expect([target.searchParams.get('utm_source'), target.searchParams.get('utm_medium'), target.searchParams.get('utm_campaign')]).toEqual(
      ['ada_automates', 'x', 'bio']
    )
    expect((await page())?.bioLink).toEqual({ kind: 'tracked', url, clicks: 1 })
    // The link on the profile stays; the website it sends readers to is the sponsor's as it is now.
    await t.run(async (ctx) => {
      const workspace = await ctx.db.query('workspaces').first()
      if (workspace) await ctx.db.patch(workspace._id, { sponsorUrl: 'https://formstep.com' })
    })
    expect(new URL((await t.mutation(api.public.links.click, { slug }))?.target ?? '').origin).toBe('https://formstep.com')

    // Reddit distrusts redirects: the bio link is the sponsor's website, its UTM parameters in it, and nothing counts its clicks.
    const reddit = await t.run((ctx) => insertAccount(ctx, { platform: 'reddit', handle: 'ada' }))
    const direct = (await t.query(api.private.accounts.get, { accountId: reddit._id }))?.bioLink
    expect(direct).toEqual({ kind: 'direct', url: 'https://formstep.io/?utm_source=ada&utm_medium=reddit&utm_campaign=bio' })
  })
})
