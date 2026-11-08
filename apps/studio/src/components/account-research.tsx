import { api } from '@influstep/convex/_generated/api'
import type { Id } from '@influstep/convex/_generated/dataModel'
import { useMutation, useQuery } from 'convex/react'
import type { FunctionReturnType } from 'convex/server'
import { QueuedLine, useQueuedAction } from './queued-action'
import { Button, Card, Collapsible, Skeleton } from './ui'
import { PROBLEMS_SHOWN, briefTime, splitBrief } from '@/lib/research'
import { useNow } from '@/lib/use-now'

type Research = FunctionReturnType<typeof api.private.research.get>

/** A brief's expiry only matters to the minute, so the section reads the clock once a minute. */
const RESEARCH_CLOCK_MS = 60_000

/**
 * What the researcher found this morning and the problems the account keeps
 * meeting, as one card (DESIGN.md, Account page). Short on purpose: three
 * lines of the brief and three problems, the rest folded away.
 */
export function ResearchCard(props: { accountId: Id<'accounts'> }) {
  const research = useQuery(api.private.research.get, { accountId: props.accountId })
  const pollSignals = useMutation(api.private.accounts.pollSignals)
  const { state, run, busy } = useQueuedAction<'poll'>()
  const now = useNow(RESEARCH_CLOCK_MS)
  return (
    <Card
      title="Research"
      actions={
        <Button
          size="sm"
          variant="ghost"
          busy={busy('poll')}
          onClick={() => run('poll', () => pollSignals({ accountId: props.accountId }), 'Queued for the researcher: new signals shortly.')}
        >
          Poll signals
        </Button>
      }
    >
      <QueuedLine state={state} className="mb-2 empty:mb-0" />
      {research === undefined && <Skeleton className="h-4 w-40" />}
      {research !== undefined && (
        <div className="space-y-4 text-sm">
          <MorningBrief brief={research.brief} now={now} />
          <ProblemLog problems={research.problems} />
        </div>
      )}
    </Card>
  )
}

/**
 * The newest brief, unless it expired: an expired brief says nothing about
 * today, and the writer skips it too. Judged against the page's clock, since
 * the query does not re-run when a brief runs out.
 */
function MorningBrief(props: { brief: Research['brief']; now: number }) {
  const brief = props.brief
  if (brief === null || brief.expiresAt <= props.now)
    return <p className="text-ash">No brief yet. The researcher writes one every morning.</p>
  const lines = splitBrief(brief.text)
  return (
    <div className="space-y-0.5">
      <p className="text-xs font-medium text-graphite">Morning brief, {briefTime(brief.createdAt, props.now)}</p>
      {lines.head.map((line, index) => (
        // The brief's lines never move, so their place keys them; a line can repeat.
        <p key={`${index}:${line}`}>{line}</p>
      ))}
      {lines.rest.length > 0 && (
        <Collapsible summary="Whole brief">
          <div className="space-y-0.5">
            {lines.rest.map((line, index) => (
              <p key={`${index}:${line}`}>{line}</p>
            ))}
          </div>
        </Collapsible>
      )}
    </div>
  )
}

/** The open problems, newest first. With none, the part is left out, heading and all. */
function ProblemLog(props: { problems: Research['problems'] }) {
  if (props.problems.length === 0) return null
  const shown = props.problems.slice(0, PROBLEMS_SHOWN)
  const more = props.problems.length - shown.length
  return (
    <div className="space-y-0.5">
      <p className="text-xs font-medium text-graphite">Problem log</p>
      <ul className="space-y-0.5">
        {shown.map((problem) => (
          <li key={problem._id}>{problem.text}</li>
        ))}
      </ul>
      {more > 0 && (
        <p className="text-ash">
          and <span className="tabular">{more}</span> more
        </p>
      )}
    </div>
  )
}
