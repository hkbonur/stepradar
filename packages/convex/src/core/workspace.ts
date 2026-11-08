import type { Doc } from '../_generated/dataModel'
import type { QueryCtx } from '../_generated/server'
import { refusal } from '../lib/errors'

/**
 * The one workspace today. Every handler that needs the sponsor, the app URL
 * or the value per paid conversion reads it through here, so a missing
 * workspace fails with one message everywhere. The studio's first-run setup
 * makes it (private/workspace.ts `create`).
 */

type Reader = { db: QueryCtx['db'] }

/** The single workspace, for handlers that start from nothing (the Providers page, creating an account). */
export async function requireWorkspace(ctx: Reader): Promise<Doc<'workspaces'>> {
  const workspace = await ctx.db.query('workspaces').first()
  if (!workspace) throw refusal('Set up your product first: the studio asks for it on the first run.')
  return workspace
}

/** The workspace an account belongs to. */
export async function workspaceOf(ctx: Reader, account: Doc<'accounts'>): Promise<Doc<'workspaces'>> {
  const workspace = await ctx.db.get(account.workspaceId)
  if (!workspace) throw new Error(`workspace ${account.workspaceId} of account ${account._id} not found`)
  return workspace
}
