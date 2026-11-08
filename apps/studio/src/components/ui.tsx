import { CaretRightIcon, CheckCircleIcon, InfoIcon, WarningCircleIcon, WarningIcon, type Icon } from '@phosphor-icons/react'
import { Link, type LinkProps } from '@tanstack/react-router'
import React from 'react'
import type { StatusTint } from '@influstep/shared'
import { cn } from '@/lib/cn'
import { TINT_CLASS } from './status'

/** The small vocabulary every screen shares (DESIGN.md, Components). */

/** One form is idle, saving, or showing why the save failed; never two of those at once. */
export type FormState = { status: 'idle' } | { status: 'saving' } | { status: 'error'; message: string }

type ButtonVariant = 'primary' | 'ghost' | 'destructive' | 'outline'

const BUTTON: Record<ButtonVariant, string> = {
  primary: 'bg-ink text-paper hover:bg-ink-deep disabled:hover:bg-ink',
  outline: 'border border-mist bg-paper text-ink hover:bg-paper-tint',
  ghost: 'text-ink hover:bg-hairline-strong',
  destructive: 'text-signal-red-deep hover:bg-signal-red/10',
}

type ButtonSize = 'sm' | 'md'

/** Shared by Button and LinkButton, so a link that looks like a button is the same size, focus ring and all. */
function buttonClass(variant: ButtonVariant, size: ButtonSize, className: string | undefined): string {
  return cn(
    'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg font-medium whitespace-nowrap transition-colors duration-150 ease-out-quint outline-none focus-visible:ring-2 focus-visible:ring-fog disabled:cursor-not-allowed disabled:opacity-50',
    { 'h-8 px-3 text-sm': size === 'md', 'h-7 px-2.5 text-xs': size === 'sm' },
    BUTTON[variant],
    className
  )
}

/** Takes a `ref` like the element (React 19 passes it as a prop), so a confirm step can hand focus back to the button that opened it. */
/**
 * While `busy`, the button says so (aria-busy) and ignores clicks, a form's
 * submit included, but is never disabled: a disabled button drops the focus
 * it holds to the page body.
 */
export function Button(props: React.ComponentProps<'button'> & { variant?: ButtonVariant; size?: ButtonSize; busy?: boolean }) {
  const { variant = 'outline', size = 'md', busy, className, children, onClick, ...rest } = props
  return (
    <button
      type="button"
      {...rest}
      aria-busy={busy || undefined}
      onClick={(event) => {
        if (busy) {
          event.preventDefault()
          return
        }
        onClick?.(event)
      }}
      className={buttonClass(variant, size, className)}
    >
      {busy && <Spinner />}
      {children}
    </button>
  )
}

export function LinkButton(
  props: LinkProps & { className?: string; variant?: ButtonVariant; size?: ButtonSize; children: React.ReactNode }
) {
  const { className, variant = 'outline', size = 'md', children, ...rest } = props
  return (
    <Link {...rest} className={buttonClass(variant, size, className)}>
      {children}
    </Link>
  )
}

/**
 * A page outside the studio, styled as a button. It always opens in a new tab,
 * so the operator keeps the studio where they left it; a router Link would try
 * to route the address inside the app.
 */
export function ExternalLinkButton(props: {
  href: string
  className?: string
  variant?: ButtonVariant
  size?: ButtonSize
  onClick?: () => void
  children: React.ReactNode
}) {
  return (
    <a
      href={props.href}
      target="_blank"
      rel="noreferrer"
      onClick={props.onClick}
      className={buttonClass(props.variant ?? 'outline', props.size ?? 'md', props.className)}
    >
      {props.children}
    </a>
  )
}

/** A small ring in the current text color. Decorative: the words beside it say what is in progress. */
export function Spinner() {
  return <span aria-hidden className="size-3 shrink-0 animate-spin rounded-full border-[1.5px] border-current border-r-transparent" />
}

export function PageHeader(props: { title: string; lead?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h1 className="text-metric">{props.title}</h1>
        {props.lead && <p className="mt-1 max-w-[65ch] text-ash">{props.lead}</p>}
      </div>
      {props.actions && <div className="flex flex-wrap items-center gap-2">{props.actions}</div>}
    </header>
  )
}

export function Empty(props: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-fog px-4 py-6 text-ash">
      <p className="max-w-[55ch]">{props.children}</p>
      {props.action}
    </div>
  )
}

export function Mono(props: { children: React.ReactNode; className?: string }) {
  return <span className={cn('font-mono text-[0.8125rem] tabular', props.className)}>{props.children}</span>
}

export function Pill(props: { tint: StatusTint; children: React.ReactNode; className?: string; struck?: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center gap-1.5 rounded-full px-2 text-xs font-medium whitespace-nowrap',
        TINT_CLASS[props.tint],
        'bg-[color-mix(in_oklch,var(--tint)_18%,transparent)] text-[var(--tint-deep)]',
        { 'line-through': props.struck },
        props.className
      )}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-[var(--tint)]" />
      {props.children}
    </span>
  )
}

/** Takes a `ref` like the element (React 19 passes it as a prop), so the post editor can move focus between parts. */
export function Textarea(props: React.ComponentProps<'textarea'>) {
  const { className, ...rest } = props
  return <textarea {...rest} className={cn('field h-auto min-h-20 resize-y py-2 leading-relaxed', className)} />
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { className, ...rest } = props
  return <input {...rest} className={cn('field', className)} />
}

/**
 * A labelled control. The hint sits outside the label, so it is not read as
 * part of the control's name; a single control is described by it instead.
 */
export function Field(props: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  const hintId = React.useId()
  const described =
    props.hint && React.isValidElement<{ 'aria-describedby'?: string }>(props.children)
      ? React.cloneElement(props.children, { 'aria-describedby': hintId })
      : props.children
  return (
    <div className={cn('flex flex-col gap-1.5', props.className)}>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-graphite">{props.label}</span>
        {described}
      </label>
      {props.hint && (
        <span id={hintId} className="text-xs text-ash">
          {props.hint}
        </span>
      )}
    </div>
  )
}

/** A short line that names mock data as mock, on every screen that shows numbers. */
export function MockNote(props: { when: boolean; children?: React.ReactNode }) {
  if (!props.when) return null
  return <p className="text-xs text-ash">{props.children ?? 'Mock providers: these numbers are generated, not measured.'}</p>
}

/**
 * What the report can vouch for and what it cannot (docs/plan.md, v0.2),
 * wherever conversions are counted. One line stays in view, the caveat
 * included, so the numbers above it are never read as more exact than they
 * are; the rest opens on request, so the paragraph does not push the funnel
 * down the page.
 */
export function AttributionNote() {
  return (
    <details className="max-w-[65ch] text-xs text-ash">
      <summary className="cursor-pointer hover:text-graphite">
        Platform counts and exact clicks; signups and paid from PostHog, first touch, which undercounts.
      </summary>
      <p className="mt-1">
        Reach and comments are each platform's own counts. Clicks are exact where a tracked link counts them, on X and LinkedIn; a Reddit or
        Hacker News post links to the sponsor directly, so its clicks are not counted. Demos, signups, trials and paid come from PostHog,
        first touch, and undercount visitors who declined cookies. Probable conversions carry no UTM parameters: the person said where they
        heard of the sponsor, or first came from a platform's domain, so they are shown apart and name the platform only.
      </p>
    </details>
  )
}

export function Skeleton(props: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-hairline-strong', props.className)} />
}

export function ErrorLine(props: { children: React.ReactNode }) {
  return <p className="rounded-lg bg-signal-red/8 px-3 py-2 font-mono text-xs break-words text-signal-red-deep">{props.children}</p>
}

/**
 * Whether an optional slot holds something to show. A caller writes
 * `cond && <X />`, which hands a slot `false` (or `null`) when there is
 * nothing, and a slot that rendered its wrapper anyway would leave a gap.
 */
export function filled(node: React.ReactNode): boolean {
  return node !== undefined && node !== null && node !== false && node !== ''
}

/** A count beside a title or a tab: mono, quiet, never a status. */
function Count(props: { value: number; className?: string }) {
  return (
    <span className={cn('rounded-full bg-hairline-strong px-1.5 py-px font-mono text-[11px] text-graphite tabular', props.className)}>
      {props.value}
    </span>
  )
}

/**
 * Things that belong together, on paper over the canvas (DESIGN.md, Card): a
 * title row with its count, a one-line description and its actions, then the
 * body. `flush` hands the body the card's full width, for a list divided by
 * hairlines whose rows pad themselves. Never nested in another card.
 */
export function Card(props: {
  title?: React.ReactNode
  description?: React.ReactNode
  count?: number
  actions?: React.ReactNode
  footer?: React.ReactNode
  flush?: boolean
  className?: string
  children?: React.ReactNode
}) {
  const titleId = React.useId()
  const hasHeader = filled(props.title) || filled(props.actions)
  return (
    <section
      aria-labelledby={props.title === undefined ? undefined : titleId}
      className={cn('surface min-w-0', { 'overflow-hidden': props.flush }, props.className)}
    >
      {hasHeader && (
        <header
          className={cn('flex flex-wrap items-start justify-between gap-x-4 gap-y-2 card-x pt-4', {
            'pb-3': !props.flush,
            'border-b border-mist pb-3': props.flush,
          })}
        >
          <div className="min-w-0">
            {props.title !== undefined && (
              <h2 id={titleId} className="flex items-center gap-2 text-title">
                {props.title}
                {props.count !== undefined && <Count value={props.count} />}
              </h2>
            )}
            {filled(props.description) && <p className="mt-0.5 text-xs text-ash">{props.description}</p>}
          </div>
          {filled(props.actions) && <div className="flex flex-wrap items-center gap-2">{props.actions}</div>}
        </header>
      )}
      {filled(props.children) && (
        <div className={cn({ 'card-x pb-4 sm:pb-5': !props.flush, 'pt-4': !props.flush && !hasHeader })}>{props.children}</div>
      )}
      {filled(props.footer) && <footer className="border-t border-mist card-x py-3 text-xs text-ash">{props.footer}</footer>}
    </section>
  )
}

/** A row of a flush card's list: the card's padding, a hairline between rows. */
export function CardList(props: { children: React.ReactNode; className?: string }) {
  return <ul className={cn('divide-y divide-mist [&>li]:card-x [&>li]:py-3', props.className)}>{props.children}</ul>
}

type AlertTone = 'info' | 'warning' | 'danger' | 'success'

const ALERT_TONES: Record<AlertTone, { tint: string; icon: Icon }> = {
  info: { tint: 'tint-note-blue', icon: InfoIcon },
  warning: { tint: 'tint-alert-amber', icon: WarningIcon },
  danger: { tint: 'tint-signal-red', icon: WarningCircleIcon },
  success: { tint: 'tint-field-green', icon: CheckCircleIcon },
}

/**
 * Something the operator should see before the rest of the page: a full
 * border and a wash in the tone's tint, its icon, a title and a line, and at
 * most one action at the right. Never a side stripe. Red is a failure, amber
 * waits on the operator, blue informs, green says it worked.
 */
export function Alert(props: {
  tone: AlertTone
  title: React.ReactNode
  children?: React.ReactNode
  action?: React.ReactNode
  className?: string
}) {
  const tone = ALERT_TONES[props.tone]
  const ToneIcon = tone.icon
  return (
    <div
      className={cn(
        tone.tint,
        'flex flex-wrap items-start gap-x-3 gap-y-2 rounded-xl border border-[color-mix(in_oklch,var(--tint)_35%,transparent)] bg-[color-mix(in_srgb,var(--tint)_7%,var(--color-paper))] px-4 py-3',
        props.className
      )}
    >
      <ToneIcon aria-hidden size={18} weight="fill" className="mt-px shrink-0 text-[var(--tint-deep)]" />
      {/* On a narrow screen the action wraps under the words instead of squeezing them. */}
      <div className="min-w-0 flex-1 basis-48">
        <p className="font-medium text-ink">{props.title}</p>
        {filled(props.children) && <div className="mt-0.5 text-sm text-graphite">{props.children}</div>}
      </div>
      {props.action !== undefined && <div className="ml-[30px] flex shrink-0 items-center gap-2 sm:ml-0">{props.action}</div>}
    </div>
  )
}

/**
 * What the operator opens only when they need it: a summary with a caret and
 * its count, then the rest. A `details` element, so it opens by keyboard and
 * the browser's find opens it too. Nothing interactive sits in the summary.
 */
export function Collapsible(props: {
  summary: React.ReactNode
  count?: number
  meta?: React.ReactNode
  defaultOpen?: boolean
  /** In a flush card: the summary pads itself like a row, and the body is the card's full width. */
  inset?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <details open={props.defaultOpen} className={cn('group', props.className)}>
      <summary
        className={cn(
          'flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-graphite outline-none select-none hover:text-ink focus-visible:ring-2 focus-visible:ring-fog [&::-webkit-details-marker]:hidden',
          { 'rounded-md py-1': !props.inset, 'card-x py-3 hover:bg-paper-tint': props.inset }
        )}
      >
        <CaretRightIcon
          aria-hidden
          size={12}
          weight="bold"
          className="shrink-0 text-ash transition-transform duration-150 ease-out-quint group-open:rotate-90"
        />
        <span>{props.summary}</span>
        {props.count !== undefined && <Count value={props.count} />}
        {filled(props.meta) && <span className="ml-auto text-xs font-normal text-ash">{props.meta}</span>}
      </summary>
      <div className={cn({ 'pt-2': !props.inset, 'border-t border-mist': props.inset })}>{props.children}</div>
    </details>
  )
}

/** A tab of a TabNav: a link to its view, current when the page shows it. */
export interface TabItem {
  key: string
  label: string
  count?: number
  current: boolean
  link: LinkProps
}

/**
 * Views of one thing, as links (an account's pages, Today's lists): the
 * current one in ink over a 2px ink rule, the rest ash. Links, not a tablist,
 * so each view has its address and the back button walks them. `segmented`
 * is the second level, for views inside a page that already has tabs: a
 * hairline track with the current view raised on paper.
 */
export function TabNav(props: { label: string; items: TabItem[]; segmented?: boolean; className?: string }) {
  if (props.segmented) {
    return (
      <nav aria-label={props.label} className={cn('max-w-full overflow-x-auto', props.className)}>
        <ul className="flex w-max gap-0.5 rounded-lg bg-hairline-strong p-0.5">
          {props.items.map((item) => (
            <li key={item.key}>
              <Link
                {...item.link}
                aria-current={item.current ? 'page' : undefined}
                className={cn(
                  'flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-fog',
                  { 'bg-paper text-ink shadow-[0_1px_2px_0_oklch(0%_0_0/0.08)]': item.current, 'text-ash hover:text-ink': !item.current }
                )}
              >
                {item.label}
                {item.count !== undefined && <Count value={item.count} />}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    )
  }
  return (
    <nav aria-label={props.label} className={cn('-mx-1 overflow-x-auto border-b border-mist', props.className)}>
      <ul className="flex min-w-max gap-1 px-1">
        {props.items.map((item) => (
          <li key={item.key}>
            <Link
              {...item.link}
              aria-current={item.current ? 'page' : undefined}
              className={cn(
                '-mb-px flex h-10 items-center gap-2 border-b-2 px-2.5 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-fog',
                { 'border-ink text-ink': item.current, 'border-transparent text-ash hover:text-ink': !item.current }
              )}
            >
              {item.label}
              {item.count !== undefined && <Count value={item.count} />}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}

/** How far a count has come toward its whole: a 4px mist track filled in graphite. Hidden from assistive tech, since the words beside it say the same. */
export function Meter(props: { value: number; max: number; className?: string }) {
  const share = props.max <= 0 ? 0 : Math.min(1, props.value / props.max)
  return (
    <div aria-hidden className={cn('h-1 overflow-hidden rounded-full bg-mist', props.className)}>
      <div className="h-full rounded-full bg-graphite" style={{ width: `${share * 100}%` }} />
    </div>
  )
}
