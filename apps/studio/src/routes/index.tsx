import { api } from '@influstep/convex/_generated/api'
import { Link, Navigate, createFileRoute, useRouter } from '@tanstack/react-router'
import { useQuery } from 'convex/react'
import React from 'react'
import { z } from 'zod'
import { ArrowRightIcon, ArrowSquareOutIcon } from '@phosphor-icons/react'
import { AccountLabel } from '@/components/account-mark'
import { CommentRow } from '@/components/comment-row'
import { HomeOverview } from '@/components/home-overview'
import { NotificationList } from '@/components/notification-list'
import { PostCard } from '@/components/post-card'
import { ReplyEditor } from '@/components/reply-editor'
import { Alert, Card, Empty, LinkButton, PageHeader, Skeleton, TabNav } from '@/components/ui'
import { WeekStrip } from '@/components/week-strip'
import { cn } from '@/lib/cn'
import { formatDay, plural, todayKey, weekStart } from '@/lib/format'
import { useNow } from '@/lib/use-now'
import { useStableQuery } from '@/lib/use-stable-query'

/** Today's lists, each a tab: the comments waiting, the reply drafts, the posts due today. */
const TABS = ['comments', 'replies', 'due'] as const
type TodayTab = (typeof TABS)[number]

const searchSchema = z.object({
  week: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  tab: z.enum(TABS).optional(),
})

export const Route = createFileRoute('/')({ component: TodayPage, validateSearch: searchSchema })

/** How often Today reads its clock again, so the day and the drafts' freshness keep up while the page stays open. */
const TODAY_CLOCK_MS = 60_000

/** The step Today's query moves its clock by: an hour keeps the drafts' freshness current, and a new day shows within it. */
const TODAY_STEP_MS = 3_600_000

type TodayView = NonNullable<ReturnType<typeof useStableQuery<typeof api.private.today.view>>>

/** The tab Today opens on without one in the address: the first list with something in it, comments first. */
function firstTab(today: TodayView): TodayTab {
  if (today.comments.total > 0) return 'comments'
  if (today.drafts.total > 0) return 'replies'
  return 'due'
}

/**
 * Today (docs/plan.md, "Studio screens"): what the operator does next, from
 * the top. Failures and the checklist as alerts; then the comments that wait
 * for an answer, the reply drafts that deserve the next minute most and the
 * posts due today, one tab each, every item its own card; beside them the
 * next steps and how the accounts are doing; under them the week.
 */
function TodayPage() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const accounts = useQuery(api.private.accounts.list, {})
  const now = useNow(TODAY_CLOCK_MS)
  // The last answer stays while the next hour's loads, so nothing the operator is editing unmounts.
  const today = useStableQuery(api.private.today.view, { now: Math.floor(now / TODAY_STEP_MS) * TODAY_STEP_MS })
  const [status, setStatus] = React.useState<string | null>(null)
  const statusRef = React.useRef<HTMLParagraphElement>(null)
  const week = search.week ?? weekStart(todayKey())
  const onDone = (message: string) => {
    setStatus(message)
    statusRef.current?.focus()
  }

  // The first run has no roster: Today has nothing to show, so the operator builds one first.
  if (accounts !== undefined && accounts.length === 0) return <Navigate to="/onboarding" search={{ first: true }} replace />

  return (
    <>
      <PageHeader title="Today" lead={formatDay(todayKey(), { weekday: 'long', month: 'long', day: 'numeric' })} />
      <p ref={statusRef} tabIndex={-1} aria-live="polite" className={cn('text-sm outline-none', { 'mb-4': status !== null })}>
        {status}
      </p>
      {today === undefined && <Skeleton className="h-96 rounded-xl" />}
      {today !== undefined && <Alerts today={today} />}
      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-4">
          {today !== undefined && <Inbox today={today} tab={search.tab ?? firstTab(today)} onDone={onDone} />}
        </div>
        {/* These read their own queries, so they show without waiting for Today's. */}
        <aside aria-label="How the accounts are doing" className="space-y-4">
          {today !== undefined && <NextSteps steps={today.nextSteps} />}
          <HomeOverview />
          <NotificationList />
        </aside>
      </div>
      <div className="mt-6">
        <WeekStrip
          week={week}
          onWeek={(next) => navigate({ search: (prev) => ({ ...prev, week: next === weekStart(todayKey()) ? undefined : next }) })}
        />
      </div>
    </>
  )
}

/** What went wrong and what only the operator can do, above everything else: failed posts in red, the checklist in amber. */
function Alerts(props: { today: TodayView }) {
  const { failed, checklist } = props.today
  if (failed.length === 0 && checklist === 0) return null
  return (
    <div className="mb-6 space-y-3">
      {failed.length > 0 && (
        <Alert tone="danger" title={`${failed.length} ${plural(failed.length, 'post failed', 'posts failed')}`}>
          <ul className="mt-1 space-y-1">
            {failed.map((post) => (
              <li key={post._id} className="min-w-0">
                <Link to="/posts/$postId" params={{ postId: post._id }} className="font-medium underline decoration-fog underline-offset-2">
                  {post.title}
                </Link>
                {post.error && <span className="ml-2 font-mono text-xs text-signal-red-deep">{post.error}</span>}
              </li>
            ))}
          </ul>
        </Alert>
      )}
      {checklist > 0 && (
        <Alert
          tone="warning"
          title={`${checklist} ${plural(checklist, 'checklist item waits', 'checklist items wait')} on you`}
          action={
            <LinkButton to="/checklist" size="sm">
              Open the checklist
            </LinkButton>
          }
        >
          Steps only you can take: connections, keys, links to paste.
        </Alert>
      )}
    </div>
  )
}

/** The three lists that wait on the operator, one tab each; every panel stays mounted, so a half-edited draft survives a tab switch. */
function Inbox(props: { today: TodayView; tab: TodayTab; onDone: (message: string) => void }) {
  const { comments, drafts, due } = props.today
  const tabLink = (tab: TodayTab) => ({ to: '/' as const, search: (prev: z.infer<typeof searchSchema>) => ({ ...prev, tab }) })
  return (
    <>
      <TabNav
        label="What waits on you"
        items={[
          { key: 'comments', label: 'Comments', count: comments.total, current: props.tab === 'comments', link: tabLink('comments') },
          { key: 'replies', label: 'Replies to post', count: drafts.total, current: props.tab === 'replies', link: tabLink('replies') },
          { key: 'due', label: 'Due today', count: due.length, current: props.tab === 'due', link: tabLink('due') },
        ]}
      />
      <div hidden={props.tab !== 'comments'} className="space-y-3">
        {comments.total === 0 && <Empty>No comment waits for an answer. A new one shows here and on your devices.</Empty>}
        {comments.shown.map((row) => (
          <CommentRow key={row.comment._id} row={row} onDone={props.onDone} />
        ))}
        {comments.total > comments.shown.length && (
          <p className="text-xs text-ash">
            The {comments.shown.length} closest to going cold; {comments.total - comments.shown.length} more wait after them.
          </p>
        )}
      </div>
      <div hidden={props.tab !== 'replies'} className="space-y-3">
        {drafts.total === 0 && <Empty>No reply draft waits. The listener looks for threads every hour.</Empty>}
        {drafts.shown.map((row) => (
          <ReplyEditor
            key={row.reply._id}
            reply={row.reply}
            place={row.account}
            heading={
              <Link to="/accounts/$accountId/replies" params={{ accountId: row.account._id }} className="hover:underline">
                <AccountLabel platform={row.account.platform} name={row.account.name} />
              </Link>
            }
            onDone={props.onDone}
          />
        ))}
        {drafts.total > drafts.shown.length && (
          <p className="text-xs text-ash">
            The {drafts.shown.length} fittest and freshest; {drafts.total - drafts.shown.length} more wait on the accounts' replies pages.
          </p>
        )}
      </div>
      <div hidden={props.tab !== 'due'}>
        {due.length === 0 && <Empty>No post is due today.</Empty>}
        <div className="grid gap-3 empty:hidden sm:grid-cols-2">
          {due.map((post) => (
            <PostCard key={post._id} post={post} />
          ))}
        </div>
      </div>
    </>
  )
}

/** At most three things worth doing next (core/steps.ts), each linked to where it is done. */
function NextSteps(props: { steps: TodayView['nextSteps'] }) {
  return (
    <Card title="Next steps" count={props.steps.length} flush>
      {props.steps.length === 0 && (
        <p className="card-x py-4 text-sm text-ash">Nothing more to do now. The steps come from the numbers as they move.</p>
      )}
      <ol className="divide-y divide-mist empty:hidden">
        {props.steps.map((step) => (
          <li key={`${step.kind}-${step.accountId}`}>
            <NextStepLink step={step} />
          </li>
        ))}
      </ol>
    </Card>
  )
}

type NextStep = TodayView['nextSteps'][number]

/** A next step, linked to where it is done: a page of the studio, opened in place, or the thread on its platform, in a new tab. */
function NextStepLink(props: { step: NextStep }) {
  const { step } = props
  const router = useRouter()
  const inStudio = step.url.startsWith('/')
  const open = (event: React.MouseEvent) => {
    if (!inStudio) return
    event.preventDefault()
    void router.navigate({ href: step.url })
  }
  return (
    <a
      href={step.url}
      onClick={open}
      {...(inStudio ? {} : { target: '_blank', rel: 'noreferrer' })}
      className="flex items-start gap-3 card-x py-3 text-sm outline-none hover:bg-paper-tint focus-visible:bg-paper-tint"
    >
      <span className="min-w-0 flex-1">{step.text}</span>
      {inStudio ? (
        <ArrowRightIcon aria-hidden size={14} className="mt-[3px] shrink-0 text-ash" />
      ) : (
        <ArrowSquareOutIcon aria-hidden size={14} className="mt-[3px] shrink-0 text-ash" />
      )}
    </a>
  )
}
