import { VOICE_SAMPLE_MIN, handleOf, historyCanComeIn, placeOf, profileEditLink } from '@influstep/shared'
import type { Infer } from 'convex/values'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import type { checklistActionValidator } from '../lib/validators'
import type { PlatformReader } from '../providers/platforms'

/**
 * Checklist items (CONTEXT.md, "Checklist item") that close once the step
 * they ask for is taken, and a new account's first ones: the steps only the
 * operator takes before its drafts read as theirs.
 */

type Reader = { db: QueryCtx['db'] }

type ChecklistActionKind = Infer<typeof checklistActionValidator>['kind']

/** The account's open items that ask for one action. */
export async function openItemsWith(ctx: Reader, accountId: Id<'accounts'>, kind: ChecklistActionKind): Promise<Doc<'checklistItems'>[]> {
  const open = await ctx.db
    .query('checklistItems')
    .withIndex('by_account_status', (q) => q.eq('accountId', accountId).eq('status', 'open'))
    .collect()
  return open.filter((item) => item.action?.kind === kind)
}

/** The step an action asks for was taken: its open items are done. */
export async function closeItemsWith(ctx: MutationCtx, accountId: Id<'accounts'>, kind: ChecklistActionKind, now: number): Promise<void> {
  for (const item of await openItemsWith(ctx, accountId, kind)) await ctx.db.patch(item._id, { status: 'done', doneAt: now })
}

/**
 * A new account's first items: its bio on the profile it was made for, which
 * a reader opens after a reply, and where its own posts can come in (shared
 * `historyCanComeIn`), its voice. A Reddit account's connection has its own
 * item (core/connections.ts).
 */
export async function openFirstItems(
  ctx: MutationCtx,
  account: Doc<'accounts'>,
  args: { reader: PlatformReader; bioLink: string; now: number }
): Promise<void> {
  const { reader, bioLink, now } = args
  const profile = profileEditLink(placeOf(account), account.handle)
  await ctx.db.insert('checklistItems', {
    accountId: account._id,
    title: `Put the bio and its link on ${handleOf(account)}'s profile`,
    why: `People who read a reply or a post open the profile next. Its bio: "${account.bio}" Its link, so the signups the profile brings count for the account: ${bioLink}`,
    status: 'open',
    ...(profile === null ? {} : { action: { kind: 'visit' as const, url: profile } }),
    createdAt: now,
  })
  if (historyCanComeIn(account.platform, reader.activity !== undefined)) await openVoiceItem(ctx, account, now)
}

/**
 * The item that asks for the account's voice, which the writer writes every
 * draft in once it is learned: one at a time, opened for a new account and
 * again when Clear history takes the voice; done once the voice is learned.
 */
export async function openVoiceItem(ctx: MutationCtx, account: Doc<'accounts'>, now: number): Promise<void> {
  if ((await openItemsWith(ctx, account._id, 'learn_voice')).length > 0) return
  await ctx.db.insert('checklistItems', {
    accountId: account._id,
    title: `Teach the writer ${handleOf(account)}'s voice`,
    why: `Until the analyst learns it from at least ${VOICE_SAMPLE_MIN} of the account's own posts, the writer writes in English in the account's tone. Bring its posts in on the voice page, then learn the voice.`,
    status: 'open',
    action: { kind: 'learn_voice' },
    createdAt: now,
  })
}
