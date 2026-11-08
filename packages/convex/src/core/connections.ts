import { handleOf, needsConnection, placeOf, placeLabel } from '@influstep/shared'
import type { Infer } from 'convex/values'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import type { connectionStatusValidator } from '../lib/validators'
import { platformReader, type PlatformReader, type ReaderConnection } from '../providers/platforms'
import { closeItemsWith, openItemsWith } from './checklist'

/**
 * An account's connection to a platform that reads it only once the operator
 * lets it (shared `CONNECTED_PLATFORMS`): the operator starts it from the
 * account, consents on the platform, and the callback stores what the
 * reader reads with. Until it is connected, a checklist item asks for it.
 */

type Reader = { db: QueryCtx['db'] }

type ConnectionStatus = Infer<typeof connectionStatusValidator>

/** How long the platform's consent page may take: a callback after it is refused, and the operator starts again. */
export const CONNECT_WINDOW_MS = 15 * 60_000

export async function connectionOf(ctx: Reader, accountId: Id<'accounts'>): Promise<Doc<'connections'> | null> {
  return ctx.db
    .query('connections')
    .withIndex('by_account', (q) => q.eq('accountId', accountId))
    .first()
}

/** What the account's platform reader reads with: the grant once connected, else nothing (providers/platforms `platformReader`). */
export function readerConnectionOf(connection: Doc<'connections'> | null): ReaderConnection | null {
  if (connection === null || connection.status.kind !== 'connected') return null
  return { refreshToken: connection.status.refreshToken }
}

export async function readerConnectionFor(ctx: Reader, accountId: Id<'accounts'>): Promise<ReaderConnection | null> {
  return readerConnectionOf(await connectionOf(ctx, accountId))
}

/** The account's platform reader, as its connection lets it read: what a mutation asks before it queues a reader's step. */
export async function accountReader(ctx: Reader, account: Doc<'accounts'>): Promise<PlatformReader> {
  return platformReader(placeOf(account), await readerConnectionFor(ctx, account._id))
}

/** The connection as the studio shows it: never the token. */
export type ConnectionView =
  | { kind: 'needless' }
  | { kind: 'missing' }
  | { kind: 'pending' }
  | { kind: 'connected'; username: string; connectedAt: number; mock: boolean }
  | { kind: 'revoked'; error: string; at: number }

export function connectionViewOf(account: Doc<'accounts'>, connection: Doc<'connections'> | null): ConnectionView {
  if (!needsConnection(account.platform)) return { kind: 'needless' }
  if (connection === null) return { kind: 'missing' }
  const status = connection.status
  switch (status.kind) {
    case 'pending':
      return { kind: 'pending' }
    case 'connected':
      return { kind: 'connected', username: status.username, connectedAt: status.connectedAt, mock: connection.mock }
    case 'revoked':
      return { kind: 'revoked', error: status.error, at: status.at }
  }
}

async function setStatus(ctx: MutationCtx, account: Doc<'accounts'>, status: ConnectionStatus, mock: boolean): Promise<void> {
  const existing = await connectionOf(ctx, account._id)
  if (existing) {
    await ctx.db.patch(existing._id, { status, mock })
    return
  }
  await ctx.db.insert('connections', { accountId: account._id, status, mock })
}

/** The operator left for the platform's consent page with this state; the callback brings it back. */
export async function startConnect(ctx: MutationCtx, account: Doc<'accounts'>, state: string, now: number): Promise<void> {
  await setStatus(ctx, account, { kind: 'pending', state, startedAt: now }, false)
}

/** The account whose consent page handed out this state, while the window is open; null for one unknown or expired. */
export async function pendingConnectByState(ctx: Reader, state: string, now: number): Promise<Doc<'accounts'> | null> {
  for (const connection of await ctx.db.query('connections').collect()) {
    const status = connection.status
    if (status.kind !== 'pending' || status.state !== state) continue
    if (now - status.startedAt > CONNECT_WINDOW_MS) return null
    return ctx.db.get(connection.accountId)
  }
  return null
}

/**
 * What the platform said who consented. The account connects only as itself:
 * consent given as another user is stored as revoked, with the reason, and
 * the checklist item stays open. Connected, the item is done.
 */
export async function finishConnect(
  ctx: MutationCtx,
  account: Doc<'accounts'>,
  granted: { refreshToken: string; scopes: string[]; username: string; mock: boolean },
  now: number
): Promise<void> {
  if (granted.username.toLowerCase() !== account.handle.toLowerCase()) {
    const other = handleOf({ platform: account.platform, handle: granted.username })
    await revokeConnection(ctx, account, `You connected ${other}, not ${handleOf(account)}. Connect again as ${handleOf(account)}.`, now)
    return
  }
  const { refreshToken, scopes, username, mock } = granted
  await setStatus(ctx, account, { kind: 'connected', refreshToken, scopes, username, connectedAt: now }, mock)
  await closeItemsWith(ctx, account._id, 'connect_account', now)
}

/** The connection no longer reads, with the reason the operator reads, and the checklist asks to connect again. */
export async function revokeConnection(ctx: MutationCtx, account: Doc<'accounts'>, error: string, now: number): Promise<void> {
  await setStatus(ctx, account, { kind: 'revoked', error, at: now }, false)
  await openConnectItem(ctx, account, now)
}

/** The checklist item that asks to connect the account; one at a time, however often it is asked for. */
export async function openConnectItem(ctx: MutationCtx, account: Doc<'accounts'>, now: number): Promise<void> {
  if ((await openItemsWith(ctx, account._id, 'connect_account')).length > 0) return
  const label = placeLabel(placeOf(account))
  await ctx.db.insert('checklistItems', {
    accountId: account._id,
    title: `Connect your ${label} account`,
    why: `Influstep reads ${handleOf(account)}'s posts and the comments under them through ${label}'s API only once you let it. Until then they are steps you take by hand.`,
    status: 'open',
    action: { kind: 'connect_account' },
    createdAt: now,
  })
}
