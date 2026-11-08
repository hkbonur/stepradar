import { api } from '@influstep/convex/_generated/api'
import type { Doc, Id } from '@influstep/convex/_generated/dataModel'
import {
  CONVERSION_KIND_LABELS,
  JOB_KIND_LABELS,
  METRIC_LABELS,
  SIGNAL_SOURCE_LABELS,
  VALUE_LABEL,
  canApply,
  placeOf,
  postedItemOf,
  textEditable,
  wentOut,
  type ItemRead,
  type Posted,
  placeLabel,
  type PlatformPlace,
  countsSource,
  ENGAGEMENTS,
  ENGAGEMENT_QUESTIONS,
  engages,
  missingReasons,
} from '@influstep/shared'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import React from 'react'
import { numbersOf } from '@/components/item-numbers'
import { PostEditor } from '@/components/post-editor'
import { JobDot, PostKindIcon, PostShape, SponsorPill, StatusPill } from '@/components/status'
import {
  Alert,
  AttributionNote,
  Button,
  Card,
  CardList,
  Collapsible,
  ErrorLine,
  Input,
  MockNote,
  PageHeader,
  Skeleton,
} from '@/components/ui'
import { errorMessage } from '@/lib/errors'
import { formatCount, formatDay, formatKnown, formatMoney, relativeTime } from '@/lib/format'
import { ideaLine } from '@/lib/ideas'

export const Route = createFileRoute('/posts/$postId')({ component: PostPage })

function PostPage() {
  const params = Route.useParams()
  const postId = params.postId as Id<'posts'>
  const data = useQuery(api.private.posts.get, { postId })
  const kill = useMutation(api.private.posts.kill)
  const skip = useMutation(api.private.posts.skip)
  const rewrite = useMutation(api.private.posts.rewrite)
  const retry = useMutation(api.private.posts.retry)
  const reschedule = useMutation(api.private.posts.reschedule)
  const retryJob = useMutation(api.private.jobs.retry)
  const [error, setError] = React.useState<string | null>(null)
  const [day, setDay] = React.useState<string | null>(null)

  if (data === undefined) return <Skeleton className="h-96" />
  if (data === null) return <p className="text-ash">This post does not exist.</p>
  const { post, account } = data

  const run = (action: () => Promise<unknown>) => async () => {
    setError(null)
    try {
      await action()
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }
  // Moving and killing stop once the operator posted it, or once it was let go.
  const open = textEditable(post.status)
  // The day picked, once it differs from the planned one: until then there is nothing to move.
  const newDay = day === post.plannedFor ? null : day
  const showValue = wentOut(post.status) || (data.value.clicks ?? 0) > 0
  const failedJobs = data.jobs.filter((job) => job.status === 'failed').length

  return (
    <>
      <PageHeader
        title={post.title}
        lead={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <StatusPill status={post.status} />
            <SponsorPill segment={post.sponsorSegment} />
            <span>
              <Link to="/accounts/$accountId" params={{ accountId: account._id }} className="text-graphite hover:underline">
                {account.name}
              </Link>
              {' · '}
              {formatDay(post.plannedFor, { weekday: 'long', month: 'long', day: 'numeric' })}
            </span>
            <span className="inline-flex items-center gap-1 whitespace-nowrap text-graphite">
              <PostKindIcon kind={post.kind} showLabel />
            </span>
            {/* What the planner asked of the post, as plain text: the writer reads it, the operator edits the post itself. */}
            <PostShape intent={post.intent} length={post.length} className="text-xs whitespace-nowrap" />
          </span>
        }
        actions={
          <>
            {canApply(post.status, 'retry') && (
              <Button variant="primary" onClick={run(() => retry({ postId }))}>
                Retry
              </Button>
            )}
            {/* An idea has no words to rewrite yet: its line under the header says when the writer gets to it. */}
            {canApply(post.status, 'rewrite') && <Button onClick={run(() => rewrite({ postId }))}>Rewrite</Button>}
            {canApply(post.status, 'skipped') && (
              <Button variant="ghost" onClick={run(() => skip({ postId }))}>
                Skip
              </Button>
            )}
            {open && (
              <Button variant="destructive" onClick={run(() => kill({ postId }))}>
                Kill
              </Button>
            )}
          </>
        }
      />
      {/* Stays mounted, so a refused header action is announced where it appears, above the content. */}
      <div aria-live="polite">
        {error && (
          <div className="mb-4">
            <ErrorLine>{error}</ErrorLine>
          </div>
        )}
      </div>
      <PostAlerts post={post} writing={data.writing} />

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card title="Post" description={conceptLine(post.concept, post.title, post.pillar)}>
          {post.posted !== undefined && <PostedLine posted={post.posted} place={placeOf(data.account)} />}
          {/* Keyed on the post it edits: a saved or rewritten post remounts it. */}
          <PostEditor key={[post.title, ...(post.parts ?? [])].join('\u0000')} post={post} place={placeOf(data.account)} />
        </Card>

        <div className="min-w-0 space-y-6">
          <Card title="Day" description={open ? 'Move it to another day.' : 'Fixed once it is posted or let go.'}>
            <div className="flex items-center gap-2">
              <Input
                type="date"
                value={day ?? post.plannedFor}
                onChange={(event) => setDay(event.target.value)}
                className="w-auto"
                disabled={!open}
                aria-label="Planned day"
              />
              {open && newDay !== null && (
                <Button size="sm" onClick={run(() => reschedule({ postId, plannedFor: newDay }))}>
                  Move
                </Button>
              )}
            </div>
          </Card>

          {post.judgment !== undefined && <JudgeReading judgment={post.judgment} />}

          {showValue && (
            <Card title={VALUE_LABEL} footer={<AttributionNote />}>
              <dl className="tabular grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                <dt className="text-ash">{METRIC_LABELS.clicks}</dt>
                <dd>{formatKnown(data.value.clicks)}</dd>
                <dt className="text-ash">{CONVERSION_KIND_LABELS.demo_started}</dt>
                <dd>{data.value.demos}</dd>
                <dt className="text-ash">{CONVERSION_KIND_LABELS.signup}</dt>
                <dd>{data.value.signups}</dd>
                <dt className="text-ash">{CONVERSION_KIND_LABELS.trial_started}</dt>
                <dd>{data.value.trials}</dd>
                <dt className="text-ash">{CONVERSION_KIND_LABELS.paid}</dt>
                <dd>{data.value.paid}</dd>
                <dt className="text-ash">{VALUE_LABEL}</dt>
                <dd className="font-medium">{formatMoney(data.value.value, data.currency)}</dd>
              </dl>
            </Card>
          )}

          {post.numbers !== undefined && (
            <Card title={`On ${placeLabel(placeOf(account))}`}>
              <LatestNumbers numbers={post.numbers} place={placeOf(account)} />
            </Card>
          )}

          {post.basis !== undefined && <DrawnFrom basis={post.basis} />}

          {data.signals.length > 0 && (
            <Card title="Why this post" count={data.signals.length} flush>
              <CardList>
                {data.signals.map((signal) => (
                  <li key={signal._id} className="text-sm">
                    <span className="block text-xs text-ash">{SIGNAL_SOURCE_LABELS[signal.source]}</span>
                    {/* A problem comes from the account's own problem log, so there is no page to open. */}
                    {signal.source === 'problems' ? (
                      <span>{signal.title}</span>
                    ) : (
                      <a href={signal.url} target="_blank" rel="noreferrer" className="hover:underline">
                        {signal.title}
                      </a>
                    )}
                  </li>
                ))}
              </CardList>
            </Card>
          )}

          {data.jobs.length > 0 && (
            <Card>
              {/* Open while a job failed: its error and Retry are the thing to act on. Otherwise a record, folded away. */}
              <Collapsible
                summary="Jobs"
                count={data.jobs.length}
                defaultOpen={failedJobs > 0}
                meta={failedJobs > 0 && <span className="text-signal-red-deep">{failedJobs} failed</span>}
              >
                <ul className="space-y-1.5 font-mono text-[11px]">
                  {data.jobs.map((job) => (
                    <li key={job._id} className="flex flex-wrap items-start gap-2">
                      <JobDot status={job.status} className="mt-1" />
                      <span className="text-graphite">{JOB_KIND_LABELS[job.kind]}</span>
                      <span className="text-ash">
                        {job.status} · {relativeTime(job.finishedAt ?? job.startedAt ?? job.createdAt)}
                      </span>
                      {job.status === 'failed' && (
                        <button
                          type="button"
                          className="ml-auto text-ink hover:underline"
                          onClick={run(() => retryJob({ jobId: job._id }))}
                        >
                          retry
                        </button>
                      )}
                      {job.error && <span className="basis-full text-signal-red-deep">{job.error}</span>}
                    </li>
                  ))}
                </ul>
              </Collapsible>
            </Card>
          )}
          <MockNote when={data.value.mock} />
        </div>
      </div>
    </>
  )
}

/**
 * What the operator should know about the post before its words, as alerts:
 * an idea says when the writer gets to it, a failed post why it failed, a
 * skipped post why, and a draft the judge found too few reasons in says which.
 */
function PostAlerts(props: { post: Doc<'posts'>; writing: boolean }) {
  const { post } = props
  const missing = post.status === 'draft' && post.judgment !== undefined && !engages(post.judgment.reasons)
  if (post.status !== 'idea' && !post.error && !post.skipReason && !missing) return null
  return (
    <div className="mb-6 space-y-3">
      {/* Said once, here: an idea waits for the day before it is due, when the writer looks at what moved and writes it. */}
      {post.status === 'idea' && (
        <Alert tone="info" title={ideaLine(post, props.writing)}>
          I write the post the day before it is due, after a last look at what moved that morning.
        </Alert>
      )}
      {post.error && (
        <Alert tone="danger" title="This post failed">
          <span className="font-mono text-xs">{post.error}</span>
        </Alert>
      )}
      {post.skipReason && (
        <Alert tone="info" title="Let go">
          {post.skipReason}
        </Alert>
      )}
      {missing && post.judgment !== undefined && (
        <Alert tone="warning" title={`No reason for readers to ${missingReasons(post.judgment.reasons).join(' or ')}`}>
          {post.judgment.fix}
        </Alert>
      )}
    </div>
  )
}

/** When the post went out and where to open it; one said posted without a link has no id, so nothing reads its numbers. */
function PostedLine(props: { posted: Posted; place: PlatformPlace }) {
  const item = postedItemOf(props.posted)
  const when = `Posted ${relativeTime(props.posted.at)}`
  if (item === null)
    return (
      <p className="mb-4 text-sm">
        {when}
        <span className="text-ash">, with no link, so the analyst has no numbers to read.</span>
      </p>
    )
  if (item.url === undefined) return <p className="mb-4 text-sm">{when}.</p>
  return (
    <p className="mb-4 text-sm">
      {when}:{' '}
      <a href={item.url} target="_blank" rel="noreferrer" className="underline decoration-fog hover:decoration-ink">
        open on {placeLabel(props.place)}
      </a>
    </p>
  )
}

/** The concept and the pillar it serves; a concept that only repeats the title is left out, and with neither there is no line. */
function conceptLine(concept: string, title: string, pillar: string | undefined): string | undefined {
  const parts = [...(concept.trim() === title.trim() ? [] : [`Concept: ${concept}`]), ...(pillar ? [`Pillar: ${pillar}`] : [])]
  return parts.length === 0 ? undefined : parts.join(' · ')
}

/** The post's numbers at the analyst's last read, as its platform counts them, and where they come from. */
function LatestNumbers(props: { numbers: ItemRead; place: PlatformPlace }) {
  return (
    <dl className="tabular grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
      {numbersOf(props.numbers.counts).map((number) => (
        <React.Fragment key={number.label}>
          <dt className="text-ash">{number.label}</dt>
          <dd>{formatCount(number.value)}</dd>
        </React.Fragment>
      ))}
      <dt className="text-ash">Read</dt>
      <dd className="text-ash">{relativeTime(props.numbers.readAt)}</dd>
      <dt className="text-ash">Source</dt>
      <dd className="text-ash">{countsSource(props.place, true)}</dd>
    </dl>
  )
}

/**
 * The judge's reading of the post (shared judge.ts): from the reader's side,
 * the reason they would read on, comment, like and follow, each question
 * with its answer or, in amber, none; then what would give the missing ones.
 */
function JudgeReading(props: { judgment: NonNullable<Doc<'posts'>['judgment']> }) {
  const { judgment } = props
  const engaging = engages(judgment.reasons)
  return (
    <Card
      title="Why people would engage"
      description={
        <>
          <span className={engaging ? undefined : 'text-alert-amber-deep'}>
            {engaging ? 'The judge found reasons for readers to engage.' : 'The judge found too few reasons for readers to engage.'}
          </span>{' '}
          Read {relativeTime(judgment.judgedAt)}
          {judgment.mock && ', mock'}.
        </>
      }
    >
      <dl className="space-y-2.5 text-sm">
        {ENGAGEMENTS.map((engagement) => {
          const reason = judgment.reasons[engagement]
          return (
            <div key={engagement}>
              <dt className="text-xs text-ash">{ENGAGEMENT_QUESTIONS[engagement]}</dt>
              <dd className={reason === null ? 'text-alert-amber-deep' : undefined}>{reason ?? 'No reason found.'}</dd>
            </div>
          )
        })}
      </dl>
      {judgment.fix !== '' && <p className="mt-3 max-w-[60ch] border-t border-mist pt-3 text-xs text-graphite">{judgment.fix}</p>}
    </Card>
  )
}

/** What the post is drawn from: a standout, a round-up's questions, another account's post, or a launch, each thread linked. */
function DrawnFrom(props: { basis: NonNullable<Doc<'posts'>['basis']> }) {
  const basis = props.basis
  switch (basis.kind) {
    case 'model':
      return (
        <DrawnSection
          title="Modeled on what worked"
          lead="A thread in the niche that people answered far more than the others found with it. The post takes its topic, in your words."
          items={[{ key: basis.thread.signalId, title: basis.thread.title, url: basis.thread.url }]}
        />
      )
    case 'roundup':
      return (
        <DrawnSection
          title="Round-up"
          lead={`What people asked lately about ${basis.pillar}, answered in one post. It names no one who asked.`}
          items={basis.questions.map((question) => ({ key: question.signalId, title: question.title, url: question.url }))}
        />
      )
    case 'rework':
      return (
        <DrawnSection
          title="Reworked from another account"
          lead={`One of your posts on ${basis.post.placeName} that brought users, made anew for this platform.`}
          items={[{ key: basis.post.postId, title: basis.post.title, url: basis.post.url }]}
        />
      )
    case 'launch':
      return <DrawnSection title="Launch" lead={`It announces what you shipped: ${basis.what}`} items={[]} />
  }
}

function DrawnSection(props: { title: string; lead: string; items: { key: string; title: string; url: string | null }[] }) {
  return (
    <Card title={props.title} description={props.lead}>
      <ul className="space-y-1.5 text-sm empty:hidden">
        {props.items.map((item) => (
          <li key={item.key}>
            {item.url === null ? (
              <span>{item.title}</span>
            ) : (
              <a href={item.url} target="_blank" rel="noreferrer" className="hover:underline">
                {item.title}
              </a>
            )}
          </li>
        ))}
      </ul>
    </Card>
  )
}
