import { api } from '@influstep/convex/_generated/api'
import type { Doc, Id } from '@influstep/convex/_generated/dataModel'
import {
  ACCOUNT_POST_SOURCES,
  ACCOUNT_POST_SOURCE_LABELS,
  IMPORT_BATCH_MAX,
  parsePastedPosts,
  parseXArchive,
  type ImportedPost,
  ARCHIVE_PLATFORM,
  needsConnection,
  placeLabel,
  type PlatformPlace,
} from '@influstep/shared'
import { useMutation } from 'convex/react'
import type { FunctionReturnType } from 'convex/server'
import React from 'react'
import { errorMessage } from '@/lib/errors'
import { plural } from '@/lib/format'
import { chunk } from '@/lib/imports'
import { JobState } from './status'
import { Button, Card, Collapsible, ErrorLine, type FormState, MockNote, Textarea } from './ui'

type HistoryTotals = FunctionReturnType<typeof api.private.history.history>['totals']

/** One import from the browser: reading the file, sending it chunk by chunk, then what came of it. */
type ImportProgress =
  | { status: 'idle' }
  | { status: 'reading' }
  | { status: 'sending'; sent: number; total: number }
  | { status: 'done'; added: number; skipped: number }
  | { status: 'error'; message: string; sent: number }

/**
 * The account's history on the voice page (DESIGN.md, Voice page): how many
 * posts Influstep holds and from where, and the three ways to bring more. An
 * import only reads; nothing is posted, liked or followed.
 *
 * Delete history removes the very line its button sits in, so focus moves to
 * the status line under the totals, which stays mounted and says what became
 * of the history: being deleted while the pages go, then deleted.
 */
export function HistorySection(props: {
  accountId: Id<'accounts'>
  totals: HistoryTotals
  /** Whether Clear history is still deleting the posts, a page at a time. */
  clearing: boolean
  /** The newest import_history job, or null when the account's posts were never imported through its reader. */
  importJob: Doc<'jobs'> | null
  place: PlatformPlace
  /** Whether the account's platform reader reads its own posts; the card is left out where it cannot. */
  readsActivity: boolean
  mock: boolean
}) {
  const statusRef = React.useRef<HTMLParagraphElement>(null)
  const [cleared, setCleared] = React.useState(false)
  // Bumped by each Delete history, so the upload and paste cards forget what they added to the history that is gone.
  const [clears, setClears] = React.useState(0)
  const onCleared = () => {
    setCleared(true)
    setClears((count) => count + 1)
    statusRef.current?.focus()
  }
  return (
    <Card title="History" description="The account's own posts, which the voice is learned from.">
      <HistoryTotalsLine accountId={props.accountId} totals={props.totals} clearing={props.clearing} onCleared={onCleared} />
      <p ref={statusRef} tabIndex={-1} aria-live="polite" className="mt-1 text-xs">
        <ClearStatus clearing={props.clearing} cleared={cleared && props.totals.count === 0} />
      </p>
      {/* Open while there is nothing to learn from; once there is a history, adding to it is the rare step. */}
      <Collapsible summary="Import more posts" defaultOpen={props.totals.count === 0} className="mt-3 border-t border-mist pt-2">
        <p className="max-w-[65ch] text-xs text-ash">Importing only reads: Influstep never posts, likes or follows while it imports.</p>
        <div className="mt-3 grid gap-3">
          {props.place.platform === ARCHIVE_PLATFORM && (
            <>
              <ArchiveUpload key={`archive-${clears}`} accountId={props.accountId} />
              <PastePosts key={`paste-${clears}`} accountId={props.accountId} />
            </>
          )}
          {props.readsActivity && (
            <ImportFromReader accountId={props.accountId} place={props.place} job={props.importJob} mock={props.mock} />
          )}
          {!props.readsActivity && props.place.platform !== ARCHIVE_PLATFORM && (
            <p className="text-xs text-ash">
              Influstep cannot read this account's posts on {placeLabel(props.place)} yet.
              {needsConnection(props.place.platform) && ' Connect the account above to import them.'}
            </p>
          )}
        </div>
      </Collapsible>
    </Card>
  )
}

/**
 * What Clear history has done. While the pages go it says the history is being
 * deleted, without a count, so the live region speaks once and not once a page;
 * the totals above count down. Said as deleted only while the history is still
 * empty: an import after it makes the line moot.
 */
function ClearStatus(props: { clearing: boolean; cleared: boolean }) {
  if (props.clearing) return <span className="text-ash">Deleting the history; import or learn the voice again once it is gone…</span>
  if (props.cleared) return <span>History deleted.</span>
  return null
}

function HistoryTotalsLine(props: { accountId: Id<'accounts'>; totals: HistoryTotals; clearing: boolean; onCleared: () => void }) {
  const totals = props.totals
  if (totals.count === 0) return <p className="text-ash">No posts imported yet.</p>
  const sources = ACCOUNT_POST_SOURCES.filter((source) => totals.bySource[source] > 0)
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
      <div className="space-y-0.5">
        <p>
          <span className="tabular">{totals.count.toLocaleString()}</span> {plural(totals.count, 'post', 'posts')}:{' '}
          <span className="tabular">{totals.originals.toLocaleString()}</span> of the account's own,{' '}
          <span className="tabular">{totals.replies.toLocaleString()}</span> {plural(totals.replies, 'reply', 'replies')} to others.
        </p>
        <p className="text-xs text-ash">
          {sources.map((source, index) => (
            <React.Fragment key={source}>
              {index > 0 && ' · '}
              {ACCOUNT_POST_SOURCE_LABELS[source]}{' '}
              <span className="tabular font-mono text-[11px]">{totals.bySource[source].toLocaleString()}</span>
            </React.Fragment>
          ))}
        </p>
        <MockNote when={totals.bySource.mock > 0}>Mock posts are generated for the niche, not read from the account.</MockNote>
      </div>
      {/* Gone while the pages are deleted: there is nothing to confirm twice, and the status line says how it goes. */}
      {!props.clearing && <ClearHistory accountId={props.accountId} count={totals.count} onCleared={props.onCleared} />}
    </div>
  )
}

/**
 * Clear history behind an inline confirm step, not a modal: the button opens
 * the question under it and focus moves to Cancel, the safe answer. Cancel
 * hands focus back to the button; Delete history hands it to the section's
 * status line (`onCleared`), since this whole line goes once the deleting starts.
 */
function ClearHistory(props: { accountId: Id<'accounts'>; count: number; onCleared: () => void }) {
  const clearHistory = useMutation(api.private.history.clearHistory)
  const [confirming, setConfirming] = React.useState(false)
  const [state, setState] = React.useState<FormState>({ status: 'idle' })
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const confirmId = React.useId()
  const cancel = () => {
    setConfirming(false)
    setState({ status: 'idle' })
    triggerRef.current?.focus()
  }
  const clear = async () => {
    setState({ status: 'saving' })
    try {
      await clearHistory({ accountId: props.accountId })
      // The history is empty now, or being deleted page by page, so this line goes and focus with it.
      setConfirming(false)
      setState({ status: 'idle' })
      props.onCleared()
    } catch (caught) {
      setState({ status: 'error', message: errorMessage(caught) })
    }
  }
  return (
    <div className="flex flex-col items-end gap-2">
      <Button
        ref={triggerRef}
        size="sm"
        variant="destructive"
        aria-expanded={confirming}
        aria-controls={confirming ? confirmId : undefined}
        onClick={() => setConfirming((open) => !open)}
      >
        Clear history
      </Button>
      {confirming && (
        <div id={confirmId} className="flex max-w-[22rem] flex-col items-end gap-2 text-right">
          <p className="text-xs">
            Delete the <span className="tabular">{props.count.toLocaleString()}</span> imported {plural(props.count, 'post', 'posts')} and
            the learned voice? The posts stay on X; only Influstep forgets them.
          </p>
          <div className="flex gap-2">
            {/* Focus lands on the safe answer, so an Enter pressed out of habit deletes nothing. */}
            <Button size="sm" variant="ghost" autoFocus onClick={cancel}>
              Cancel
            </Button>
            <Button size="sm" variant="destructive" busy={state.status === 'saving'} onClick={clear}>
              Delete history
            </Button>
          </div>
          {state.status === 'error' && <ErrorLine>{state.message}</ErrorLine>}
        </div>
      )}
    </div>
  )
}

/**
 * The import both the archive and the paste go through: read the posts in the
 * browser, then send them in chunks the backend accepts. Chunks go one after
 * another, not all at once, so the progress line counts up truthfully and a
 * failure stops at a known point; the backend skips posts it already holds, so
 * importing the same file again picks up where it stopped. Resolves true when
 * every chunk went through.
 */
function usePostImport(accountId: Id<'accounts'>, source: 'archive' | 'paste') {
  const importPosts = useMutation(api.private.history.importPosts)
  const [progress, setProgress] = React.useState<ImportProgress>({ status: 'idle' })
  const run = async (read: () => ImportedPost[] | Promise<ImportedPost[]>): Promise<boolean> => {
    let sent = 0
    setProgress({ status: 'reading' })
    try {
      const posts = await read()
      if (posts.length === 0) {
        setProgress({ status: 'error', message: 'There are no posts in it to import.', sent })
        return false
      }
      let added = 0
      let skipped = 0
      for (const batch of chunk(posts, IMPORT_BATCH_MAX)) {
        setProgress({ status: 'sending', sent, total: posts.length })
        const result = await importPosts({ accountId, source, posts: batch })
        added += result.added
        skipped += result.skipped
        sent += batch.length
      }
      setProgress({ status: 'done', added, skipped })
      return true
    } catch (caught) {
      setProgress({ status: 'error', message: errorMessage(caught), sent })
      return false
    }
  }
  return [progress, run] as const
}

function ArchiveUpload(props: { accountId: Id<'accounts'> }) {
  const [progress, run] = usePostImport(props.accountId, 'archive')
  const inputId = React.useId()
  const hintId = React.useId()
  const busy = progress.status === 'reading' || progress.status === 'sending'
  const upload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget
    const file = input.files?.[0]
    if (file === undefined) return
    // Cleared so choosing the same file again, to finish an import that stopped, still counts as a change.
    input.value = ''
    await run(async () => parseXArchive(await file.text()))
  }
  return (
    <div className="flex flex-col gap-3 rounded-lg bg-paper-tint p-4">
      <div>
        <h3 className="text-sm font-medium">
          <label htmlFor={inputId}>Upload archive</label>
        </h3>
        <p id={hintId} className="mt-1 text-xs text-ash">
          The <span className="font-mono text-[11px]">tweets.js</span> file from X's Download your data, in the archive's data folder. It is
          read in this browser; only the posts are sent.
        </p>
      </div>
      <input
        id={inputId}
        type="file"
        accept=".js,.json"
        aria-describedby={hintId}
        disabled={busy}
        onChange={upload}
        className="w-full text-xs text-ash file:mr-3 file:h-7 file:cursor-pointer file:rounded-lg file:border file:border-mist file:bg-paper file:px-2.5 file:text-xs file:font-medium file:text-ink hover:file:bg-paper-tint disabled:opacity-50"
      />
      <ImportProgressLine progress={progress} />
    </div>
  )
}

function PastePosts(props: { accountId: Id<'accounts'> }) {
  const [text, setText] = React.useState('')
  const [progress, run] = usePostImport(props.accountId, 'paste')
  const textareaId = React.useId()
  const ruleId = React.useId()
  const busy = progress.status === 'reading' || progress.status === 'sending'
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const imported = await run(() => parsePastedPosts(text))
    if (imported) setText('')
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-lg bg-paper-tint p-4">
      <div>
        <h3 className="text-sm font-medium">
          <label htmlFor={textareaId}>Paste posts</label>
        </h3>
        <p id={ruleId} className="mt-1 text-xs text-ash">
          One post after another, with a line that holds only <span className="font-mono text-[11px] whitespace-nowrap">---</span> between
          two posts.
        </p>
      </div>
      <Textarea
        id={textareaId}
        aria-describedby={ruleId}
        value={text}
        onChange={(event) => setText(event.target.value)}
        disabled={busy}
        className="min-h-28"
      />
      <div>
        <Button type="submit" size="sm" busy={busy} disabled={text.trim().length === 0}>
          Import posts
        </Button>
      </div>
      <ImportProgressLine progress={progress} />
    </form>
  )
}

/**
 * The account's own posts, read through its platform's reader by a
 * researcher job. In mock mode the job makes up plausible posts for the
 * niche, and the card says so before the operator clicks; a reader that
 * cannot read them refuses by name.
 */
function ImportFromReader(props: { accountId: Id<'accounts'>; place: PlatformPlace; job: Doc<'jobs'> | null; mock: boolean }) {
  const importHistory = useMutation(api.private.history.importHistory)
  const [state, setState] = React.useState<FormState>({ status: 'idle' })
  const jobBusy = props.job?.status === 'queued' || props.job?.status === 'running'
  const label = `Import from ${placeLabel(props.place)}`
  const start = async () => {
    setState({ status: 'saving' })
    try {
      await importHistory({ accountId: props.accountId })
      setState({ status: 'idle' })
    } catch (caught) {
      setState({ status: 'error', message: errorMessage(caught) })
    }
  }
  return (
    <div className="flex flex-col gap-3 rounded-lg bg-paper-tint p-4">
      <div>
        <h3 className="text-sm font-medium">{label}</h3>
        <p className="mt-1 text-xs text-ash">Reads the account's own posts through its platform's reader.</p>
        <MockNote when={props.mock}>Mock providers: this makes up plausible posts for the niche; it does not read the account.</MockNote>
      </div>
      <div>
        <Button size="sm" busy={state.status === 'saving' || jobBusy} onClick={start}>
          {label}
        </Button>
      </div>
      {/* Mounted before the first job exists, so the job appearing is announced, and every status after it. */}
      <div aria-live="polite">{props.job && <JobState job={props.job} />}</div>
      {state.status === 'error' && <ErrorLine>{state.message}</ErrorLine>}
    </div>
  )
}

/**
 * The import progress line (DESIGN.md): one line under the import that counts
 * the posts sent, then says what was added and what was already there. It is
 * a polite live region that stays mounted, empty while idle, so each step is
 * announced.
 */
function ImportProgressLine(props: { progress: ImportProgress }) {
  return (
    <div aria-live="polite" className="text-xs">
      <ProgressText progress={props.progress} />
    </div>
  )
}

function ProgressText(props: { progress: ImportProgress }) {
  const progress = props.progress
  if (progress.status === 'idle') return null
  if (progress.status === 'reading') return <p className="text-ash">Reading the posts…</p>
  if (progress.status === 'sending') {
    return (
      <p className="text-ash">
        Sent <span className="tabular font-mono text-[11px] text-ink">{progress.sent.toLocaleString()}</span> of{' '}
        <span className="tabular font-mono text-[11px]">{progress.total.toLocaleString()}</span> {plural(progress.total, 'post', 'posts')}…
      </p>
    )
  }
  if (progress.status === 'done') {
    return (
      <p>
        Added <span className="tabular font-mono text-[11px]">{progress.added.toLocaleString()}</span>{' '}
        {plural(progress.added, 'post', 'posts')}
        {progress.skipped > 0 && (
          <span className="text-ash">
            ; <span className="tabular font-mono text-[11px]">{progress.skipped.toLocaleString()}</span>{' '}
            {plural(progress.skipped, 'was', 'were')} already here
          </span>
        )}
        .
      </p>
    )
  }
  return (
    <div className="space-y-1">
      <ErrorLine>{progress.message}</ErrorLine>
      {progress.sent > 0 && (
        <p className="text-ash">
          The first <span className="tabular font-mono text-[11px]">{progress.sent.toLocaleString()}</span>{' '}
          {plural(progress.sent, 'post is', 'posts are')} in. Importing again skips them and sends the rest.
        </p>
      )}
    </div>
  )
}
