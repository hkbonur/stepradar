import { affiliationProblems, needsConnection, placeLabel, placeOf, takenHandleProblem } from '@influstep/shared'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { enqueueJob } from '../jobs/queue'
import { refusal } from '../lib/errors'
import type { AccountBrief, PostBrief } from '../providers/llm/types'
import { addDays, dayKey, weekStart } from './dates'
import { openFirstItems } from './checklist'
import { communitiesOf } from './communities'
import { accountReader, openConnectItem } from './connections'
import { assertFormat } from './formats'
import { makeBioLink } from './links'
import { planWaits } from './planner'

type Reader = { db: QueryCtx['db'] }

/** The accounts not paused: the ones the crons and a launch work for. */
export async function activeAccounts(ctx: Reader): Promise<Doc<'accounts'>[]> {
  return (await ctx.db.query('accounts').collect()).filter((account) => !account.paused)
}

/** The account as every brief to the writer and the analyst names it. */
export function accountBriefOf(account: Doc<'accounts'>): AccountBrief {
  return {
    name: account.name,
    handle: account.handle,
    platform: account.platform,
    placeName: placeLabel(placeOf(account)),
    niche: account.niche,
    audience: account.audience,
    tone: account.tone,
    bible: account.bible,
    pillars: account.pillars,
  }
}

/** The account's learned voice as the writer reads it for a post or a reply, or null before the analyst learned it. */
export function voiceBriefOf(account: Doc<'accounts'>): PostBrief['voice'] {
  if (!account.voice) return null
  const { language, summary, traits, emoji, hashtags } = account.voice
  return { language, summary, traits, emoji, hashtags }
}

/**
 * How a row names its account (DESIGN.md, identity rule): the mark's
 * platform, the name and the handle, and on a forum the forum, which its
 * links are read against (shared `PlatformPlace`).
 */
export function accountRefOf(account: Doc<'accounts'>) {
  return { _id: account._id, name: account.name, handle: account.handle, ...placeOf(account) }
}

export type AccountRef = ReturnType<typeof accountRefOf>

/** An account's settings, as the operator gives them. */
export type AccountFields = Omit<Doc<'accounts'>, '_id' | '_creationTime' | 'workspaceId' | 'paused' | 'createdAt' | 'voice' | 'strategy'>

/**
 * A new account in the workspace, its first signal poll, its first checklist
 * items (core/checklist.ts), and on a platform that reads it only once the
 * operator lets it, the item that asks. The handle and the place are its
 * links' utm_source and utm_medium, so a handle taken on its platform, or on
 * its forum, is refused.
 */
export async function createAccount(ctx: MutationCtx, workspace: Doc<'workspaces'>, fields: AccountFields): Promise<Doc<'accounts'>> {
  assertFormat(fields)
  assertAffiliation(fields.affiliationLine, workspace.sponsorName)
  const onPlatform = await ctx.db
    .query('accounts')
    .withIndex('by_platform', (q) => q.eq('platform', fields.platform))
    .collect()
  const placed = (account: Pick<AccountFields, 'platform' | 'forum' | 'handle'>) => ({ ...placeOf(account), handle: account.handle })
  const taken = takenHandleProblem(placed(fields), onPlatform.map(placed))
  if (taken !== null) throw refusal(taken)
  const accountId = await ctx.db.insert('accounts', { ...fields, workspaceId: workspace._id, paused: false, createdAt: Date.now() })
  const account = await ctx.db.get(accountId)
  if (!account) throw new Error('account vanished')
  const now = Date.now()
  if (needsConnection(account.platform)) await openConnectItem(ctx, account, now)
  const bioLink = await makeBioLink(ctx, account, workspace)
  await openFirstItems(ctx, account, { reader: await accountReader(ctx, account), bioLink: bioLink.url, now })
  await enqueueJob(ctx, { kind: 'poll_signals', accountId })
  return account
}

/**
 * The rest of this week and the whole of next: an account's first plan, and
 * its plan again once a community ends its wait (`endsWait`). The Monday plan
 * covers the week after it, so an account made mid-week would otherwise wait
 * until then for next week's posts. The planner never schedules a day already
 * gone.
 */
export async function planTwoWeeks(ctx: MutationCtx, account: Doc<'accounts'>, now: number): Promise<Id<'jobs'>[]> {
  const thisWeek = weekStart(dayKey(now, account.timezone))
  const jobs: Id<'jobs'>[] = []
  for (const start of [thisWeek, addDays(thisWeek, 7)]) {
    jobs.push(await enqueueJob(ctx, { kind: 'plan_week', accountId: account._id, weekStart: start }))
  }
  return jobs
}

/** Why the account plans no post (core/planner `planWaits`), read against its communities; null when it can. */
export async function planWaitsOf(ctx: Reader, account: Doc<'accounts'>): Promise<string | null> {
  return planWaits(placeOf(account), await communitiesOf(ctx, account._id))
}

/**
 * Makes a change to the account's communities and says whether it ended the
 * plan's wait: a first community met, or the one the operator looked at
 * after it removed something. The caller then plans two weeks.
 */
export async function endsWait(ctx: MutationCtx, account: Doc<'accounts'>, change: () => Promise<void>): Promise<boolean> {
  const waited = (await planWaitsOf(ctx, account)) !== null
  await change()
  return waited && (await planWaitsOf(ctx, account)) === null
}

/** The affiliation line names the sponsor (shared `affiliationProblems`), however the account is saved. */
export function assertAffiliation(line: string, sponsorName: string): void {
  const [problem] = affiliationProblems(line, sponsorName)
  if (problem) throw refusal(problem)
}
