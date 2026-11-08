import { api } from '@influstep/convex/_generated/api'
import type { Id } from '@influstep/convex/_generated/dataModel'
import { REPLY_STATUS_LABELS, postedItemOf, repliesLeft, wentOutAt, type Platform, placeLabel, type PlatformPlace } from '@influstep/shared'
import { createFileRoute } from '@tanstack/react-router'
import { useAction, useMutation, useQuery } from 'convex/react'
import type { FunctionReturnType } from 'convex/server'
import React from 'react'
import { z } from 'zod'
import { AccountFrame } from '@/components/account-frame'
import { ReplyEditor, ThreadQuote, answering } from '@/components/reply-editor'
import {
  Button,
  Card,
  CardList,
  Collapsible,
  Empty,
  ErrorLine,
  Field,
  type FormState,
  Input,
  Meter,
  MockNote,
  Skeleton,
  TabNav,
  Textarea,
} from '@/components/ui'
import { cn } from '@/lib/cn'
import { errorMessage } from '@/lib/errors'
import { ItemNumbers, notReadText } from '@/components/item-numbers'
import { plural, relativeTime } from '@/lib/format'

/** The page's lists, each a tab, named by the reply status's own label. */
const VIEWS = ['waiting', 'heard', 'posted', 'skipped'] as const
type RepliesView = (typeof VIEWS)[number]

const searchSchema = z.object({ view: z.enum(VIEWS).optional() })

// `$accountId_`: the same /accounts/:id/replies address, outside the account page's route, like the memory and strategy
// pages. The account page renders no outlet, so a route nested under it would show the account page and never this one.
export const Route = createFileRoute('/accounts/$accountId_/replies')({ component: RepliesPage, validateSearch: searchSchema })

/*
 * Where the page reads from (core/replies.ts, repliesView):
 * - private.replies.list: the account's name and handle, today's reply budget and how much of it was drafted, then
 *   its replies by where they stand: `waiting` (drafts, what the operator asked for first, then the threads that reach most), `beingWritten`,
 *   and the newest 30 `posted` and `skipped`.
 */
type RepliesData = NonNullable<FunctionReturnType<typeof api.private.replies.list>>
type Reply = RepliesData['waiting'][number]

/**
 * An account's replies (DESIGN.md, Replies page), in the account's frame: the
 * drafts that wait for the operator to post by hand, what the writer has not
 * drafted yet, what the operator posted and what it brought back, and what
 * the account passed on and why, one tab each; beside them today's budget and
 * a thread to answer by hand.
 */
function RepliesPage() {
  const params = Route.useParams()
  const search = Route.useSearch()
  const accountId = params.accountId as Id<'accounts'>
  const data = useQuery(api.private.replies.list, { accountId })
  return (
    <AccountFrame accountId={accountId} tab="replies">
      {data === undefined && <Skeleton className="h-96 rounded-xl" />}
      {data !== undefined && data !== null && <Replies data={data} view={search.view ?? 'waiting'} />}
    </AccountFrame>
  )
}

function Replies(props: { data: RepliesData; view: RepliesView }) {
  const data = props.data
  const platform = data.account.platform
  // One status line for the page: marking posted, skipping or asking moves the card the button sat in to another tab.
  const statusRef = React.useRef<HTMLParagraphElement>(null)
  const [status, setStatus] = React.useState<string | null>(null)
  const onDone = (message: string) => {
    setStatus(message)
    statusRef.current?.focus()
  }
  const all = [...data.waiting, ...data.beingWritten, ...data.posted, ...data.skipped]
  const counts: Record<RepliesView, number> = {
    waiting: data.waiting.length,
    heard: data.beingWritten.length,
    posted: data.posted.length,
    skipped: data.skipped.length,
  }
  const labels: Record<RepliesView, string> = {
    waiting: REPLY_STATUS_LABELS.draft,
    heard: REPLY_STATUS_LABELS.heard,
    posted: REPLY_STATUS_LABELS.posted,
    skipped: REPLY_STATUS_LABELS.skipped,
  }
  return (
    <>
      <p ref={statusRef} tabIndex={-1} aria-live="polite" className={cn('text-sm outline-none', { 'mb-4': status !== null })}>
        {status}
      </p>
      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-4">
          <TabNav
            segmented
            label="Replies by where they stand"
            items={VIEWS.map((view) => ({
              key: view,
              label: labels[view],
              count: counts[view],
              current: view === props.view,
              link: { to: '/accounts/$accountId/replies', params: { accountId: data.account._id }, search: { view } },
            }))}
          />
          <div hidden={props.view !== 'waiting'} className="space-y-3">
            {data.waiting.length === 0 && <Empty>Nothing waits for you. The listener looks for threads to answer every hour.</Empty>}
            {data.waiting.map((reply) => (
              <ReplyEditor key={reply._id} reply={reply} place={data.account} onDone={onDone} />
            ))}
          </div>
          {/* What the writer has not drafted yet: it drafts within the day's budget, so the rest waits for tomorrow's. */}
          <div hidden={props.view !== 'heard'}>
            {data.beingWritten.length === 0 && <Empty>The writer has drafted everything the listener kept.</Empty>}
            {data.beingWritten.length > 0 && (
              <Card description="The writer drafts within the day's budget; the rest waits for tomorrow's." flush>
                <CardList>
                  {data.beingWritten.map((reply) => (
                    <li key={reply._id}>
                      <ThreadQuote reply={reply} platform={platform} />
                    </li>
                  ))}
                </CardList>
              </Card>
            )}
          </div>
          <div hidden={props.view !== 'posted'}>
            {data.posted.length === 0 && <Empty>No replies posted yet.</Empty>}
            {data.posted.length > 0 && (
              <Card flush>
                <CardList>
                  {data.posted.map((reply) => (
                    <li key={reply._id}>
                      <PostedRow reply={reply} place={data.account} readsCounts={data.readsCounts} />
                    </li>
                  ))}
                </CardList>
              </Card>
            )}
          </div>
          <div hidden={props.view !== 'skipped'}>
            {data.skipped.length === 0 && <Empty>Nothing passed on.</Empty>}
            {data.skipped.length > 0 && (
              <Card flush>
                <CardList>
                  {data.skipped.map((reply) => (
                    <li key={reply._id}>
                      <SkippedRow reply={reply} platform={platform} onDone={onDone} />
                    </li>
                  ))}
                </CardList>
              </Card>
            )}
          </div>
          <MockNote when={all.some((reply) => reply.mock)}>
            Mock listener: these threads are generated, not heard on {placeLabel(data.account)}, and a posted reply's numbers are generated,
            not measured.
          </MockNote>
        </div>
        <aside aria-label="Listening" className="space-y-4">
          <BudgetCard data={data} />
          <PasteThread accountId={data.account._id} placeName={placeLabel(data.account)} open={!data.searches} onDone={onDone} />
          <p className="text-xs text-ash">
            Every reply waits for you: post it on {placeLabel(data.account)} yourself, then say so here. Influstep never posts.
          </p>
        </aside>
      </div>
    </>
  )
}

/**
 * Answer a thread the listener cannot hear: its link and the text to answer,
 * which the writer drafts a reply to. Folded where the listener searches,
 * since most threads come from it; open where nothing searches.
 */
function PasteThread(props: { accountId: Id<'accounts'>; placeName: string; open: boolean; onDone: (message: string) => void }) {
  const paste = useAction(api.private.replies.pasteThread)
  const [url, setUrl] = React.useState('')
  const [text, setText] = React.useState('')
  const [state, setState] = React.useState<FormState>({ status: 'idle' })
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (state.status === 'saving') return
    setState({ status: 'saving' })
    try {
      await paste({ accountId: props.accountId, url, text })
      setUrl('')
      setText('')
      setState({ status: 'idle' })
      props.onDone('The writer is drafting a reply to the thread you pasted. It waits for you once written.')
    } catch (caught) {
      setState({ status: 'error', message: errorMessage(caught) })
    }
  }
  return (
    <Card>
      <Collapsible summary="Answer a thread you found" defaultOpen={props.open}>
        <form onSubmit={(event) => void submit(event)} className="space-y-3">
          <Field label="Link to the thread" hint={`A thread on ${props.placeName}.`}>
            <Input value={url} onChange={(event) => setUrl(event.target.value)} required />
          </Field>
          <Field label="What to answer" hint="Paste the post or comment you want to reply to.">
            <Textarea value={text} onChange={(event) => setText(event.target.value)} rows={3} required />
          </Field>
          <Button type="submit" size="sm" variant="primary" busy={state.status === 'saving'}>
            Draft a reply
          </Button>
          <div aria-live="polite">{state.status === 'error' && <ErrorLine>{state.message}</ErrorLine>}</div>
        </form>
      </Collapsible>
    </Card>
  )
}

/**
 * Today's budget of drafts, as a card, and Listen now, which looks for posts
 * at once instead of at the next hourly sweep. With a budget of 0 the card
 * says replies are off; a refusal shows under the button.
 */
function BudgetCard(props: { data: RepliesData }) {
  const listenNow = useMutation(api.private.replies.listenNow)
  const [state, setState] = React.useState<FormState | { status: 'done' }>({ status: 'idle' })
  const data = props.data
  const left = repliesLeft(data.budget, data.draftedToday)
  const listen = async () => {
    if (state.status === 'saving') return
    setState({ status: 'saving' })
    try {
      await listenNow({ accountId: data.account._id })
      setState({ status: 'done' })
    } catch (caught) {
      setState({ status: 'error', message: errorMessage(caught) })
    }
  }
  return (
    <Card
      title="Today"
      actions={
        <Button size="sm" busy={state.status === 'saving'} onClick={() => void listen()}>
          Listen now
        </Button>
      }
    >
      {data.budget === 0 ? (
        <p className="text-sm">Replies are off: the reply budget is 0. Raise it in the account's settings.</p>
      ) : (
        <>
          <p className="text-sm">
            <span className="tabular font-medium">{data.draftedToday}</span> of <span className="tabular">{data.budget}</span>{' '}
            {plural(data.budget, 'reply', 'replies')} drafted
            <span className="text-ash">
              {' · '}
              <span className="tabular">{left}</span> left
            </span>
          </p>
          <Meter value={data.draftedToday} max={data.budget} className="mt-2" />
        </>
      )}
      <div aria-live="polite" className="mt-2 empty:mt-0">
        {state.status === 'done' && <p className="text-xs text-ash">Listening. New drafts show up under Waiting for you.</p>}
        {state.status === 'error' && <ErrorLine>{state.message}</ErrorLine>}
      </div>
    </Card>
  )
}

/** A posted reply: what it said, when the operator posted it, and what it brought back once the analyst read it. */
function PostedRow(props: { reply: Reply; place: PlatformPlace; readsCounts: boolean }) {
  const reply = props.reply
  const url = postedItemOf(reply.posted)?.url
  const at = wentOutAt(reply)
  return (
    <div className="space-y-3">
      <ThreadQuote reply={reply} platform={props.place.platform} />
      <div>
        <p className="text-sm">{reply.text}</p>
        <p className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-ash">
          {url ? (
            <a href={url} target="_blank" rel="noreferrer" className="underline decoration-fog hover:text-ink hover:decoration-ink">
              Posted {relativeTime(at)}
            </a>
          ) : (
            <span>Posted {relativeTime(at)}, no link</span>
          )}
          <ItemNumbers numbers={reply.numbers} missing={notReadText(props.place, props.readsCounts)} />
        </p>
      </div>
    </div>
  )
}

/**
 * A post the account passed on, with why: the writer, a rule, the sponsor
 * filter, the operator or a stale draft. Write a reply asks the writer for
 * one anyway; it waits for the operator once written.
 */
function SkippedRow(props: { reply: Reply; platform: Platform; onDone: (message: string) => void }) {
  const ask = useMutation(api.private.replies.ask)
  const [state, setState] = React.useState<FormState>({ status: 'idle' })
  const reply = props.reply
  const click = async () => {
    if (state.status === 'saving') return
    setState({ status: 'saving' })
    try {
      await ask({ replyId: reply._id })
      setState({ status: 'idle' })
      props.onDone(`The writer is drafting a reply to ${answering(reply.thread, props.platform)}. It waits for you once written.`)
    } catch (caught) {
      setState({ status: 'error', message: errorMessage(caught) })
    }
  }
  return (
    <div className="space-y-3">
      <ThreadQuote reply={reply} platform={props.platform} />
      <div className="flex items-start gap-3">
        <p className="min-w-0 flex-1 text-xs text-ash">{reply.skipReason}</p>
        <Button size="sm" busy={state.status === 'saving'} onClick={() => void click()}>
          Write a reply
        </Button>
      </div>
      {state.status === 'error' && <ErrorLine>{state.message}</ErrorLine>}
    </div>
  )
}
