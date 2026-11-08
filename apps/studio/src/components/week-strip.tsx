import { api } from '@influstep/convex/_generated/api'
import { Link } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import React from 'react'
import { StatusDot } from './status'
import { LaunchForm } from './launch-form'
import { Button, Card, ErrorLine, type FormState, Skeleton } from './ui'
import { ArrowLeftIcon, ArrowRightIcon } from '@phosphor-icons/react'
import { cn } from '@/lib/cn'
import { errorMessage } from '@/lib/errors'
import { addDays, formatDay, plural, todayKey, weekStart } from '@/lib/format'

/** Plan this week: the plans queued, with how many accounts plan no post yet (core/planner `planWaits`), or why it failed. */
type PlanState = FormState | { status: 'queued'; waiting: number }

/** How many posts a day's cell names; the rest are counted. */
const NAMED = 3

/**
 * The week at a glance (docs/plan.md, "Studio screens": the week strip that
 * replaces the calendar), as one card: each day's posts by status, a click on
 * one opens it, the week moves forward and back for planning ahead, and a
 * launch is planned from its foot.
 */
export function WeekStrip(props: { week: string; onWeek: (week: string) => void }) {
  const today = todayKey()
  const data = useQuery(api.private.calendar.week, { weekStart: props.week })
  const planActiveWeek = useMutation(api.private.accounts.planActiveWeek)
  const [plan, setPlan] = React.useState<PlanState>({ status: 'idle' })
  const thisWeek = props.week === weekStart(today)
  const planActive = async () => {
    if (plan.status === 'saving') return
    setPlan({ status: 'saving' })
    try {
      const { waiting } = await planActiveWeek({ weekStart: props.week })
      setPlan({ status: 'queued', waiting })
    } catch (caught) {
      setPlan({ status: 'error', message: errorMessage(caught) })
    }
  }
  return (
    <Card
      title={`${formatDay(props.week, { month: 'short', day: 'numeric' })} to ${formatDay(addDays(props.week, 6), { month: 'short', day: 'numeric' })}`}
      description={thisWeek ? 'This week' : undefined}
      actions={
        <>
          <div className="flex items-center gap-0.5">
            <Button size="sm" variant="ghost" onClick={() => props.onWeek(addDays(props.week, -7))} aria-label="Previous week">
              <ArrowLeftIcon aria-hidden size={14} />
            </Button>
            {!thisWeek && (
              <Button size="sm" variant="ghost" onClick={() => props.onWeek(weekStart(today))}>
                This week
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => props.onWeek(addDays(props.week, 7))} aria-label="Next week">
              <ArrowRightIcon aria-hidden size={14} />
            </Button>
          </div>
          <Button size="sm" variant="outline" busy={plan.status === 'saving'} onClick={() => void planActive()}>
            Plan this week
          </Button>
        </>
      }
    >
      {plan.status === 'error' && <ErrorLine>{plan.message}</ErrorLine>}
      {plan.status === 'queued' && plan.waiting > 0 && (
        <p className="mb-3 text-xs text-ash">
          <span className="tabular">{plan.waiting}</span>{' '}
          {plural(plan.waiting, 'account plans no post yet; its page says why.', 'accounts plan no post yet; their pages say why.')}
        </p>
      )}
      {data === undefined && <Skeleton className="h-28" />}
      {data !== undefined && (
        <ol className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 xl:grid-cols-7">
          {data.days.map((day) => (
            <li key={day.day} className={cn('min-w-0 rounded-lg p-2 text-xs', day.day === today ? 'bg-paper-warm' : 'bg-paper-tint')}>
              <p className="mb-1.5 flex items-baseline justify-between">
                <span className={cn('font-medium', day.day === today ? 'text-ink' : 'text-graphite')}>
                  {formatDay(day.day, { weekday: 'short' })}
                </span>
                <span className="tabular font-mono text-ash">{formatDay(day.day, { day: 'numeric' })}</span>
              </p>
              {day.posts.length === 0 && <p className="text-ash">Nothing planned.</p>}
              <ul className="space-y-1">
                {day.posts.slice(0, NAMED).map((post) => (
                  <li key={post._id} className="flex min-w-0 items-center gap-1.5">
                    <StatusDot status={post.status} />
                    <Link to="/posts/$postId" params={{ postId: post._id }} className="truncate hover:underline" title={post.title}>
                      {post.title}
                    </Link>
                  </li>
                ))}
              </ul>
              {day.posts.length > NAMED && <p className="mt-1 text-ash">and {day.posts.length - NAMED} more</p>}
            </li>
          ))}
        </ol>
      )}
      <div className="mt-4 border-t border-mist pt-3">
        <LaunchForm />
      </div>
    </Card>
  )
}
