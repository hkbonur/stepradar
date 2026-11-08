import { api } from '@influstep/convex/_generated/api'
import {
  REPLY_ORIGIN_LABELS,
  parsePostedLink,
  replyProblems,
  REACH_LABELS,
  handleOf,
  type Platform,
  type PlatformPlace,
  placeLabel,
  PLATFORM_DRAFT_SHAPES,
  REPLY_LIMITS,
  platformLength,
  type DraftShape,
  communityLabel,
} from '@influstep/shared'
import { ArrowSquareOutIcon } from '@phosphor-icons/react'
import { useMutation } from 'convex/react'
import type { FunctionReturnType } from 'convex/server'
import React from 'react'
import { CharacterCounter } from './character-counter'
import { PostedLinkField } from './posted-link-field'
import { Button, ErrorLine, ExternalLinkButton, Textarea } from './ui'
import { errorMessage } from '@/lib/errors'
import { formatCount, relativeTime } from '@/lib/format'

/**
 * A reply draft as the replies page and Today show it: the thread it
 * answers, quoted, and the editor the operator posts it from (ADR 0004).
 */

/** A waiting reply as the backend lists it (core/replies.ts `replyRowsOf`): the row, the variant it tests, whether it asks for its link. */
export type ReplyRow = NonNullable<FunctionReturnType<typeof api.private.replies.list>>['waiting'][number]

/** Who a reply answers, as the page names them: the author's handle, or the thread where the link named nobody. */
export function answering(thread: ReplyRow['thread'], platform: Platform): string {
  return thread.author === null ? 'the thread' : handleOf({ platform, handle: thread.author.handle })
}

/**
 * The thread a reply answers, quoted: who wrote it and its reach, where it
 * came from, when it was posted, and a link to it on its platform; what
 * nothing read (a pasted thread's author or time) is left out.
 */
export function ThreadQuote(props: { reply: ReplyRow; platform: Platform }) {
  const thread = props.reply.thread
  return (
    <div className="rounded-lg bg-paper-warm px-3 py-2">
      <p className="flex flex-wrap items-baseline gap-x-2 text-[11px] text-ash">
        {thread.author && <span className="font-medium text-graphite">{thread.author.name}</span>}
        {thread.author && <span className="font-mono">{handleOf({ platform: props.platform, handle: thread.author.handle })}</span>}
        {thread.community && <span>{communityLabel(props.platform, thread.community)}</span>}
        {thread.reach !== null && (
          <span>
            <span className="tabular">{formatCount(thread.reach)}</span> {REACH_LABELS[props.platform]}
          </span>
        )}
        <span>· {REPLY_ORIGIN_LABELS[props.reply.origin]}</span>
        {props.reply.pillar && <span>· {props.reply.pillar}</span>}
        {/* A reply heard during a reply experiment carries the variant it tests (Experiments page). */}
        {props.reply.variant && <span>· testing {props.reply.variant.label}</span>}
        <a href={thread.url} target="_blank" rel="noreferrer" className="underline decoration-fog hover:text-ink hover:decoration-ink">
          {thread.postedAt === null ? 'Open thread' : relativeTime(thread.postedAt)}
        </a>
      </p>
      {thread.title && <p className="mt-1 text-sm font-medium">{thread.title}</p>}
      <p className="mt-1 text-sm whitespace-pre-line text-graphite">{thread.text}</p>
    </div>
  )
}

/** What the draft field is called on each platform's shape (shared `PLATFORM_DRAFT_SHAPES`). */
const SHAPE_LABELS: Record<DraftShape, (author: string) => string> = {
  text: (author) => `Reply to ${author}`,
  rewrite: (author) => `Reply to ${author}, to say in your own words`,
  points: (author) => `Talking points for your comment to ${author}`,
}

/** Why the draft has its shape, under the field. */
const SHAPE_HINTS: Record<DraftShape, string> = {
  text: 'Ready to post as it stands, or edited.',
  rewrite: 'Many subreddits and forums remove text that reads machine-written: post it in your own words, then paste what you posted here.',
  points: 'Hacker News removes generated comments: write the comment yourself from these points, then paste what you posted here.',
}

type EditorAction = 'posted' | 'skip'
type EditorState = { status: 'idle' } | { status: 'saving'; action: EditorAction } | { status: 'error'; message: string }

/**
 * A draft the operator posts by hand, as one card: the thread it answers, the
 * draft in its platform's shape in an editable field counted by the
 * platform's rule, its problems as the operator types, then a band of actions:
 * Open thread and Copy (each stamps when the draft was opened), the link to it
 * once posted, I posted it, which records the words as they stand (ADR 0004),
 * and Skip, which passes on it.
 */
export function ReplyEditor(props: {
  reply: ReplyRow
  place: PlatformPlace
  /** One line above the thread: whose it is, or who answered whom. */
  heading?: React.ReactNode
  onDone: (message: string) => void
}) {
  const platform = props.place.platform
  const markPosted = useMutation(api.private.replies.markPosted)
  const skip = useMutation(api.private.replies.skip)
  const [text, setText] = React.useState(props.reply.text)
  const [url, setUrl] = React.useState('')
  const [state, setState] = React.useState<EditorState>({ status: 'idle' })
  const id = React.useId()
  const counterId = `${id}-counter`
  const problemsId = `${id}-problems`
  const hintId = `${id}-hint`
  // The operator may name the sponsor in a reply they post themselves; the backend checks the same rules again.
  const problems = replyProblems(text, platform)
  const linkInvalid = parsePostedLink(props.place, url).kind === 'invalid'
  const shape = PLATFORM_DRAFT_SHAPES[platform]
  const opened = useMutation(api.private.replies.opened)
  const stampOpened = () => void opened({ replyId: props.reply._id })
  const copy = async () => {
    await navigator.clipboard.writeText(text)
    stampOpened()
  }
  const author = answering(props.reply.thread, platform)
  const run = async (action: EditorAction, send: () => Promise<unknown>, done: string) => {
    if (state.status === 'saving') return
    setState({ status: 'saving', action })
    try {
      await send()
      setState({ status: 'idle' })
      props.onDone(done)
    } catch (caught) {
      setState({ status: 'error', message: errorMessage(caught) })
    }
  }
  return (
    <article className="surface">
      <div className="card-pad space-y-3">
        {props.heading !== undefined && <div className="text-xs">{props.heading}</div>}
        <ThreadQuote reply={props.reply} platform={platform} />
        <div className="grid gap-1.5">
          <div className="flex items-center justify-between gap-3">
            <label htmlFor={id} className="text-xs font-medium text-graphite">
              {SHAPE_LABELS[shape](author)}
              {props.reply.operatorAsked && <span className="font-normal text-ash"> · you asked for this one</span>}
            </label>
            <CharacterCounter id={counterId} length={platformLength(text, platform)} limit={REPLY_LIMITS[platform]} />
          </div>
          <Textarea
            id={id}
            value={text}
            aria-describedby={`${hintId} ${counterId} ${problemsId}`}
            aria-invalid={problems.length > 0 || state.status === 'error'}
            onChange={(event) => {
              setText(event.target.value)
              // The refusal was about the words; new words make it stale.
              if (state.status === 'error') setState({ status: 'idle' })
            }}
          />
          <p id={hintId} className="text-xs text-ash">
            {SHAPE_HINTS[shape]}
          </p>
          <ul id={problemsId} aria-live="polite" className="space-y-0.5 text-xs text-signal-red-deep empty:hidden">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
        {state.status === 'error' && <ErrorLine>{state.message}</ErrorLine>}
      </div>
      {/* The actions, on their own band: open and copy at the left, then say it went out. */}
      <div className="card-band space-y-2">
        {/* Opened two days ago and not found (shared asksForLink): the link is how it gets measured. */}
        {props.reply.asksForLink && (
          <p className="text-xs text-ash">Posted it already? Paste its link and say so, so it can be measured.</p>
        )}
        <div className="flex flex-wrap items-start gap-2">
          <ExternalLinkButton href={props.reply.thread.url} size="sm" variant="ghost" onClick={stampOpened}>
            Open thread
            <ArrowSquareOutIcon aria-hidden size={12} />
          </ExternalLinkButton>
          {/* Talking points are for writing from, not for pasting. */}
          {shape !== 'points' && (
            <Button size="sm" variant="outline" onClick={() => void copy()}>
              Copy
            </Button>
          )}
          <PostedLinkField
            place={props.place}
            label={`Link to your reply to ${author}`}
            showLabel={false}
            value={url}
            onChange={setUrl}
            placeholder={`Link to your reply on ${placeLabel(props.place)} (optional)`}
            compact
            className="min-w-56 flex-1"
          />
          <Button
            size="sm"
            variant="primary"
            busy={state.status === 'saving' && state.action === 'posted'}
            disabled={problems.length > 0 || linkInvalid}
            onClick={() =>
              void run('posted', () => markPosted({ replyId: props.reply._id, text, url }), `Marked your reply to ${author} posted.`)
            }
          >
            I posted it
          </Button>
          <Button
            size="sm"
            variant="ghost"
            busy={state.status === 'saving' && state.action === 'skip'}
            onClick={() =>
              void run(
                'skip',
                () => skip({ replyId: props.reply._id }),
                // Passing on a comment's answer lets the comment go with it (shared COMMENT_STATUS_OF_ANSWER).
                props.reply.origin === 'comment' || props.reply.origin === 'mention'
                  ? `Let ${author}'s comment go.`
                  : `Skipped ${author}'s post.`
              )
            }
          >
            Skip
          </Button>
        </div>
      </div>
    </article>
  )
}
