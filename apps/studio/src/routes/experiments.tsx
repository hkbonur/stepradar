import { api } from '@influstep/convex/_generated/api'
import type { Id } from '@influstep/convex/_generated/dataModel'
import {
  EXPERIMENT_KINDS,
  EXPERIMENT_KIND_LABELS,
  EXPERIMENT_STATUSES,
  type ExperimentStatus,
  EXPERIMENT_METRIC_LABELS,
  METRIC_LABELS,
  POSTING_TIME_TOLERANCE_MS,
  REVIEW_MIN_ITEMS,
  isReplyExperimentKind,
  itemsNoun,
  rateText,
  type ExperimentKind,
  type StrategyDefault,
  handleOf,
} from '@influstep/shared'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import React from 'react'
import { z } from 'zod'
import {
  Button,
  Card,
  Empty,
  ErrorLine,
  Field,
  type FormState,
  Input,
  Mono,
  PageHeader,
  Pill,
  Skeleton,
  TabNav,
  Textarea,
} from '@/components/ui'
import { cn } from '@/lib/cn'
import { errorMessage } from '@/lib/errors'
import { knownVariants, parseVariants, variantsText } from '@/lib/experiment-variants'
import { formatCount, formatDateTime, formatPercent } from '@/lib/format'

/** The page's views, one tab per status. */
const STATUS_LABELS: Record<ExperimentStatus, string> = { running: 'Running', decided: 'Decided', stopped: 'Stopped' }

const searchSchema = z.object({ status: z.enum(EXPERIMENT_STATUSES).optional() })

export const Route = createFileRoute('/experiments')({ component: ExperimentsPage, validateSearch: searchSchema })

type ExperimentRow = NonNullable<ReturnType<typeof useQuery<typeof api.private.experiments.list>>>[number]

/** What the new experiment form needs of an account: who it is, and its defaults, which fill in the control. */
type AccountOption = { _id: Id<'accounts'>; name: string; defaults: StrategyDefault[] | undefined }

/**
 * The experiments of every account (DESIGN.md, Experiments page): one tab per
 * status, each experiment a card with its variants, the new experiment form
 * as a card above them.
 */
function ExperimentsPage() {
  const search = Route.useSearch()
  const status = search.status ?? 'running'
  const experiments = useQuery(api.private.experiments.list, {})
  const accounts = useQuery(api.private.accounts.list, {})
  const [creating, setCreating] = React.useState(false)
  const options = accounts?.map((account): AccountOption => ({
    _id: account._id,
    name: account.name,
    defaults: account.strategy?.defaults,
  }))
  const first = options?.[0]
  return (
    <>
      <PageHeader
        title="Experiments"
        lead="One running experiment per account. Each new reply carries a variant; the analyst decides once each has enough."
        actions={
          <Button variant="primary" onClick={() => setCreating((value) => !value)}>
            {creating ? 'Close' : 'New experiment'}
          </Button>
        }
      />
      {creating && accounts && accounts.length === 0 && (
        <div className="mb-6">
          <Empty>An experiment runs on an account's replies. Set up an account first.</Empty>
        </div>
      )}
      {creating && options && first && <NewExperimentForm accounts={options} first={first} onDone={() => setCreating(false)} />}
      {!experiments && <Skeleton className="h-40 rounded-xl" />}
      {experiments && experiments.length === 0 && (
        <Empty action={<Button onClick={() => setCreating(true)}>New experiment</Button>}>
          No experiments yet. Each account's weekly strategy review picks one from the catalog, or you can set one up now.
        </Empty>
      )}
      {experiments && experiments.length > 0 && (
        <>
          <TabNav
            label="Experiments by status"
            className="mb-6"
            items={EXPERIMENT_STATUSES.map((key) => ({
              key,
              label: STATUS_LABELS[key],
              count: experiments.filter((experiment) => experiment.status === key).length,
              current: key === status,
              link: { to: '/experiments', search: { status: key } },
            }))}
          />
          <div className="space-y-4">
            {experiments
              .filter((experiment) => experiment.status === status)
              .map((experiment) => (
                <ExperimentCard key={experiment._id} experiment={experiment} />
              ))}
            {experiments.every((experiment) => experiment.status !== status) && (
              <Empty>No {STATUS_LABELS[status].toLowerCase()} experiments.</Empty>
            )}
          </div>
        </>
      )}
    </>
  )
}

function ExperimentCard(props: { experiment: ExperimentRow }) {
  const stop = useMutation(api.private.experiments.stop)
  const override = useMutation(api.private.experiments.override)
  const [overriding, setOverriding] = React.useState(false)
  const [recording, setRecording] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const experiment = props.experiment
  const leader = [...experiment.stats].sort((a, b) => b.rate - a.rate)[0]
  const tint = experiment.status === 'running' ? 'field-green' : experiment.status === 'decided' ? 'ink' : 'fog'
  // A decision lands once: a second submit while the first is out is ignored, and the backend refuses one on an experiment
  // that is no longer running.
  const submitOverride = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (recording) return
    const form = new FormData(event.currentTarget)
    setError(null)
    setRecording(true)
    try {
      await override({ experimentId: experiment._id, winnerKey: String(form.get('winnerKey')), note: String(form.get('note') ?? '') })
      setOverriding(false)
    } catch (caught) {
      setError(errorMessage(caught))
    }
    setRecording(false)
  }
  // Stopping is refused once the experiment is no longer running (decided by the analyst a moment ago, say), and the card says so.
  const stopExperiment = async () => {
    setError(null)
    try {
      await stop({ experimentId: experiment._id })
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }
  return (
    <article className="surface">
      <div className="card-pad flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex flex-wrap items-center gap-2 text-title">
            {experiment.name}
            <Pill tint={tint}>{experiment.status}</Pill>
          </h2>
          <p className="mt-1 text-sm text-graphite">{experiment.hypothesis}</p>
          <p className="mt-1 text-xs text-ash">
            {/* Who chose to run it: the operator on this page, or the account's own strategy review. */}
            {experiment.createdBy === 'operator'
              ? `Set up by you for ${experiment.account.name}`
              : `Picked by ${experiment.account.name}`}{' '}
            <Mono>{handleOf(experiment.account)}</Mono> · {EXPERIMENT_KIND_LABELS[experiment.kind]} on{' '}
            {EXPERIMENT_METRIC_LABELS[experiment.metric]} · decides at {experiment.minItems} {itemsNoun(experiment.kind)} per variant,{' '}
            {formatPercent(experiment.minConfidence, 0)} confidence
          </p>
        </div>
        <div className="flex gap-2">
          {experiment.status === 'running' && (
            <>
              <Button size="sm" onClick={() => setOverriding((value) => !value)}>
                Decide myself
              </Button>
              <Button size="sm" variant="destructive" onClick={() => void stopExperiment()}>
                Stop
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="overflow-x-auto border-t border-mist">
        <table className="card-table w-full text-sm">
          <thead className="bg-paper-tint text-xs text-ash">
            <tr className="text-left">
              <th className="py-2 font-medium">Variant</th>
              <th className="py-2 pl-3 text-right font-medium">{isReplyExperimentKind(experiment.kind) ? 'Replies' : 'Posts'}</th>
              <th className="py-2 pl-3 text-right font-medium">Still needed</th>
              <th className="py-2 pl-3 text-right font-medium">{METRIC_LABELS[experiment.metric]} per item</th>
            </tr>
          </thead>
          <tbody className="tabular">
            {experiment.variants.map((variant) => {
              const stat = experiment.stats.find((candidate) => candidate.key === variant.key)
              const winner = experiment.decision?.winnerKey === variant.key
              return (
                <tr key={variant.key} className={cn('border-t border-mist', { 'font-medium': winner })}>
                  <td className="py-2.5">
                    <span title={variant.key}>{variant.label}</span>
                    {variant.isControl && <span className="ml-1 text-xs text-ash">control</span>}
                    {winner && (
                      <Pill tint="field-green" className="ml-2">
                        winner
                      </Pill>
                    )}
                    {!experiment.decision && leader?.key === variant.key && (stat?.items ?? 0) > 0 && (
                      <span className="ml-2 text-xs text-ash">leading</span>
                    )}
                    <p className="text-xs font-normal text-ash">{variant.description}</p>
                  </td>
                  <td className="py-2.5 pl-3 text-right">{formatCount(stat?.items ?? 0)}</td>
                  {/* Few items a day go out, so a decision comes slowly: say how far each variant still is from the floor. */}
                  <td className="py-2.5 pl-3 text-right text-ash">{formatCount(Math.max(0, experiment.minItems - (stat?.items ?? 0)))}</td>
                  <td className="py-2.5 pl-3 text-right">
                    {stat && stat.items > 0 ? (
                      rateText(experiment.metric, stat.rate)
                    ) : (
                      // Nothing went out under this variant yet, so there is no rate; an empty cell read as a missing number.
                      <span className="text-ash">
                        <span aria-hidden>–</span>
                        <span className="sr-only">no data yet</span>
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {(experiment.leftOut || experiment.decision) && (
        <div className="card-x space-y-2 border-t border-mist py-3">
          {experiment.leftOut && <LeftOutLine leftOut={experiment.leftOut} />}
          {experiment.decision && (
            <p className="text-sm">
              <span className="font-medium">{experiment.decision.byOperator ? 'You decided' : 'Decided'}</span>{' '}
              {/* An analyst's note already states the lift and the confidence (core `analystDecisionNote`). */}
              {formatDateTime(experiment.decision.decidedAt)}: {experiment.decision.note}
            </p>
          )}
        </div>
      )}

      {/* Gone once the experiment is decided or stopped, by the daily evaluation say, while the form was open. */}
      {overriding && experiment.status === 'running' && (
        <form onSubmit={submitOverride} className="card-band flex flex-wrap items-end gap-3">
          <Field label="Winner">
            <select name="winnerKey" className="field w-auto pr-8">
              {experiment.variants.map((variant) => (
                <option key={variant.key} value={variant.key}>
                  {variant.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Why" className="min-w-64 flex-1">
            <Input name="note" placeholder="What you saw that the numbers do not show" required />
          </Field>
          <Button type="submit" variant="primary" busy={recording}>
            Record decision
          </Button>
        </form>
      )}
      {error && (
        <div className="card-x pb-3">
          <ErrorLine>{error}</ErrorLine>
        </div>
      )}
    </article>
  )
}

/** What a posting time test left out though measured, and why: no variant counts these posts. Nothing when it left none out. */
function LeftOutLine(props: { leftOut: NonNullable<ExperimentRow['leftOut']> }) {
  const { offHour, unknownHour } = props.leftOut
  const minutes = POSTING_TIME_TOLERANCE_MS / 60_000
  const parts = [
    ...(offHour === 0
      ? []
      : [`${formatCount(offHour)} went out more than ${minutes} minutes off ${offHour === 1 ? 'its' : 'their'} planned hour`]),
    ...(unknownHour === 0
      ? []
      : [
          `${formatCount(unknownHour)} ${unknownHour === 1 ? 'was' : 'were'} marked posted by hand, so the hour ${unknownHour === 1 ? 'it' : 'they'} went out is not known`,
        ]),
  ]
  if (parts.length === 0) return null
  return <p className="text-xs text-ash">Measured posts no variant counts: {parts.join('; ')}.</p>
}

/**
 * The operator's own experiment. Picking an account and a dimension fills the
 * variants from the catalog, what the account does now first as the control
 * (shared EXPERIMENT_CATALOG and effectiveVariant). The lines stay editable; a
 * new pick refills them only while they are empty or still the fill, so an
 * edit is never thrown away.
 */
function NewExperimentForm(props: { accounts: AccountOption[]; first: AccountOption; onDone: () => void }) {
  const create = useMutation(api.private.experiments.create)
  const [state, setState] = React.useState<FormState>({ status: 'idle' })
  const [account, setAccount] = React.useState(props.first)
  const [kind, setKind] = React.useState<ExperimentKind>('reply_style')
  const [variants, setVariants] = React.useState(() => variantsText(knownVariants('reply_style', props.first.defaults)))
  const measurable = useQuery(api.private.experiments.measurable, { accountId: account._id, kind })
  const pick = (next: { account: AccountOption; kind: ExperimentKind }) => {
    const filled = variantsText(knownVariants(kind, account.defaults))
    if (variants.trim() === '' || variants === filled) setVariants(variantsText(knownVariants(next.kind, next.account.defaults)))
    setAccount(next.account)
    setKind(next.kind)
    // A refusal was about the account and the dimension that were sent; picking another makes it stale.
    if (state.status === 'error') setState({ status: 'idle' })
  }
  const pickAccount = (value: string) => {
    const next = props.accounts.find((candidate) => candidate._id === value)
    if (next === undefined) return
    pick({ account: next, kind })
  }
  const pickKind = (value: string) => {
    const next = EXPERIMENT_KINDS.find((candidate) => candidate === value)
    if (next === undefined) return
    pick({ account, kind: next })
  }
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const text = (name: string) => String(form.get(name) ?? '').trim()
    const metric = measurable?.metrics.find((candidate) => candidate === text('metric'))
    if (metric === undefined) throw new Error(`${text('metric')} is not a metric an experiment is decided on`)
    setState({ status: 'saving' })
    try {
      await create({
        accountId: account._id,
        name: text('name'),
        hypothesis: text('hypothesis'),
        kind,
        metric,
        variants: parseVariants(variants, knownVariants(kind, account.defaults)),
        minItems: Number(form.get('minItems') ?? REVIEW_MIN_ITEMS),
        minConfidence: Number(form.get('minConfidence') ?? 0.9),
      })
      props.onDone()
    } catch (caught) {
      setState({ status: 'error', message: errorMessage(caught) })
    }
  }
  return (
    <Card
      title="New experiment"

      className="mb-6"
    >
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Account">
          <select name="accountId" className="field" value={account._id} onChange={(event) => pickAccount(event.target.value)} required>
            {props.accounts.map((account) => (
              <option key={account._id} value={account._id}>
                {account.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Name">
          <Input name="name" required placeholder="Questions back" />
        </Field>
        <Field label="Hypothesis" className="sm:col-span-2">
          <Input name="hypothesis" required placeholder="A question back reaches further than a tip" />
        </Field>
        <Field label="Dimension">
          <select name="kind" className="field" value={kind} onChange={(event) => pickKind(event.target.value)}>
            {EXPERIMENT_KINDS.map((option) => (
              <option key={option} value={option}>
                {EXPERIMENT_KIND_LABELS[option]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Metric" hint={measurable?.why ?? undefined}>
          {/* Keyed on the metrics offered, so a pick another account or dimension cannot be decided on resets. */}
          <select
            key={measurable?.metrics.join()}
            name="metric"
            className="field"
            defaultValue="reach"
            disabled={!measurable?.metrics.length}
          >
            {(measurable?.metrics ?? []).map((metric) => (
              <option key={metric} value={metric}>
                {METRIC_LABELS[metric]}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Variants"
          hint="One per line, “Label: what the writer does”. The first line is the control, filled in with what the account does now. Keep two or three: each variant needs its own items."
          className="sm:col-span-2"
        >
          <Textarea name="variants" required value={variants} onChange={(event) => setVariants(event.target.value)} className="min-h-32" />
        </Field>
        <Field label="Items per variant before deciding" hint="Replies or posts, at least 2">
          <Input name="minItems" type="number" min={2} defaultValue={REVIEW_MIN_ITEMS} />
        </Field>
        <Field label="Confidence" hint="0 to 1">
          <Input name="minConfidence" type="number" min={0.5} max={0.99} step={0.01} defaultValue={0.9} />
        </Field>
        {state.status === 'error' && (
          <div className="sm:col-span-2">
            <ErrorLine>{state.message}</ErrorLine>
          </div>
        )}
        <div className="flex gap-2 sm:col-span-2">
          {/* A dimension nothing can decide on the account has no metric to send: the hint above says why. */}
          <Button type="submit" variant="primary" busy={state.status === 'saving'} disabled={!measurable?.metrics.length}>
            Start experiment
          </Button>
          <Button variant="ghost" onClick={props.onDone}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  )
}
