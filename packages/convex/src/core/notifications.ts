import {
  grouped,
  communityLabel,
  handleOf,
  notificationText,
  postedAnchor,
  quietAt,
  type NotificationPayload,
  type QuietHours,
  placeLabel,
  placeOf,
} from '@influstep/shared'
import { internal } from '../_generated/api'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import type { PushOutcome } from '../providers/notifier/types'
import { addDays, dayKey, hourAt, instantAt, weekStart } from './dates'
import { lastWeekLine } from './growth'
import { workspaceOf } from './workspace'
import { nextSteps, nextStepsInput } from './steps'
import { repliesWithStatus, type RisingThread } from './replies'

/**
 * Notifications (shared notifications.ts): what a batch of comments and the
 * morning digest say, when they may be pushed, and what the devices made of
 * them.
 */

/** When a notification made at `now` may be pushed: at once, or at the end of the quiet hours it falls in. */
export function dueAtFor(quiet: QuietHours | undefined, now: number): number {
  if (quiet === undefined || !quietAt(quiet, hourAt(now, quiet.timezone))) return now
  const today = dayKey(now, quiet.timezone)
  const end = instantAt(today, quiet.end, quiet.timezone)
  return end > now ? end : instantAt(addDays(today, 1), quiet.end, quiet.timezone)
}

/** What a batch of an account's new comments says: the one comment by who wrote it, or how many with the first. */
export function commentPayloadOf(account: Doc<'accounts'>, comments: Doc<'comments'>[]): NotificationPayload {
  const [first] = comments
  if (!first) throw new Error('a comment notification needs a comment')
  const who = handleOf({ platform: account.platform, handle: first.author.handle })
  // The Posted page shows the comments under what went out; a mention is under nothing of the account's, and its answer waits on the replies page.
  const repliesPage = `/accounts/${account._id}/replies`
  const postedPage = `/accounts/${account._id}/posted`
  if (comments.length === 1) {
    const url = first.inReplyTo === undefined ? repliesPage : `${postedPage}#${postedAnchor(first.inReplyTo)}`
    const did = first.inReplyTo === undefined ? 'named you' : 'answered you'
    return {
      title: `${who} ${did} on ${placeLabel(placeOf(account))}`,
      body: notificationText(first.text),
      url,
      tag: `comment-${first.externalId}`,
    }
  }
  return {
    title: `${comments.length} new comments for ${handleOf(account)}`,
    body: `${who}: ${notificationText(first.text)}`,
    url: comments.every((comment) => comment.inReplyTo === undefined) ? repliesPage : postedPage,
    tag: `comments-${first.externalId}`,
  }
}

/**
 * Announces an account's fresh comments. While a comment notification of
 * the account is held for the end of the quiet hours, the new comments join
 * it, so the morning brings one push and not one per poll.
 */
export async function queueCommentNotification(
  ctx: MutationCtx,
  account: Doc<'accounts'>,
  fresh: Doc<'comments'>[],
  args: { now: number; mock: boolean }
): Promise<void> {
  const held = (
    await ctx.db
      .query('notifications')
      .withIndex('by_status_due', (q) => q.eq('status', 'queued').gt('dueAt', args.now))
      .collect()
  ).find((notification) => notification.kind === 'comment' && notification.accountId === account._id)
  if (held === undefined) {
    const workspace = await workspaceOf(ctx, account)
    const notification = { kind: 'comment' as const, accountId: account._id, commentIds: fresh.map((comment) => comment._id) }
    await queueNotification(ctx, workspace, { ...notification, ...commentPayloadOf(account, fresh) }, args)
    return
  }
  const earlier = (await Promise.all(held.commentIds.map((id) => ctx.db.get(id)))).filter((comment) => comment !== null)
  const comments = [...earlier, ...fresh]
  await ctx.db.patch(held._id, { commentIds: comments.map((comment) => comment._id), ...commentPayloadOf(account, comments) })
}

/**
 * Queues a notification and has the notifier push it when it is due: at
 * once, or at the end of the workspace's quiet hours (internal/push.ts).
 */
export async function queueNotification(
  ctx: MutationCtx,
  workspace: Doc<'workspaces'>,
  notification: { kind: Doc<'notifications'>['kind']; accountId?: Id<'accounts'>; commentIds: Id<'comments'>[] } & NotificationPayload,
  args: { now: number; mock: boolean }
): Promise<Id<'notifications'>> {
  const dueAt = dueAtFor(workspace.quietHours, args.now)
  const notificationId = await ctx.db.insert('notifications', { ...notification, dueAt, status: 'queued', devices: 0, mock: args.mock })
  await ctx.scheduler.runAt(dueAt, internal.internal.push.sendDue, {})
  return notificationId
}

/** How many characters of a rising thread's title or first words the push names. */
const RISING_ABOUT_MAX = 70

/**
 * A found thread drawing answers fast (shared `risingRead`): pushed at once
 * to the account's replies page, where its draft is written within the
 * day's budget. In quiet hours none is queued: by their end the thread no
 * longer rises, and it waits on the replies page like any other. The
 * listener never keeps a thread it already heard, so each goes out once.
 */
export async function queueRisingNotification(
  ctx: MutationCtx,
  account: Doc<'accounts'>,
  rising: RisingThread,
  args: { now: number; mock: boolean }
): Promise<void> {
  const workspace = await workspaceOf(ctx, account)
  if (dueAtFor(workspace.quietHours, args.now) > args.now) return
  const where = rising.community === null ? placeLabel(placeOf(account)) : communityLabel(account.platform, rising.community)
  const payload: NotificationPayload = {
    title: `Rising in ${where}: "${notificationText(rising.about, RISING_ABOUT_MAX)}"`,
    body: `${counted(rising.comments, 'comment', 'comments')} in ${counted(rising.minutes, 'minute', 'minutes')}. Answer while it is read: it waits on ${handleOf(account)}'s replies.`,
    url: `/accounts/${account._id}/replies`,
    tag: `rising-${rising.replyId}`,
  }
  await queueNotification(ctx, workspace, { kind: 'rising', accountId: account._id, commentIds: [], ...payload }, args)
}

/** How long a push run may hold the notifications it claimed before another run takes them back. */
const CLAIM_MS = 10 * 60_000

/**
 * The notifications due now, claimed for one push run so a second run never
 * pushes them again; a claim older than CLAIM_MS belongs to a run that died,
 * and is taken back.
 */
export async function claimDue(ctx: MutationCtx, now: number): Promise<Doc<'notifications'>[]> {
  const queued = await ctx.db
    .query('notifications')
    .withIndex('by_status_due', (q) => q.eq('status', 'queued').lte('dueAt', now))
    .collect()
  const abandoned = (
    await ctx.db
      .query('notifications')
      .withIndex('by_status_due', (q) => q.eq('status', 'sending').lte('dueAt', now))
      .collect()
  ).filter((notification) => notification.claimedAt !== undefined && now - notification.claimedAt > CLAIM_MS)
  const due = [...queued, ...abandoned]
  for (const notification of due) await ctx.db.patch(notification._id, { status: 'sending', claimedAt: now })
  return due
}

/**
 * What the devices made of a push: a device the push service no longer
 * knows is removed, one that took it is stamped, and the notification failed
 * only when every device it was pushed to failed.
 */
export async function recordDelivery(
  ctx: MutationCtx,
  notificationId: Id<'notifications'>,
  outcomes: { subscriptionId: Id<'pushSubscriptions'>; outcome: PushOutcome }[],
  now: number
): Promise<void> {
  const errors: string[] = []
  let devices = 0
  for (const { subscriptionId, outcome } of outcomes) {
    // The operator may have removed the device while the push went out.
    const device = await ctx.db.get(subscriptionId)
    switch (outcome.kind) {
      case 'sent':
        devices += 1
        if (device !== null) await ctx.db.patch(subscriptionId, { lastOkAt: now })
        break
      case 'gone':
        if (device !== null) await ctx.db.delete(subscriptionId)
        break
      case 'failed':
        errors.push(outcome.error)
        break
      case 'recorded':
        break
    }
  }
  const failed = errors.length > 0 && devices === 0
  await ctx.db.patch(notificationId, {
    status: failed ? 'failed' : 'sent',
    devices,
    sentAt: now,
    ...(errors.length === 0 ? {} : { error: [...new Set(errors)].join(' ') }),
  })
}

type Reader = { db: QueryCtx['db'] }

/** "1 reply", "3 replies". */
function counted(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

/** The local hour the morning digest goes out at. */
export const DIGEST_HOUR = 7

/**
 * What waits on the operator this morning across `accounts`: replies to
 * post, posts due today and new comments, then the first next step (core
 * `nextSteps`); null when nothing does.
 */
export async function morningDigestOf(ctx: Reader, accounts: Doc<'accounts'>[], now: number): Promise<NotificationPayload | null> {
  let replies = 0
  let posts = 0
  let comments = 0
  for (const account of accounts) {
    replies += (await repliesWithStatus(ctx, account._id, 'draft')).length
    const today = dayKey(now, account.timezone)
    const due = await ctx.db
      .query('posts')
      .withIndex('by_account_day', (q) => q.eq('accountId', account._id).eq('plannedFor', today))
      .collect()
    posts += due.filter((post) => post.status === 'draft').length
    const waiting = await ctx.db
      .query('comments')
      .withIndex('by_account_status', (q) => q.eq('accountId', account._id).eq('status', 'new'))
      .collect()
    comments += waiting.length
  }
  const parts = [
    ...(replies > 0 ? [`${counted(replies, 'reply', 'replies')} to post`] : []),
    ...(posts > 0 ? [`${counted(posts, 'post', 'posts')} due today`] : []),
    ...(comments > 0 ? [`${counted(comments, 'new comment', 'new comments')}`] : []),
  ]
  // The comments are counted above already; the next step after them says what else comes first.
  const [step] = nextSteps(await nextStepsInput(ctx, accounts, now), now).filter((candidate) => candidate.kind !== 'comments')
  const [first] = accounts
  if (!first) throw new Error('a digest needs an account')
  // On Monday the digest also says what the week brought, against the week before (core/growth.ts).
  const today = dayKey(now, first.timezone)
  const week = weekStart(today) === today ? await weekLine(ctx, accounts, now) : null
  if (parts.length === 0 && step === undefined && week === null) return null
  const body = [
    ...(parts.length === 0 ? [] : [`${parts.join(', ')}.`]),
    ...(week === null ? [] : [week]),
    ...(step === undefined ? [] : [step.text]),
  ].join(' ')
  return { title: 'This morning', body, url: '/', tag: `digest-${dayKey(now, first.timezone)}-${first.timezone}` }
}

/**
 * Last week's signups and paid conversions over `accounts`, Monday to Sunday
 * where they are, each with how it moved against the week before; null when
 * neither week brought any, which is nothing to say.
 */
async function weekLine(ctx: Reader, accounts: Doc<'accounts'>[], now: number): Promise<string | null> {
  let signups = 0
  let paid = 0
  let before = { signups: 0, paid: 0 }
  for (const account of accounts) {
    const line = await lastWeekLine(ctx, account, now)
    signups += line.signups
    paid += line.paid
    before = { signups: before.signups + line.before.signups, paid: before.paid + line.before.paid }
  }
  if (signups + paid + before.signups + before.paid === 0) return null
  const moved = (count: number, was: number) => (count === was ? '' : ` (${count > was ? '+' : '−'}${grouped(Math.abs(count - was))})`)
  return `Last week: ${grouped(signups)} ${signups === 1 ? 'signup' : 'signups'}${moved(signups, before.signups)}, ${grouped(paid)} paid${moved(paid, before.paid)}.`
}

/**
 * The morning digests due now: one for the active accounts of each timezone
 * where it is DIGEST_HOUR, unless that morning's digest was queued already.
 */
export async function queueMorningDigests(
  ctx: MutationCtx,
  workspace: Doc<'workspaces'>,
  args: { now: number; mock: boolean }
): Promise<number> {
  const accounts = (await ctx.db.query('accounts').collect()).filter((account) => !account.paused)
  let queued = 0
  for (const timezone of new Set(accounts.map((account) => account.timezone))) {
    if (hourAt(args.now, timezone) !== DIGEST_HOUR) continue
    const digest = await morningDigestOf(
      ctx,
      accounts.filter((account) => account.timezone === timezone),
      args.now
    )
    if (digest === null) continue
    const sent = await ctx.db
      .query('notifications')
      .withIndex('by_tag', (q) => q.eq('tag', digest.tag))
      .first()
    if (sent !== null) continue
    await queueNotification(ctx, workspace, { kind: 'digest', commentIds: [], ...digest }, args)
    queued += 1
  }
  return queued
}
