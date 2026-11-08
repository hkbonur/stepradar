import { CONVERSION_KIND_LABELS, METRIC_LABELS, VALUE_LABEL } from '@influstep/shared'
import { cn } from '@/lib/cn'
import { formatCount, formatDay, formatKnown, formatMoney, formatPercent } from '@/lib/format'

/**
 * The report's charts, hand-drawn SVG so the colors stay the fixed series of
 * DESIGN.md: comments cyan, reach violet, clicks amber, signups emerald, paid
 * red. Demos and trials are the lighter shade of the step they lead from
 * (clicks and signups), so the funnel stays five hues.
 */

const SERIES = {
  reach: 'var(--color-chart-2)',
  replies: 'var(--color-chart-1)',
  clicks: 'var(--color-chart-3)',
  demos: 'color-mix(in oklch, var(--color-chart-3) 55%, transparent)',
  signups: 'var(--color-chart-4)',
  trials: 'color-mix(in oklch, var(--color-chart-4) 55%, transparent)',
  paid: 'var(--color-chart-5)',
} as const

/** What an account's platform counts as reach, and how much, null when none was read; no reach across platforms, which each count it their own way. */
type ReachData = { label: string; value: number | null } | null

/** A funnel's steps; a step whose number was not read has no bar. */
export interface FunnelData {
  reach: ReachData
  replies: number | null
  /** Null where no click is counted (shared `countsClicks`): the posts link to the sponsor directly. */
  clicks: number | null
  /** Whether the demos and signups are a share of the clicks: not when some came where no click is counted. */
  everyClickCounted: boolean
  demos: number
  signups: number
  trials: number
  paid: number
}

type FunnelStep = Exclude<keyof FunnelData, 'reach' | 'everyClickCounted'> | 'reach'

/** The label of each step after reach. */
const STEP_LABELS: Record<Exclude<FunnelStep, 'reach'>, string> = {
  replies: 'Comments',
  clicks: METRIC_LABELS.clicks,
  demos: CONVERSION_KIND_LABELS.demo_started,
  signups: CONVERSION_KIND_LABELS.signup,
  trials: CONVERSION_KIND_LABELS.trial_started,
  paid: CONVERSION_KIND_LABELS.paid,
}

/**
 * Each step's rate is a share of the step it leads from, not of the bar above
 * it: comments and clicks are both taken from reach, demos and signups from
 * clicks, trials and paid from signups. Demos and trials are optional
 * sub-steps, so a strict previous-bar rate would read "signups of demos".
 * The rates then say what the metric strip's notes say.
 */
const FUNNEL_STEPS: { key: FunnelStep; rateFrom?: FunnelStep }[] = [
  { key: 'reach' },
  { key: 'replies', rateFrom: 'reach' },
  { key: 'clicks', rateFrom: 'reach' },
  { key: 'demos', rateFrom: 'clicks' },
  { key: 'signups', rateFrom: 'clicks' },
  { key: 'trials', rateFrom: 'signups' },
  { key: 'paid', rateFrom: 'signups' },
]

/** A step's value; null for a number not read, or reach across platforms, which has no bar. */
function stepValue(data: FunnelData, key: FunnelStep): number | null {
  return key === 'reach' ? (data.reach?.value ?? null) : data[key]
}

/** Up to seven bars on a log-ish scale, each with its rate from the step it leads from; reach only where one platform counts it. */
export function Funnel(props: { data: FunnelData }) {
  const steps = FUNNEL_STEPS.flatMap((step) => {
    const value = stepValue(props.data, step.key)
    if (value === null) return []
    const label = step.key === 'reach' ? (props.data.reach?.label ?? '') : STEP_LABELS[step.key]
    return [{ ...step, value, label }]
  })
  const max = Math.max(1, ...steps.map((step) => step.value))
  return (
    <ol className="grid gap-2">
      {steps.map((step) => {
        const value = step.value
        const from =
          step.rateFrom === undefined || (step.rateFrom === 'clicks' && !props.data.everyClickCounted)
            ? null
            : stepValue(props.data, step.rateFrom)
        const width = value === 0 ? 0 : Math.max(2, (Math.log10(value + 1) / Math.log10(max + 1)) * 100)
        return (
          <li key={step.key} className="grid grid-cols-[5rem_1fr_6.5rem] items-center gap-3 text-sm sm:grid-cols-[9rem_1fr_5rem]">
            <span className="text-graphite">{step.label}</span>
            <span className="h-5 overflow-hidden rounded-sm bg-hairline">
              <span
                className="block h-full rounded-sm transition-[width] duration-200 ease-out-quint"
                style={{ width: `${width}%`, background: SERIES[step.key] }}
              />
            </span>
            <span className="text-right">
              <span className="tabular font-medium">{formatCount(value)}</span>
              {from !== null && from > 0 && <span className="tabular ml-1.5 text-xs text-ash">{formatPercent(value / from)}</span>}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

export interface TrendPoint {
  day: string
  reach: number
  clicks: number | null
  signups: number
}

/** One line chart with three series on their own scales; the reader compares shape, not height. Reach is named as its platform counts it. */
export function Trend(props: { points: TrendPoint[]; reachLabel: string; className?: string }) {
  const width = 640
  const height = 160
  const pad = { top: 8, right: 8, bottom: 20, left: 8 }
  const innerW = width - pad.left - pad.right
  const innerH = height - pad.top - pad.bottom
  // A series no day counts (clicks where the posts link to the sponsor directly) has no line.
  const keys = (['reach', 'clicks', 'signups'] as const).filter((key) => props.points.some((point) => point[key] !== null))
  const labels = { reach: props.reachLabel, clicks: METRIC_LABELS.clicks, signups: CONVERSION_KIND_LABELS.signup }
  const x = (index: number) => pad.left + (props.points.length <= 1 ? innerW / 2 : (index / (props.points.length - 1)) * innerW)
  const paths = keys.map((key) => {
    const values = props.points.map((point) => point[key] ?? 0)
    const max = Math.max(1, ...values)
    const d = values
      .map((value, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(1)},${(pad.top + innerH - (value / max) * innerH).toFixed(1)}`)
      .join(' ')
    return { key, d, max, total: values.reduce((sum, value) => sum + value, 0) }
  })
  const labelEvery = Math.max(1, Math.round(props.points.length / 6))
  return (
    <figure className={cn('grid gap-2', props.className)}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-40 w-full"
        role="img"
        aria-label={`${props.reachLabel}, clicks and signups per day`}
      >
        {[0.25, 0.5, 0.75].map((fraction) => (
          <line
            key={fraction}
            x1={pad.left}
            x2={width - pad.right}
            y1={pad.top + innerH * fraction}
            y2={pad.top + innerH * fraction}
            stroke="var(--color-mist)"
            strokeDasharray="2 4"
          />
        ))}
        {paths.map((path) => (
          <path
            key={path.key}
            d={path.d}
            fill="none"
            stroke={SERIES[path.key]}
            strokeWidth={path.key === 'reach' ? 1.5 : 2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
        {props.points.map(
          (point, index) =>
            index % labelEvery === 0 && (
              <text key={point.day} x={x(index)} y={height - 4} textAnchor="middle" className="fill-ash font-mono text-[10px]">
                {formatDay(point.day, { month: 'short', day: 'numeric' })}
              </text>
            )
        )}
      </svg>
      <figcaption className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-ash">
        {paths.map((path) => (
          <span key={path.key} className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-0.5 w-4 rounded-full" style={{ background: SERIES[path.key] }} />
            {labels[path.key]}
            <span className="tabular text-graphite">{formatCount(path.total)}</span>
          </span>
        ))}
      </figcaption>
    </figure>
  )
}

/** One strip item: its value, what it leads to, and where the number comes from (CONTEXT.md, "Report"). */
export interface StripItem {
  label: string
  value: string
  note?: string
  source: string
}

export function MetricStrip(props: { items: StripItem[] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-6">
      {props.items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="eyebrow">{item.label}</dt>
          <dd className="text-metric tabular mt-1">{item.value}</dd>
          {item.note && <dd className="mt-0.5 text-xs text-ash">{item.note}</dd>}
          <dd className="mt-0.5 text-[11px] text-ash/80">{item.source}</dd>
        </div>
      ))}
    </dl>
  )
}

/** What a report's strip reads from a funnel. */
interface StripFunnel {
  replies: number | null
  clicks: number | null
  everyClickCounted: boolean
  signups: number
  paid: number
  value: number
}

/** The reach a strip leads with: an account's, as its platform counts it, null when none was read; none across platforms. */
export type StripReach = { label: string; value: number | null; note: string; source: string } | null

/**
 * The six values every report leads with (DESIGN.md, Report), each with the
 * rate it leads to and its source: an account's reach first, or, across
 * accounts, which each count reach their own way, the comments alone.
 */
export function reportStrip(funnel: StripFunnel, reach: StripReach, platformSource: string, currency: string): StripItem[] {
  const clicks = funnel.clicks
  const signupRate = clicks === null || clicks === 0 || !funnel.everyClickCounted ? null : funnel.signups / clicks
  const lead: StripItem[] =
    reach === null ? [] : [{ label: reach.label, value: formatKnown(reach.value), note: reach.note, source: reach.source }]
  return [
    ...lead,
    { label: 'Comments', value: formatKnown(funnel.replies), source: platformSource },
    {
      label: METRIC_LABELS.clicks,
      value: formatKnown(clicks),
      note: reach?.value && clicks !== null ? `${formatPercent(clicks / reach.value, 2)} of ${reach.label.toLowerCase()}` : undefined,
      source: clicks === null ? 'Not counted: the posts link to the sponsor directly' : 'Tracked links',
    },
    {
      label: CONVERSION_KIND_LABELS.signup,
      value: formatCount(funnel.signups),
      note: signupRate === null ? undefined : `${formatPercent(signupRate)} of clicks`,
      source: 'PostHog, first touch',
    },
    { label: CONVERSION_KIND_LABELS.paid, value: formatCount(funnel.paid), source: 'PostHog, first touch' },
    { label: VALUE_LABEL, value: formatMoney(funnel.value, currency), source: 'Paid times the value per paid customer' },
  ]
}

/** An account's karma or followers over the window, one point per day read, on its own scale. */
export function ReachLine(props: { points: { day: string; value: number }[]; label: string }) {
  const width = 640
  const height = 96
  const pad = { top: 8, right: 8, bottom: 20, left: 8 }
  const innerW = width - pad.left - pad.right
  const innerH = height - pad.top - pad.bottom
  const values = props.points.map((point) => point.value)
  const low = Math.min(...values)
  const span = Math.max(1, Math.max(...values) - low)
  const x = (index: number) => pad.left + (props.points.length <= 1 ? innerW / 2 : (index / (props.points.length - 1)) * innerW)
  const y = (value: number) => pad.top + innerH - ((value - low) / span) * innerH
  const d = props.points.map((point, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(1)},${y(point.value).toFixed(1)}`).join(' ')
  const labelEvery = Math.max(1, Math.round(props.points.length / 6))
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-24 w-full" role="img" aria-label={`${props.label} per day`}>
      <path d={d} fill="none" stroke={SERIES.reach} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {props.points.map(
        (point, index) =>
          index % labelEvery === 0 && (
            <text key={point.day} x={x(index)} y={height - 4} textAnchor="middle" className="fill-ash font-mono text-[10px]">
              {formatDay(point.day, { month: 'short', day: 'numeric' })}
            </text>
          )
      )}
    </svg>
  )
}
