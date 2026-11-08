import { v } from 'convex/values'
import { placeLabel, placeOf } from '@influstep/shared'
import type { Doc } from '../_generated/dataModel'
import { internal } from '../_generated/api'
import { internalMutation, internalQuery, type ActionCtx } from '../_generated/server'
import { endsWait, planTwoWeeks } from '../core/accounts'
import { communitiesToRead as communitiesToReadRule, storeCommunityRules } from '../core/communities'
import { selfPromotionValidator } from '../lib/validators'
import { classifierProvider } from '../providers/classifier'
import type { PlatformReader } from '../providers/platforms'

/** A community whose rules could not be read, and why. */
export interface UnreadCommunity {
  name: string
  error: string
}

/**
 * Reads the rules of the communities among `names` never read, or not within
 * the week, and has the classifier say what they allow; for the listener and
 * for a pasted thread alike. A community whose rules cannot be read is
 * returned with the reason, so its threads stay out of this sweep: the
 * writer never answers where it does not know the rules (docs/plan.md, ground
 * rule 3).
 */
export async function readCommunityRules(
  ctx: ActionCtx,
  account: Doc<'accounts'>,
  reader: PlatformReader,
  names: string[]
): Promise<{ unread: UnreadCommunity[] }> {
  const rules = reader.rules
  if (!rules || names.length === 0) return { unread: [] }
  const toRead: string[] = await ctx.runQuery(internal.internal.communities.communitiesToRead, {
    accountId: account._id,
    names: [...new Set(names)],
  })
  const unread: UnreadCommunity[] = []
  let endedWait = false
  for (const name of toRead) {
    try {
      const rulesText = await rules(name)
      const place = { platform: account.platform, placeName: placeLabel(placeOf(account)) }
      const read = await classifierProvider().communityRules({ ...place, community: name, rules: rulesText })
      const stored = await ctx.runMutation(internal.internal.communities.storeCommunity, {
        accountId: account._id,
        name,
        rulesText,
        ...read,
      })
      endedWait ||= stored.endedWait
    } catch (caught) {
      unread.push({ name, error: caught instanceof Error ? caught.message : String(caught) })
    }
  }
  // Once every community of the sweep is stored, so the plan places its posts among all of them, not the first alone.
  if (endedWait) await ctx.runMutation(internal.internal.communities.planAfterWait, { accountId: account._id })
  return { unread }
}

export const communitiesToRead = internalQuery({
  args: { accountId: v.id('accounts'), names: v.array(v.string()) },
  handler: async (ctx, args): Promise<string[]> => communitiesToReadRule(ctx, args.accountId, args.names, Date.now()),
})

/**
 * Stores a community's rules as just read, and says whether it ended the
 * wait of a Reddit or forum account's plan (core/accounts `endsWait`): its
 * first community, or its first since the others removed something.
 */
export const storeCommunity = internalMutation({
  args: { accountId: v.id('accounts'), name: v.string(), rulesText: v.string(), selfPromotion: selfPromotionValidator, reason: v.string() },
  handler: async (ctx, args): Promise<{ endedWait: boolean }> => {
    const { accountId, ...read } = args
    const account = await ctx.db.get(accountId)
    if (!account) throw new Error(`account ${accountId} not found`)
    return { endedWait: await endsWait(ctx, account, () => storeCommunityRules(ctx, accountId, read, Date.now())) }
  },
})

/** The plan the account waited for, once a sweep's communities are stored: this week and next, not the Monday after. */
export const planAfterWait = internalMutation({
  args: { accountId: v.id('accounts') },
  handler: async (ctx, args) => {
    const account = await ctx.db.get(args.accountId)
    if (!account) throw new Error(`account ${args.accountId} not found`)
    await planTwoWeeks(ctx, account, Date.now())
  },
})
