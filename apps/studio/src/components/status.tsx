import type { Doc } from '@influstep/convex/_generated/dataModel'
import {
  POST_STATUS_LABELS,
  POST_STATUS_TINTS,
  POST_INTENT_LABELS,
  POST_KIND_LABELS,
  POST_LENGTH_LABELS,
  SPONSOR_SEGMENT_LABELS,
  letGo,
  type PostStatus,
  type JobStatus,
  type PostIntent,
  type PostKind,
  type PostLength,
  type SponsorSegment,
  type StatusTint,
} from '@influstep/shared'
import { ListNumbersIcon, TextTIcon, type Icon } from '@phosphor-icons/react'
import { cn } from '@/lib/cn'
import { relativeTime } from '@/lib/format'
import { ErrorLine, Pill } from './ui'

/** Literal class names, so Tailwind sees every tint utility (a template string would hide them). */
export const TINT_CLASS: Record<StatusTint, string> = {
  fog: 'tint-fog',
  'alert-amber': 'tint-alert-amber',
  'field-green': 'tint-field-green',
  ink: 'tint-ink',
  'signal-red': 'tint-signal-red',
}

export function StatusPill(props: { status: PostStatus }) {
  return (
    <Pill tint={POST_STATUS_TINTS[props.status]} struck={letGo(props.status)}>
      {POST_STATUS_LABELS[props.status]}
    </Pill>
  )
}

/** A post's status as a dot in its tint, for a row too narrow for the pill; screen readers hear the status's name first, the way the eye meets the dot. */
export function StatusDot(props: { status: PostStatus; className?: string }) {
  return (
    <>
      <span
        aria-hidden
        className={cn(TINT_CLASS[POST_STATUS_TINTS[props.status]], 'size-1.5 shrink-0 rounded-full bg-[var(--tint)]', props.className)}
      />
      <span className="sr-only">{POST_STATUS_LABELS[props.status]}:</span>
    </>
  )
}

export function SponsorPill(props: { segment: SponsorSegment }) {
  if (props.segment === 'none') return null
  return <Pill tint="ink">{SPONSOR_SEGMENT_LABELS[props.segment]}</Pill>
}

const POST_KIND_ICON: Record<PostKind, Icon> = { text: TextTIcon, thread: ListNumbersIcon }

/**
 * Which kind a post is, as a 14px Phosphor icon (DESIGN.md, Kind icons). The
 * icon is decorative; the kind's name is its text alternative, read only by screen
 * readers unless `showLabel` prints it beside the icon, so a screen reader
 * never hears the kind twice.
 */
export function PostKindIcon(props: { kind: PostKind; showLabel?: boolean; className?: string }) {
  const KindIcon = POST_KIND_ICON[props.kind]
  return (
    <>
      <KindIcon size={14} aria-hidden className={props.className} />
      <span className={cn({ 'sr-only': !props.showLabel })}>{POST_KIND_LABELS[props.kind]}</span>
    </>
  )
}

/** A post's intent and length in plain words, "Ask · One-liner": small and ash, never a control (DESIGN.md, Post card). */
export function PostShape(props: { intent: PostIntent; length: PostLength; className?: string }) {
  return (
    <span className={cn('text-[11px] text-ash', props.className)}>
      {POST_INTENT_LABELS[props.intent]} · {POST_LENGTH_LABELS[props.length]}
    </span>
  )
}

type JobLine = Pick<Doc<'jobs'>, 'status' | 'createdAt' | 'startedAt' | 'finishedAt' | 'error'>

const JOB_STATUS_WORDS: Record<JobStatus, string> = { queued: 'Queued', running: 'Running', done: 'Done', failed: 'Failed' }

/**
 * A job's status as a 6px dot (DESIGN.md, Job state): green done, red failed,
 * blue running, fog queued. Decorative; the status word or the job list beside
 * it says the same in text.
 */
export function JobDot(props: { status: JobStatus; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('size-1.5 shrink-0 rounded-full', props.className, {
        'bg-field-green': props.status === 'done',
        'bg-signal-red': props.status === 'failed',
        'bg-note-blue': props.status === 'running',
        'bg-fog': props.status === 'queued',
      })}
    />
  )
}

/**
 * Where the job a button queued stands, for the buttons that queue one (Import
 * from X, Learn the voice): a dot and a word with when it last moved, and a
 * failed job's error under it, which is where a refusal from the agent shows.
 * It is not a live region itself: the caller wraps it in a polite live region
 * that stays mounted, so the first job appearing is announced as well as each
 * change from queued to done.
 */
export function JobState(props: { job: JobLine }) {
  const job = props.job
  return (
    <div className="space-y-1.5">
      <p className="flex items-center gap-2 font-mono text-[11px] text-ash">
        <JobDot status={job.status} />
        {JOB_STATUS_WORDS[job.status]} {relativeTime(job.finishedAt ?? job.startedAt ?? job.createdAt)}
      </p>
      {job.status === 'failed' && job.error && <ErrorLine>{job.error}</ErrorLine>}
    </div>
  )
}
