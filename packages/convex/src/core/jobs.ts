import type { JobStatus } from '@influstep/shared'
import type { Id } from '../_generated/dataModel'
import type { QueryCtx } from '../_generated/server'

type Reader = { db: QueryCtx['db'] }

/** A job in one of these statuses means one of the account's agents is at work. */
const ACTIVE_JOB_STATUSES = ['queued', 'running'] as const satisfies readonly JobStatus[]

/**
 * The accounts with a job queued or running. The roster and the account page
 * both read it here, so the sidebar and the page header never disagree. It
 * goes through the status index, because the jobs table keeps every finished
 * job forever and only the active ones are few.
 */
export async function workingAccountIds(ctx: Reader): Promise<Set<Id<'accounts'>>> {
  const ids = new Set<Id<'accounts'>>()
  for (const status of ACTIVE_JOB_STATUSES) {
    const jobs = await ctx.db
      .query('jobs')
      .withIndex('by_status', (q) => q.eq('status', status))
      .collect()
    for (const job of jobs) {
      // A job may belong to no account; it keeps nobody busy.
      ids.add(job.accountId)
    }
  }
  return ids
}
