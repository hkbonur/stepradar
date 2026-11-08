import { api } from '@influstep/convex/_generated/api'
import type { Id } from '@influstep/convex/_generated/dataModel'
import { AGENT_ROLE_LABELS, JOB_KIND_LABELS, type JobStatus } from '@influstep/shared'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import type { FunctionReturnType } from 'convex/server'
import React from 'react'
import { AccountMark, accountState } from '@/components/account-mark'
import { JobDot } from '@/components/status'
import { Button, ErrorLine, PageHeader, Skeleton, Spinner } from '@/components/ui'
import { AGENTS_IN_WORDS } from '@/lib/agents'
import { cn } from '@/lib/cn'
import { errorMessage } from '@/lib/errors'
import { formatElapsed, relativeTime } from '@/lib/format'
import { useNow } from '@/lib/use-now'

export const Route = createFileRoute('/agents')({ component: AgentsPage })

type Board = FunctionReturnType<typeof api.private.agents.board>
type Agent = Board['roles'][number]
type JobRow = Agent['running'][number]
type AccountRow = FunctionReturnType<typeof api.private.accounts.list>[number]
type Roster = Map<Id<'accounts'>, AccountRow>

/** A running duration only moves by the minute, so the page reads the clock twice a minute. */
const CLOCK_MS = 30_000

/**
 * The workspace's agents (CONTEXT.md, Agent), one card per role in the
 * order work flows: what each is doing now, what waits in its queue, and what
 * it finished last. The cards stack, never a grid, so the eye runs down the
 * roles and stops where something runs or waits.
 */
function AgentsPage() {
  const board = useQuery(api.private.agents.board, {})
  // The roster the sidebar already holds: whether an account works or is paused, so its mark here matches the sidebar.
  const accounts = useQuery(api.private.accounts.list, {})
  const now = useNow(CLOCK_MS)
  return (
    <>
      <PageHeader title="Agents" lead={`${AGENTS_IN_WORDS} serve every account, each from its own queue.`} />
      <AgentList board={board} accounts={accounts} now={now} />
    </>
  )
}

function AgentList(props: { board: Board | undefined; accounts: AccountRow[] | undefined; now: number }) {
  if (props.board === undefined || props.accounts === undefined) return <Skeleton className="h-96 rounded-xl" />
  const roster: Roster = new Map(props.accounts.map((account) => [account._id, account]))
  return (
    <div className="space-y-4">
      {props.board.roles.map((agent) => (
        <AgentSection key={agent.role} agent={agent} roster={roster} now={props.now} />
      ))}
    </div>
  )
}

/**
 * One role: its name and state on the left (above on narrow screens), the
 * running jobs on a warm wash, then Next and Last side by side. Running work is
 * the one thing drawn at full weight, so it is what the eye finds first.
 */
function AgentSection(props: { agent: Agent; roster: Roster; now: number }) {
  const agent = props.agent
  const headingId = React.useId()
  const more = agent.queued.count - agent.queued.next.length
  return (
    <section aria-labelledby={headingId} className="surface card-pad grid gap-x-8 gap-y-4 lg:grid-cols-[12rem_minmax(0,1fr)]">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 lg:flex-col lg:justify-start">
        <h2 id={headingId} className="text-title">
          {AGENT_ROLE_LABELS[agent.role]}
        </h2>
        <StateLine running={agent.running.length} />
      </header>
      <div className="grid min-w-0 gap-5">
        {agent.running.length > 0 && (
          <ul aria-label="Running" className="divide-y divide-mist rounded-lg bg-paper-warm px-3">
            {agent.running.map((job) => (
              <li key={job._id} className="flex items-start gap-3 py-2.5">
                <JobSummary job={job} roster={props.roster} strong />
                <JobTime status="running">{runningWords(job, props.now)}</JobTime>
              </li>
            ))}
          </ul>
        )}
        {/* An empty queue is already said by the state line, so Next shows only when something waits in it. */}
        <div className={cn('grid gap-x-8 gap-y-5', { 'md:grid-cols-2': agent.queued.count > 0 })}>
          {agent.queued.count > 0 && (
            <JobGroup title="Next" count={agent.queued.count}>
              <ul className="divide-y divide-mist">
                {agent.queued.next.map((job) => (
                  <li key={job._id} className="flex items-start gap-3 py-2">
                    <JobSummary job={job} roster={props.roster} />
                    <JobTime status="queued">Queued {ago(job.createdAt, props.now)}</JobTime>
                  </li>
                ))}
              </ul>
              {more > 0 && (
                <p className="pt-1 text-xs text-ash">
                  <span className="tabular">{more}</span> more in the queue
                </p>
              )}
            </JobGroup>
          )}
          <JobGroup title="Last">
            {agent.recent.length === 0 && <p className="py-2 text-ash">Nothing finished yet.</p>}
            {agent.recent.length > 0 && (
              <ul className="divide-y divide-mist">
                {agent.recent.map((job) => (
                  <FinishedJob key={job._id} job={job} roster={props.roster} now={props.now} />
                ))}
              </ul>
            )}
          </JobGroup>
        </div>
      </div>
    </section>
  )
}

/** The role's state in words, with a dot: blue at work, fog at rest. */
function StateLine(props: { running: number }) {
  const working = props.running > 0
  return (
    <p className="flex items-center gap-2 text-sm text-graphite">
      <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', working ? 'bg-note-blue' : 'bg-fog')} />
      {working ? `Working on ${props.running}` : 'Idle'}
    </p>
  )
}

function JobGroup(props: { title: string; count?: number; children: React.ReactNode }) {
  const headingId = React.useId()
  return (
    <section aria-labelledby={headingId} className="min-w-0">
      <h3 id={headingId} className="flex items-baseline gap-1.5 border-b border-mist pb-1.5 text-xs font-medium text-graphite">
        {props.title}
        {props.count !== undefined && <span className="tabular font-mono text-[11px] text-ash">{props.count}</span>}
      </h3>
      {props.children}
    </section>
  )
}

/**
 * What a job is and whom it serves: the kind, the account, the post it
 * works on, and the brief a chat task came with. `strong` draws a running job
 * at full weight; queued and finished ones stay a step quieter.
 */
function JobSummary(props: { job: JobRow; roster: Roster; strong?: boolean; children?: React.ReactNode }) {
  const job = props.job
  return (
    <div className="flex min-w-0 flex-1 items-start gap-2.5">
      <JobMark account={job.account} roster={props.roster} />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-1.5">
          <span className={cn({ 'font-medium text-ink': props.strong, 'text-graphite': !props.strong })}>{JOB_KIND_LABELS[job.kind]}</span>
          {job.account !== null && (
            <span className="text-ash">
              for{' '}
              <Link
                to="/accounts/$accountId"
                params={{ accountId: job.account._id }}
                className="text-graphite hover:text-ink hover:underline"
              >
                {job.account.name}
              </Link>
            </span>
          )}
        </p>
        {job.post !== null && (
          <Link
            to="/posts/$postId"
            params={{ postId: job.post._id }}
            className="line-clamp-1 text-xs text-graphite hover:text-ink hover:underline"
          >
            {job.post.title}
          </Link>
        )}
        {job.brief !== null && <p className="line-clamp-2 text-xs text-ash">“{job.brief}”</p>}
        {props.children}
      </div>
    </div>
  )
}

/**
 * The account a job serves, as its 20px account mark. Its state comes from
 * the roster, the same answer the sidebar draws, and a paused account is fog
 * here too. An account that left the roster after the job was queued has
 * nothing to say it works, so it rests.
 */
function JobMark(props: { account: JobRow['account']; roster: Roster }) {
  const row = props.roster.get(props.account._id)
  return (
    <AccountMark platform={props.account.platform} size={20} state={row === undefined ? 'idle' : accountState(row)} className="mt-px" />
  )
}

/** A job's status dot and when it last moved, in the Job state line's words and type (DESIGN.md, Job state). */
function JobTime(props: { status: JobStatus; children: React.ReactNode }) {
  return (
    <p className="flex shrink-0 items-center gap-1.5 pt-0.5 font-mono text-[11px] whitespace-nowrap text-ash">
      <JobDot status={props.status} />
      {props.children}
    </p>
  )
}

function runningWords(job: JobRow, now: number): string {
  // The queue stamps startedAt as a job starts; without the stamp there is no honest duration to show.
  if (job.startedAt === undefined) return 'Running'
  return `Running for ${formatElapsed(now - job.startedAt)}`
}

function finishedWords(job: JobRow, now: number): string {
  const word = job.status === 'failed' ? 'Failed' : 'Done'
  // The queue stamps finishedAt as a job ends; without the stamp the word stands alone.
  if (job.finishedAt === undefined) return word
  return `${word} ${ago(job.finishedAt, now)}`
}

/**
 * When a job moved, against the page's clock. The clock ticks every 30
 * seconds and the backend pushes in between, so a job can be newer than the
 * clock; it reads "now" then, never "in 12 seconds".
 */
function ago(at: number, now: number): string {
  return relativeTime(at, Math.max(now, at))
}

/**
 * Retry queues a new job and leaves this failed one in the history. The
 * button stays and is never disabled, so focus is not dropped: while the
 * retry is out it is aria-busy with a spinner and ignores a second click. A
 * line beside it then says the job is queued again; the new job shows under
 * Next.
 */
type RetryState = { status: 'idle' } | { status: 'retrying' } | { status: 'retried' } | { status: 'error'; message: string }

function FinishedJob(props: { job: JobRow; roster: Roster; now: number }) {
  const retry = useMutation(api.private.jobs.retry)
  const [state, setState] = React.useState<RetryState>({ status: 'idle' })
  const job = props.job
  const failed = job.status === 'failed'
  const retrying = state.status === 'retrying'
  const again = async () => {
    // A second click while the first is out would queue the job twice.
    if (retrying) return
    setState({ status: 'retrying' })
    try {
      await retry({ jobId: job._id })
      setState({ status: 'retried' })
    } catch (caught) {
      setState({ status: 'error', message: errorMessage(caught) })
    }
  }
  const retryName =
    job.account === null ? `Retry ${JOB_KIND_LABELS[job.kind]}` : `Retry ${JOB_KIND_LABELS[job.kind]} for ${job.account.name}`
  return (
    <li className="flex items-start gap-3 py-2">
      <JobSummary job={job} roster={props.roster}>
        {failed && job.error !== undefined && (
          <p className="mt-0.5 line-clamp-3 font-mono text-[11px] break-words text-signal-red-deep">{job.error}</p>
        )}
        {/* Stays mounted, so a refused retry is announced as it appears. */}
        <div aria-live="polite">
          {state.status === 'error' && (
            <div className="mt-1.5">
              <ErrorLine>{state.message}</ErrorLine>
            </div>
          )}
        </div>
      </JobSummary>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <JobTime status={job.status}>{finishedWords(job, props.now)}</JobTime>
        {failed && (
          <div className="flex items-center">
            {/* Stays mounted and in the tree while empty, so "Queued again" is announced as it appears. */}
            <span aria-live="polite" className="text-xs text-ash">
              {state.status === 'retried' && <span className="mr-2">Queued again</span>}
            </span>
            <Button size="sm" aria-label={retryName} aria-busy={retrying} onClick={() => void again()}>
              {retrying && <Spinner />}
              Retry
            </Button>
          </div>
        )}
      </div>
    </li>
  )
}
