import { POST_STATUS_TINTS, SPONSOR_SEGMENT_LABELS, communityLabel, handleOf, letGo, needsOperator, type PostKind } from '@influstep/shared'
import { Link } from '@tanstack/react-router'
import { api } from '@influstep/convex/_generated/api'
import type { FunctionReturnType } from 'convex/server'
import { cn } from '@/lib/cn'
import { formatTime } from '@/lib/format'
import { ideaLine } from '@/lib/ideas'
import { PostKindIcon, PostShape, StatusDot, TINT_CLASS } from './status'

export type CalendarPost = FunctionReturnType<typeof api.private.calendar.week>['days'][number]['posts'][number]

/**
 * One post on Today. The status is a wash and a dot; the kind icon and
 * the first line at weight 500, and under it what the planner asked of it:
 * the intent and the length. An idea has no words yet, so it says when the
 * writer gets to them, or that it is on them now. One meta row closes it with
 * the account's handle and the time it is due (DESIGN.md).
 */
export function PostCard(props: { post: CalendarPost }) {
  const post = props.post
  // A border when the card needs the operator: it waits on them, or it failed.
  const loud = needsOperator(post.status)
  return (
    <Link
      to="/posts/$postId"
      params={{ postId: post._id }}
      className={cn(
        TINT_CLASS[POST_STATUS_TINTS[post.status]],
        'block min-w-0 rounded-lg border border-transparent px-2.5 py-2 transition-colors duration-150 ease-out-quint',
        'bg-[color-mix(in_oklch,var(--tint)_6%,var(--color-paper))] hover:border-[color-mix(in_oklch,var(--tint)_40%,transparent)]',
        { 'border-[color-mix(in_oklch,var(--tint)_35%,transparent)]': loud, 'opacity-60': letGo(post.status) }
      )}
    >
      <div className="flex items-start gap-2">
        <StatusDot status={post.status} className="mt-1.5" />
        <div className="min-w-0 flex-1">
          <PostLine kind={post.kind} text={postLine(post)} letGo={letGo(post.status)} />
          {/* Indented past the kind icon, so each line reads as part of the post line above it. */}
          <PostShape intent={post.intent} length={post.length} className="mt-0.5 block pl-5" />
          {post.status === 'idea' && <div className="mt-0.5 pl-5 text-[11px] text-ash">{ideaLine(post, post.writing)}</div>}
          {post.sponsorSegment !== 'none' && (
            <div className="mt-0.5 truncate pl-5 text-[11px] text-ash">{SPONSOR_SEGMENT_LABELS[post.sponsorSegment]}</div>
          )}
          {post.error && <div className="mt-1 line-clamp-1 font-mono text-[11px] text-signal-red-deep">{post.error}</div>}
          {/* The judge found too few reasons for readers to engage (shared judge.ts). */}
          {post.missingReasons.length > 0 && (
            <div className="mt-0.5 truncate pl-5 text-[11px] text-alert-amber-deep">No reason to {post.missingReasons.join(' or ')}</div>
          )}
          {/* One meta row: whose it is and when it is due. */}
          <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-ash">
            <span className="min-w-0 truncate font-mono">{handleOf(post.account)}</span>
            {post.community !== undefined && (
              <span className="min-w-0 truncate">{communityLabel(post.account.platform, post.community)}</span>
            )}
            <span className="tabular ml-auto shrink-0">{formatTime(post.scheduledAt)}</span>
          </div>
        </div>
      </div>
    </Link>
  )
}

function PostLine(props: { kind: PostKind; text: string; letGo: boolean }) {
  return (
    <div className="flex items-start gap-1.5">
      <PostKindIcon kind={props.kind} className="mt-[3px] shrink-0 text-graphite" />
      <span className={cn('line-clamp-2 min-w-0 text-[13px] leading-snug font-medium text-ink', { 'line-through': props.letGo })}>
        {props.text}
      </span>
    </div>
  )
}

/**
 * A written post reads by its first line (the post's hook). Before the
 * writer runs a post has no line yet, so the planned title stands in.
 */
function postLine(post: CalendarPost): string {
  if (post.hook === '') return post.title
  return post.hook
}
