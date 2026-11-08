import { AGENT_ROLES, isChatTask, type AgentRole, type JobKind, type JobStatus } from '@influstep/shared'
import type { Doc, Id } from '../_generated/dataModel'
import { query, type QueryCtx } from '../_generated/server'
import { accountRefOf, type AccountRef } from '../core/accounts'

/**
 * The Agents page: three workspace workers, one per role, each serving every
 * account from its own queue. A row per role shows
 * what it is on now, what waits next, and what it finished last.
 */

/** How many queued and how many finished jobs a role's row lists. */
const ROW_JOBS = 5

export interface AgentJobRow {
  _id: Id<'jobs'>
  kind: JobKind
  status: JobStatus
  account: AccountRef
  post: { _id: Id<'posts'>; title: string } | null
  /** What the job was asked to do in words: a task's topic, else the chat message that asked for it. */
  brief: string | null
  createdAt: number
  startedAt?: number
  finishedAt?: number
  error?: string
}

export interface AgentRow {
  role: AgentRole
  running: AgentJobRow[]
  queued: { count: number; next: AgentJobRow[] }
  recent: AgentJobRow[]
}

export interface AgentBoard {
  /** One row per role, in AGENT_ROLES order. */
  roles: AgentRow[]
}

export const board = query({
  args: {},
  handler: async (ctx): Promise<AgentBoard> => {
    const rowsOf = jobRows(ctx)
    const roles: AgentRow[] = []
    for (const role of AGENT_ROLES) {
      const running = await jobsOf(ctx, role, 'running').collect()
      const queued = await jobsOf(ctx, role, 'queued').collect()
      // The newest by creation of each finished status, merged by when they finished.
      const done = await jobsOf(ctx, role, 'done').order('desc').take(ROW_JOBS)
      const failed = await jobsOf(ctx, role, 'failed').order('desc').take(ROW_JOBS)
      const recent = [...done, ...failed].sort((a, b) => finishedAtOf(b) - finishedAtOf(a)).slice(0, ROW_JOBS)
      roles.push({
        role,
        running: await rowsOf(running.sort((a, b) => a.createdAt - b.createdAt)),
        queued: { count: queued.length, next: await rowsOf(queued.sort((a, b) => a.createdAt - b.createdAt).slice(0, ROW_JOBS)) },
        recent: await rowsOf(recent),
      })
    }
    return { roles }
  },
})

function jobsOf(ctx: QueryCtx, role: AgentRole, status: JobStatus) {
  return ctx.db.query('jobs').withIndex('by_role_status', (q) => q.eq('role', role).eq('status', status))
}

/** A finished job always has finishedAt (jobs/queue.ts sets it on done and on failed); one without it is a bug. */
function finishedAtOf(job: Doc<'jobs'>): number {
  if (job.finishedAt === undefined) throw new Error(`job ${job._id} is ${job.status} without finishedAt`)
  return job.finishedAt
}

/**
 * Builds rows, reading each account and post once however many jobs name
 * it. Accounts, posts and messages are never deleted outside a full reset,
 * so a job that names a missing one is a bug.
 */
function jobRows(ctx: QueryCtx): (jobs: Doc<'jobs'>[]) => Promise<AgentJobRow[]> {
  const accounts = new Map<Id<'accounts'>, Doc<'accounts'>>()
  const posts = new Map<Id<'posts'>, Doc<'posts'>>()

  async function accountOf(accountId: Id<'accounts'>): Promise<Doc<'accounts'>> {
    const cached = accounts.get(accountId)
    if (cached) return cached
    const account = await ctx.db.get(accountId)
    if (!account) throw new Error(`account ${accountId} not found`)
    accounts.set(accountId, account)
    return account
  }

  async function postOf(postId: Id<'posts'>): Promise<Doc<'posts'>> {
    const cached = posts.get(postId)
    if (cached) return cached
    const post = await ctx.db.get(postId)
    if (!post) throw new Error(`post ${postId} not found`)
    posts.set(postId, post)
    return post
  }

  /** A chat task's topic, or the operator's message when it named none. Every other job has no brief. */
  async function briefOf(job: Doc<'jobs'>): Promise<string | null> {
    if (!isChatTask(job.kind)) return null
    if (job.topic !== undefined) return job.topic
    if (job.messageId === undefined) return null
    const message = await ctx.db.get(job.messageId)
    if (!message) throw new Error(`message ${job.messageId} of job ${job._id} not found`)
    return message.text
  }

  async function rowOf(job: Doc<'jobs'>): Promise<AgentJobRow> {
    const account = await accountOf(job.accountId)
    const post = job.postId === undefined ? null : await postOf(job.postId)
    return {
      _id: job._id,
      kind: job.kind,
      status: job.status,
      account: accountRefOf(account),
      post: post === null ? null : { _id: post._id, title: post.title },
      brief: await briefOf(job),
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      error: job.error,
    }
  }

  return async (jobs) => {
    const rows: AgentJobRow[] = []
    for (const job of jobs) rows.push(await rowOf(job))
    return rows
  }
}
