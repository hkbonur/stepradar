import { api } from '@influstep/convex/_generated/api'
import type { Doc, Id } from '@influstep/convex/_generated/dataModel'
import {
  AGENT_ROLE_LABELS,
  JOB_KIND_LABELS,
  SPONSOR_SEGMENT_LABELS,
  letGo,
  textEditable,
  type MemoryKind,
  type Voice,
  SELF_PROMOTION_LABELS,
  communityLabel,
  fellBehind,
} from '@influstep/shared'
import { CaretRightIcon } from '@phosphor-icons/react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import type { FunctionReturnType } from 'convex/server'
import React from 'react'
import { ChecklistAction, ChecklistCheckbox } from '@/components/checklist-item'
import { AccountChat } from '@/components/account-chat'
import { AccountFrame } from '@/components/account-frame'
import { AccountSettings, ProfileCard } from '@/components/account-profile'
import { ResearchCard } from '@/components/account-research'
import { QueuedLine, useQueuedAction } from '@/components/queued-action'
import { JobDot, PostKindIcon, StatusPill } from '@/components/status'
import { Alert, Button, Card, CardList, Collapsible, Skeleton } from '@/components/ui'
import { cn } from '@/lib/cn'
import { formatCount, formatDate, formatDay, formatMoney, languageName, plural, relativeTime, todayKey } from '@/lib/format'
import { ideaLine } from '@/lib/ideas'

export const Route = createFileRoute('/accounts/$accountId')({ component: AccountPage })

type AccountData = NonNullable<FunctionReturnType<typeof api.private.accounts.get>>

type HeaderActionKey = 'plan' | 'metrics' | 'pause'

/**
 * The account's own numbers in its header, over the report's window: what it
 * earned, the paid conversions behind that, and its views, linked to its
 * report, so the operator does not have to open it to see if the account works.
 */
function AccountNumbers(props: { accountId: Id<'accounts'>; numbers: AccountData['numbers']; refresh: React.ReactNode }) {
  const { numbers } = props
  return (
    <span className="mt-1 flex flex-wrap items-center gap-x-2">
      <Link to="/reports/$accountId" params={{ accountId: props.accountId }} className="group w-fit">
        <span className="tabular font-medium text-ink">{formatMoney(numbers.value, numbers.currency)}</span>
        <span className="text-ash"> earned from </span>
        <span className="tabular text-graphite">{numbers.paid}</span>
        <span className="text-ash"> paid</span>
        {/* Reach only once some was read: a platform whose reader reads none shows no zero. */}
        {numbers.reach !== null && (
          <>
            <span className="text-ash"> · </span>
            <span className="tabular text-graphite">{formatCount(numbers.reach)}</span>
            <span className="text-ash"> {numbers.reachLabel.toLowerCase()}</span>
          </>
        )}
        <span className="text-ash group-hover:underline">
          , last {numbers.days} days{numbers.mock ? ' (mock)' : ''}
        </span>
      </Link>
      {props.refresh}
      {/* Whether it posts as planned (shared `fellBehind`): this week's due posts so far, and how many went out. */}
      {numbers.posting.due > 0 && (
        <span className={fellBehind(numbers.posting) ? 'text-signal-red-deep' : 'text-ash'}>
          · <span className="tabular">{numbers.posting.posted}</span> of <span className="tabular">{numbers.posting.due}</span> due this
          week posted
        </span>
      )}
    </span>
  )
}

/** Why nothing is coming up: the plan waits for a community the listener has not met (core/planner `planWaits`), or nothing is planned. */
function nothingComingUp(planWaits: string | null, posts: number): string {
  if (planWaits !== null) return planWaits
  return posts === 0 ? 'No posts yet. Plan this week.' : 'Nothing planned ahead. Plan this week.'
}

/** Past the day and done with: posted, measured or let go. Everything else is still ahead of the operator. */
function isEarlier(post: AccountData['posts'][number], today: string): boolean {
  if (post.plannedFor >= today) return false
  return !textEditable(post.status)
}

function AccountPage() {
  const params = Route.useParams()
  const accountId = params.accountId as Id<'accounts'>
  const data = useQuery(api.private.accounts.get, { accountId })
  const setPaused = useMutation(api.private.accounts.setPaused)
  const planWeek = useMutation(api.private.accounts.planWeek)
  const pullMetrics = useMutation(api.private.accounts.pullMetrics)
  const [settings, setSettings] = React.useState(false)
  const { state: action, run, busy } = useQueuedAction<HeaderActionKey>()
  const today = todayKey()

  if (data === null) return <p className="text-ash">This account does not exist.</p>
  const account = data?.account
  return (
    <AccountFrame
      accountId={accountId}
      tab="overview"
      lead={
        data !== undefined && (
          <AccountNumbers
            accountId={accountId}
            numbers={data.numbers}
            refresh={
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-1.5 text-ash hover:text-ink"
                busy={busy('metrics')}
                onClick={() => run('metrics', () => pullMetrics({ accountId }), 'Queued for the analyst: the numbers refresh shortly.')}
              >
                Refresh
              </Button>
            }
          />
        )
      }
      actions={
        account !== undefined && (
          <>
            <Button
              size="sm"
              busy={busy('plan')}
              onClick={() => run('plan', () => planWeek({ accountId }), "Queued for the writer: this week's plan shows on Today.")}
            >
              Plan this week
            </Button>
            <Button size="sm" variant="ghost" aria-expanded={settings} onClick={() => setSettings((value) => !value)}>
              {settings ? 'Close settings' : 'Settings'}
            </Button>
            <Button
              size="sm"
              variant={account.paused ? 'primary' : 'destructive'}
              busy={busy('pause')}
              onClick={() =>
                run(
                  'pause',
                  () => setPaused({ accountId, paused: !account.paused }),
                  account.paused ? `${account.name} is working again.` : `${account.name} is paused: nothing runs until you resume.`
                )
              }
            >
              {account.paused ? 'Resume' : 'Pause'}
            </Button>
          </>
        )
      }
    >
      <QueuedLine state={action} className="-mt-2 mb-4 empty:hidden" />
      {data === undefined && <Skeleton className="h-96 rounded-xl" />}
      {data !== undefined && (
        <>
          {settings && <AccountSettings account={data.account} onDone={() => setSettings(false)} />}
          <Overview data={data} today={today} />
        </>
      )}
    </AccountFrame>
  )
}

/**
 * The account at a glance, as cards in two columns: what waits on the
 * operator and what is coming up, then research and the communities met; the
 * chat, the account's pages in one line each, the profile and the jobs beside
 * them.
 */
function Overview(props: { data: AccountData; today: string }) {
  const { data } = props
  const { account } = data
  // Soonest first, so the next thing due leads; the past stays folded under it.
  const upcoming = data.posts.filter((post) => !isEarlier(post, props.today)).sort((a, b) => a.plannedFor.localeCompare(b.plannedFor))
  const earlier = data.posts.filter((post) => isEarlier(post, props.today))
  return (
    <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="min-w-0 space-y-6">
        <WaitsOnYou account={account} waiting={data.waiting} />
        <Card title="Coming up" count={upcoming.length} flush>
          {upcoming.length === 0 && <p className="card-x py-4 text-sm text-ash">{nothingComingUp(data.planWaits, data.posts.length)}</p>}
          {upcoming.length > 0 && <PostList posts={upcoming} />}
          {earlier.length > 0 && (
            <Collapsible summary="Earlier" count={earlier.length} inset className="border-t border-mist">
              <PostList posts={earlier} />
            </Collapsible>
          )}
        </Card>
        <ResearchCard accountId={account._id} />
        <CommunitiesCard account={account} communities={data.communities} />
      </div>
      <div className="min-w-0 space-y-6">
        <Card title="Chat">
          <div className="flex h-[30rem] flex-col">
            <AccountChat account={account} messages={data.messages} directives={data.directives} posts={data.posts} jobs={data.jobs} />
          </div>
        </Card>
        <AtAGlance account={account} replies={data.replies} />
        <ProfileCard account={account} bioLink={data.bioLink} />
        <JobsCard jobs={data.jobs} />
      </div>
    </div>
  )
}

/** The account's recent jobs, folded: a failure is the one thing in here worth opening for, so it shows on the closed summary. */
function JobsCard(props: { jobs: AccountData['jobs'] }) {
  if (props.jobs.length === 0) return null
  const failed = props.jobs.filter((job) => job.status === 'failed').length
  return (
    <Card>
      <Collapsible
        summary="Recent jobs"
        count={props.jobs.length}
        defaultOpen={failed > 0}
        meta={failed > 0 && <span className="text-signal-red-deep">{failed} failed</span>}
      >
        <ul className="space-y-1.5 font-mono text-[11px]">
          {props.jobs.map((job) => (
            <li key={job._id} className="flex items-center gap-2">
              <JobDot status={job.status} />
              <span className="text-graphite">{JOB_KIND_LABELS[job.kind]}</span>
              <span className="text-ash">{AGENT_ROLE_LABELS[job.role]}</span>
              <span className="ml-auto text-ash">{relativeTime(job.finishedAt ?? job.startedAt ?? job.createdAt)}</span>
            </li>
          ))}
        </ul>
      </Collapsible>
    </Card>
  )
}

/** An account's posts as rows: day, title, its first line (or when the writer gets to it), and its status. */
function PostList(props: { posts: AccountData['posts'] }) {
  return (
    <ol className="divide-y divide-mist">
      {props.posts.map((post) => (
        <li key={post._id} className={cn('card-x flex items-start gap-3 py-3', { 'opacity-60': letGo(post.status) })}>
          <span className="tabular w-14 shrink-0 pt-0.5 font-mono text-xs text-ash">
            {formatDay(post.plannedFor, { month: 'short', day: 'numeric' })}
          </span>
          <div className="min-w-0 flex-1">
            <Link to="/posts/$postId" params={{ postId: post._id }} className="flex items-center gap-1.5 font-medium hover:underline">
              <PostKindIcon kind={post.kind} className="shrink-0 text-graphite" />
              <span className="line-clamp-1">{post.title}</span>
            </Link>
            <p className="line-clamp-1 text-xs text-ash">
              {post.status === 'idea' ? ideaLine(post, post.writing) : post.hook || post.concept}
              {post.sponsorSegment !== 'none' && <> · {SPONSOR_SEGMENT_LABELS[post.sponsorSegment]}</>}
            </p>
            {post.error && <p className="mt-0.5 line-clamp-1 font-mono text-[11px] text-signal-red-deep">{post.error}</p>}
          </div>
          <StatusPill status={post.status} />
        </li>
      ))}
    </ol>
  )
}

/**
 * The communities the listener met, each as its platform writes it, with what
 * its rules say of self-promotion and why; nothing until the listener meets
 * one.
 */
function CommunitiesCard(props: { account: Doc<'accounts'>; communities: AccountData['communities'] }) {
  if (props.communities.length === 0) return null
  return (
    <Card title="Communities" count={props.communities.length} description="What each one's rules say of self-promotion." flush>
      <CardList>
        {props.communities.map((community) => (
          <li key={community.name} className="flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate font-medium">{communityLabel(props.account.platform, community.name)}</span>
            <span className="shrink-0 text-xs text-ash" title={community.reason}>
              {SELF_PROMOTION_LABELS[community.selfPromotion]}
            </span>
          </li>
        ))}
      </CardList>
    </Card>
  )
}

/**
 * The account's own pages, each with the one line that says whether it is
 * worth opening now: what waits in the replies, what is being tested, what the
 * account keeps, and its voice.
 */
function AtAGlance(props: { account: Doc<'accounts'>; replies: AccountData['replies'] }) {
  const accountId = props.account._id
  return (
    <Card title="At a glance" flush>
      <ul className="divide-y divide-mist text-sm">
        <PageRow to="/accounts/$accountId/replies" accountId={accountId} label="Replies">
          <RepliesLine replies={props.replies} />
        </PageRow>
        <PageRow to="/accounts/$accountId/strategy" accountId={accountId} label="Strategy">
          <StrategyLine account={props.account} />
        </PageRow>
        <PageRow to="/accounts/$accountId/memory" accountId={accountId} label="Memory">
          <MemoryLine accountId={accountId} />
        </PageRow>
        <PageRow to="/accounts/$accountId/voice" accountId={accountId} label="Voice">
          {props.account.voice ? voiceSummary(props.account.voice) : <span className="text-alert-amber-deep">Not learned yet</span>}
        </PageRow>
      </ul>
    </Card>
  )
}

function PageRow(props: {
  to: '/accounts/$accountId/replies' | '/accounts/$accountId/strategy' | '/accounts/$accountId/memory' | '/accounts/$accountId/voice'
  accountId: Id<'accounts'>
  label: string
  children: React.ReactNode
}) {
  return (
    <li>
      <Link
        to={props.to}
        params={{ accountId: props.accountId }}
        className="group card-x flex items-baseline gap-3 py-2.5 outline-none hover:bg-paper-tint focus-visible:bg-paper-tint"
      >
        <span className="w-20 shrink-0 font-medium">{props.label}</span>
        <span className="min-w-0 flex-1 truncate text-right text-xs text-ash">{props.children}</span>
        <CaretRightIcon aria-hidden size={12} className="shrink-0 self-center text-smoke group-hover:text-ink" />
      </Link>
    </li>
  )
}

/** What waits for the operator, in amber like every other count that waits on them, and today's budget. */
function RepliesLine(props: { replies: AccountData['replies'] }) {
  const replies = props.replies
  if (replies.budget === 0) return <>Off: the budget is 0</>
  return (
    <>
      {replies.waiting > 0 && <span className="tabular text-alert-amber-deep">{replies.waiting} waiting · </span>}
      {replies.beingWritten > 0 && <span className="tabular">{replies.beingWritten} being written · </span>}
      <span className="tabular">
        {replies.draftedToday} of {replies.budget} drafted today
      </span>
    </>
  )
}

/** What the account tests now; when it was last reviewed is on hover, the strategy page says it in full. */
function StrategyLine(props: { account: Doc<'accounts'> }) {
  const experiments = useQuery(api.private.experiments.list, { accountId: props.account._id })
  // The strategy review keeps one experiment running per account, so the first running one is the one.
  const running = experiments?.find((experiment) => experiment.status === 'running')
  const reviewedAt = props.account.strategy?.reviewedAt
  if (experiments === undefined) return <Skeleton className="ml-auto h-3 w-32" />
  return (
    <span title={reviewedAt === undefined ? 'Not reviewed yet' : `Reviewed ${formatDate(reviewedAt)}`}>
      {running ? `Testing ${running.name}` : 'Nothing being tested'}
    </span>
  )
}

/** How many rules, facts and learnings the account holds. */
function MemoryLine(props: { accountId: Id<'accounts'> }) {
  const memory = useQuery(api.private.memory.list, { accountId: props.accountId })
  if (memory === undefined) return <Skeleton className="ml-auto h-3 w-32" />
  if (memory === null) return null
  const active = memory.entries.filter((entry) => entry.status === 'active')
  const count = (kind: MemoryKind, one: string, other: string) => {
    const n = active.filter((entry) => entry.kind === kind).length
    return n === 0 ? [] : [`${n} ${plural(n, one, other)}`]
  }
  const counts = [...count('rule', 'rule', 'rules'), ...count('fact', 'fact', 'facts'), ...count('learning', 'learning', 'learnings')]
  return <>{counts.length === 0 ? 'Nothing kept yet' : counts.join(', ')}</>
}

/** The voice row: how many posts the analyst read and the language it writes in. */
function voiceSummary(voice: Voice): string {
  const name = languageName(voice.language)
  // A tag the browser cannot name still says which language it is, so it shows as written.
  const language = name === null ? voice.language : name
  return `Learned from ${voice.sampleSize} posts, ${language}`
}

/**
 * What waits on the operator for this account (core `waitingOn`), soonest
 * first: drafts to post and failed posts, the replies to post, and the open
 * checklist items.
 */
function WaitsOnYou(props: { account: Doc<'accounts'>; waiting: AccountData['waiting'] }) {
  const { drafts, failed, replyDrafts, checklist } = props.waiting
  const posts = [...drafts, ...failed].sort((a, b) => a.scheduledAt - b.scheduledAt)
  const count = posts.length + replyDrafts + checklist.length
  if (count === 0) {
    return (
      <Alert tone="success" title="Nothing waits on you">
        {props.account.name} is working on its own.
      </Alert>
    )
  }
  return (
    <Card title="Waits on you" count={count} flush>
      <CardList>
        {posts.map((post) => (
          <li key={post._id} className="flex items-start gap-2.5">
            <StatusPill status={post.status} />
            <Link to="/posts/$postId" params={{ postId: post._id }} className="min-w-0 leading-snug font-medium hover:underline">
              <span className="line-clamp-2">{post.title}</span>
              <span className="block text-xs font-normal text-ash">
                Due {formatDay(post.plannedFor, { weekday: 'short', month: 'short', day: 'numeric' })}
              </span>
            </Link>
          </li>
        ))}
        {replyDrafts > 0 && (
          <li>
            <Link to="/accounts/$accountId/replies" params={{ accountId: props.account._id }} className="font-medium hover:underline">
              <span className="tabular">{replyDrafts}</span> {plural(replyDrafts, 'reply', 'replies')} to post
            </Link>
          </li>
        )}
        {checklist.map((item) => (
          <ChecklistRow key={item._id} item={item} />
        ))}
      </CardList>
    </Card>
  )
}

function ChecklistRow(props: { item: Pick<Doc<'checklistItems'>, '_id' | 'accountId' | 'title' | 'why' | 'action' | 'createdAt'> }) {
  return (
    <li className="flex items-start gap-2.5">
      <ChecklistCheckbox item={props.item} className="mt-1 size-3.5" />
      <div className="min-w-0 flex-1">
        <p className="leading-snug font-medium">{props.item.title}</p>
        {/* Two lines are enough to know what to do; the Checklist page has the rest. */}
        <p className="mt-0.5 line-clamp-2 text-xs text-ash" title={props.item.why}>
          {props.item.why}
        </p>
        {props.item.action && (
          <div className="mt-2 flex gap-2">
            <ChecklistAction item={props.item} />
          </div>
        )}
      </div>
    </li>
  )
}
