import { writeDayOf } from '@influstep/shared'
import type { Id } from '../src/_generated/dataModel'
import { instantAt } from '../src/core/dates'
import { queueDuePosts } from '../src/core/posts'
import type { setup } from './setup'

/**
 * The due-draft pass (core `queueDuePosts`, which the 07:30 cron runs
 * through internal/schedule.ts `writeDuePosts`) on the account's morning
 * before `plannedFor`, then every job it queued. It runs at that morning's
 * time rather than now, so a test can write next week's posts without
 * waiting for them; an idea planned before that morning's day is skipped, as
 * it would be then.
 */
export async function writePostsDueBefore(
  t: ReturnType<typeof setup>,
  accountId: Id<'accounts'>,
  plannedFor: string
): Promise<{ queued: number; skipped: number }> {
  const outcome = await t.run(async (ctx) => {
    const account = await ctx.db.get(accountId)
    if (!account) throw new Error('account vanished')
    return queueDuePosts(ctx, account, instantAt(writeDayOf(plannedFor), 9, account.timezone))
  })
  await t.finishAllScheduledFunctions(() => {})
  return outcome
}
