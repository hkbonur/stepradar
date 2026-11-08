import { handleOf, placeOf, placeLabel } from '@influstep/shared'
import { v } from 'convex/values'
import type { Doc, Id } from '../_generated/dataModel'
import { internalMutation, internalQuery, type ActionCtx, type MutationCtx } from '../_generated/server'
import { finishConnect, pendingConnectByState, revokeConnection, startConnect } from '../core/connections'
import { workspaceOf } from '../core/workspace'
import { internal } from '../_generated/api'
import { refusal } from '../lib/errors'
import { ConnectionRevoked, platformReader, type PlatformReader, type ReaderConnection } from '../providers/platforms'

/** Internal steps of connecting an account (private/connections.ts starts it, http.ts takes the platform's callback). */

async function requireAccount(ctx: Pick<MutationCtx, 'db'>, accountId: Id<'accounts'>): Promise<Doc<'accounts'>> {
  const account = await ctx.db.get(accountId)
  if (!account) throw new Error(`account ${accountId} not found`)
  return account
}

export const start = internalMutation({
  args: { accountId: v.id('accounts'), state: v.string() },
  handler: async (ctx, args) => startConnect(ctx, await requireAccount(ctx, args.accountId), args.state, Date.now()),
})

/** Mock mode: connected as the account's own handle, with no token, so the mock reader reads as if it were. */
export const connectMock = internalMutation({
  args: { accountId: v.id('accounts') },
  handler: async (ctx, args) => {
    const account = await requireAccount(ctx, args.accountId)
    await finishConnect(ctx, account, { refreshToken: 'mock', scopes: [], username: account.handle, mock: true }, Date.now())
  },
})

/** The account a callback's state belongs to, and the studio page to send the operator back to; null for a state unknown or expired. */
export const pendingByState = internalQuery({
  args: { state: v.string() },
  handler: async (ctx, args): Promise<{ accountId: Id<'accounts'>; back: string } | null> => {
    const account = await pendingConnectByState(ctx, args.state, Date.now())
    if (!account) return null
    const workspace = await workspaceOf(ctx, account)
    return { accountId: account._id, back: `${workspace.appUrl}/accounts/${account._id}` }
  },
})

export const finish = internalMutation({
  args: { accountId: v.id('accounts'), refreshToken: v.string(), scopes: v.array(v.string()), username: v.string() },
  handler: async (ctx, args) => {
    const { accountId, ...granted } = args
    await finishConnect(ctx, await requireAccount(ctx, accountId), { ...granted, mock: false }, Date.now())
  },
})

export const fail = internalMutation({
  args: { accountId: v.id('accounts'), error: v.string() },
  handler: async (ctx, args) => revokeConnection(ctx, await requireAccount(ctx, args.accountId), args.error, Date.now()),
})

/**
 * The account's platform reader for an action: every read goes through its
 * connection, and a grant the platform no longer accepts is stored as
 * revoked, which opens the checklist item again, and the step fails with
 * words the operator reads.
 */
export function actionReader(ctx: ActionCtx, account: Doc<'accounts'>, connection: ReaderConnection | null): PlatformReader {
  const reader = platformReader(placeOf(account), connection)
  const guard = <A extends unknown[], R>(read: ((...args: A) => Promise<R>) | undefined) =>
    read && ((...args: A) => readingAs(ctx, account, () => read(...args)))
  return {
    ...reader,
    search: guard(reader.search),
    mentions: guard(reader.mentions),
    activity: guard(reader.activity),
    comments: guard(reader.comments),
    counts: guard(reader.counts),
    account: guard(reader.account),
    rules: guard(reader.rules),
    community: guard(reader.community),
  }
}

async function readingAs<T>(ctx: ActionCtx, account: Doc<'accounts'>, read: () => Promise<T>): Promise<T> {
  try {
    return await read()
  } catch (caught) {
    if (!(caught instanceof ConnectionRevoked)) throw caught
    const error = `${placeLabel(placeOf(account))} no longer lets Influstep read ${handleOf(account)}: connect it again.`
    await ctx.runMutation(internal.internal.connections.fail, { accountId: account._id, error })
    throw refusal(error)
  }
}
