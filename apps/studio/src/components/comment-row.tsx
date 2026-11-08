import { api } from '@influstep/convex/_generated/api'
import { handleOf } from '@influstep/shared'
import { useMutation } from 'convex/react'
import type { FunctionReturnType } from 'convex/server'
import React from 'react'
import { Link } from '@tanstack/react-router'
import { AccountLabel } from './account-mark'
import { ReplyEditor } from './reply-editor'
import { Button, ErrorLine } from './ui'
import { errorMessage } from '@/lib/errors'
import { relativeTime } from '@/lib/format'

type WaitingComment = FunctionReturnType<typeof api.private.today.view>['comments']['shown'][number]

/** What the operator reads where no draft waits (core/today.ts `CommentAnswer`). */
const NO_DRAFT: Record<Exclude<WaitingComment['answer']['kind'], 'draft'>, string> = {
  drafting: 'The writer is drafting its answer.',
  replies_off: 'Replies are off for this account, so no answer is drafted: answer it in your own words, or let it go.',
  paused: 'The account is paused, so no answer is drafted: answer it in your own words, or let it go.',
}

/**
 * A comment that waits for its answer, as one card: who answered whom, then
 * the answer drafted for it, posted from the same card as any reply, whose
 * Skip lets the comment go too. Where no draft waits, the comment quoted and
 * Let it go, which lets it go.
 */
export function CommentRow(props: { row: WaitingComment; onDone: (message: string) => void }) {
  const dismiss = useMutation(api.private.comments.dismiss)
  const [state, setState] = React.useState<{ status: 'idle' } | { status: 'saving' } | { status: 'error'; message: string }>({
    status: 'idle',
  })
  const { comment, account, answer } = props.row
  const who = handleOf({ platform: account.platform, handle: comment.author.handle })
  const letGo = async () => {
    if (state.status === 'saving') return
    setState({ status: 'saving' })
    try {
      await dismiss({ commentId: comment._id })
      props.onDone(`Let ${who}'s comment go.`)
    } catch (caught) {
      setState({ status: 'error', message: errorMessage(caught) })
    }
  }
  const heading = (
    <Link to="/accounts/$accountId" params={{ accountId: account._id }} className="hover:underline">
      <AccountLabel platform={account.platform} name={account.name} />
    </Link>
  )
  // A drafted answer quotes its comment itself, above the editor.
  if (answer.kind === 'draft') return <ReplyEditor reply={answer.reply} place={account} heading={heading} onDone={props.onDone} />
  return (
    <article className="surface">
      <div className="card-pad space-y-3">
        <div className="text-xs">{heading}</div>
        <div className="rounded-lg bg-paper-warm px-3 py-2">
          <p className="flex flex-wrap items-baseline gap-x-2 text-[11px] text-ash">
            <span className="font-mono text-graphite">{who}</span>
            <span>· {comment.inReplyTo === undefined ? 'Named the account' : 'Answered its post'}</span>
            <a href={comment.url} target="_blank" rel="noreferrer" className="underline decoration-fog hover:text-ink">
              {relativeTime(comment.postedAt)}
            </a>
          </p>
          <p className="mt-1 text-sm whitespace-pre-line text-graphite">{comment.text}</p>
        </div>
        {state.status === 'error' && <ErrorLine>{state.message}</ErrorLine>}
      </div>
      <div className="card-band flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-ash">{NO_DRAFT[answer.kind]}</p>
        <Button size="sm" variant="ghost" busy={state.status === 'saving'} onClick={() => void letGo()}>
          Let it go
        </Button>
      </div>
    </article>
  )
}
