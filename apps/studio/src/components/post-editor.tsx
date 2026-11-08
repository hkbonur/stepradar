import { api } from '@influstep/convex/_generated/api'
import type { Doc } from '@influstep/convex/_generated/dataModel'
import {
  PLATFORM_DRAFT_SHAPES,
  placeLabel,
  POST_PART_MAX,
  POST_TITLE_MAX,
  SPONSOR_LINKS,
  THREAD_PARTS_MAX,
  THREAD_PARTS_MIN,
  communityLabel,
  letGo,
  parsePostedLink,
  platformLength,
  postProblems,
  textEditable,
  type DraftShape,
  type Platform,
  type PlatformPlace,
  type PostKind,
  type PostStatus,
} from '@influstep/shared'
import { useMutation } from 'convex/react'
import React from 'react'
import { errorMessage } from '@/lib/errors'
import { CharacterCounter } from './character-counter'
import { PostedLinkField } from './posted-link-field'
import { Button, ErrorLine, Field, type FormState, Input, Textarea } from './ui'

/** One part as the editor holds it: the id keeps a textarea's focus and undo with its text when a part above it is removed. */
interface PartDraft {
  id: string
  text: string
}

/** What a post's one part is called in each draft shape (shared `PLATFORM_DRAFT_SHAPES`). */
const PART_LABELS: Record<DraftShape, string> = {
  text: 'Post',
  rewrite: 'Body, to say in your own words',
  points: 'Talking points',
}

/** Why the draft has its shape, under the part. */
const SHAPE_HINTS: Record<DraftShape, string | null> = {
  text: null,
  rewrite: 'Many subreddits and forums remove text that reads machine-written: post it in your own words, then paste what you posted here.',
  points: 'Hacker News removes generated text: write the post yourself from these points, then paste what you posted here.',
}

/** What the operator does with the draft before saying they posted it: post it as it stands, or post their own words and paste them above. */
const POST_IT: Record<DraftShape, (platform: string) => string> = {
  text: (platform) => `Post it on ${platform} yourself, as it stands above, then say so here.`,
  rewrite: (platform) => `Post it on ${platform} yourself, in your own words, paste what you posted above, then say so here.`,
  points: (platform) => `Write the post on ${platform} yourself from the points, paste what you posted above, then say so here.`,
}

/**
 * The draft of a post, as the operator will post it on its platform (shared
 * post-rules.ts): its title, posted on Reddit and Hacker News and a name for
 * the studio elsewhere; a text post as one part, a thread on X as two to
 * six; every part counted the way its platform counts. A draft ends with "I
 * posted it", which records the words as they stand, saved or not (ADR 0004).
 */
export function PostEditor(props: { post: Doc<'posts'>; place: PlatformPlace }) {
  const platform = props.place.platform
  const update = useMutation(api.private.posts.updatePost)
  const kind = props.post.kind
  const [title, setTitle] = React.useState(props.post.title)
  const [parts, setParts] = React.useState<PartDraft[]>(() => initialParts(kind, props.post.parts))
  // No "saved" state: the page keys the editor on the saved post, so a save that goes through remounts it clean.
  const [state, setState] = React.useState<FormState>({ status: 'idle' })

  const locked = !textEditable(props.post.status)
  const texts = parts.map((part) => part.text)
  const written = props.post.parts
  const dirty = title !== props.post.title || written === undefined || JSON.stringify(texts) !== JSON.stringify(written)
  const problems = postProblems({ platform: platform, kind, community: props.post.community ?? null }, { title, parts: texts })
  const shape = PLATFORM_DRAFT_SHAPES[platform]
  const titleMax = POST_TITLE_MAX[platform]

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    setState({ status: 'saving' })
    try {
      await update({ postId: props.post._id, title, parts: texts })
      setState({ status: 'idle' })
    } catch (caught) {
      setState({ status: 'error', message: errorMessage(caught) })
    }
  }
  const setPart = (id: string, text: string) => setParts((current) => current.map((part) => (part.id === id ? { ...part, text } : part)))
  const addPart = (part: PartDraft) => setParts((current) => [...current, part])
  const removePart = (id: string) => setParts((current) => current.filter((part) => part.id !== id))

  return (
    <div className="grid grid-cols-1 gap-4">
      <form onSubmit={save} className="grid grid-cols-1 gap-4">
        {props.post.community !== undefined && <p className="text-xs text-ash">For {communityLabel(platform, props.post.community)}</p>}
        <Field
          label={titleMax === null ? 'Title' : `Title, as ${placeLabel(props.place)} shows it`}
          hint={
            titleMax === null
              ? `For Today and the report; ${placeLabel(props.place)} shows only the post.`
              : `At most ${titleMax} characters.`
          }
        >
          <Input value={title} onChange={(event) => setTitle(event.target.value)} disabled={locked} />
        </Field>
        {kind === 'thread' && (
          <ThreadParts parts={parts} platform={platform} locked={locked} onChange={setPart} onAdd={addPart} onRemove={removePart} />
        )}
        {/* One part; a text post with more is refused by postProblems below, not hidden here. */}
        {kind !== 'thread' &&
          parts.map((part) => (
            <PartField
              key={part.id}
              label={PART_LABELS[shape]}
              platform={platform}
              text={part.text}
              locked={locked}
              onChange={(text) => setPart(part.id, text)}
            />
          ))}
        {SHAPE_HINTS[shape] !== null && <p className="-mt-2 text-xs text-ash">{SHAPE_HINTS[shape]}</p>}
        {props.post.sponsorLink !== undefined && <SponsorLink link={props.post.sponsorLink} platform={platform} />}
        <div>
          {/*
          The live region stays in the page while the list comes and goes, so a screen reader hears each problem as it
          appears and learns why Save is off. Not role="status": that reads the whole list again on every change.
        */}
          <div aria-live="polite">
            {!locked && problems.length > 0 && (
              <ul className="mb-4 space-y-0.5 text-xs text-signal-red-deep">
                {problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex items-center gap-3">
            {!locked && (
              <Button
                type="submit"
                variant={dirty ? 'primary' : 'outline'}
                busy={state.status === 'saving'}
                disabled={!dirty || problems.length > 0}
              >
                Save post
              </Button>
            )}
            <span className="text-xs text-ash">
              {platform === 'x' && 'X counts every link as 23 characters.'}
              {locked && ` ${lockNote(props.post.status)}`}
            </span>
          </div>
        </div>
        {state.status === 'error' && <ErrorLine>{state.message}</ErrorLine>}
      </form>
      {/* Outside the form: Enter in its link field must not save the post instead of marking it posted. */}
      {props.post.status === 'draft' && (
        <MarkPosted postId={props.post._id} place={props.place} title={title} parts={texts} problems={problems} />
      )}
    </div>
  )
}

/** What the operator does with a sponsored post's link (shared SPONSOR_LINKS): submit the post with it, or keep it in the text. */
function linkHint(platform: Platform): string {
  const rule = SPONSOR_LINKS[platform]
  const ties = rule.kind === 'tracked' ? 'it counts the click and ties a signup to this post' : 'it ties a signup to this post'
  if (rule.placement === 'submission') return `Submit the post with this link: ${ties}.`
  if (PLATFORM_DRAFT_SHAPES[platform] === 'rewrite') return `Keep this link as it is in what you post: ${ties}.`
  return `Keep this link in the post as it is: ${ties}.`
}

/** The link to the sponsor a sponsored post carries (CONTEXT.md, "Tracked link"), to copy as it is. */
function SponsorLink(props: { link: string; platform: Platform }) {
  const [copied, setCopied] = React.useState(false)
  const copy = async () => {
    await navigator.clipboard.writeText(props.link)
    setCopied(true)
  }
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate rounded-lg border border-mist bg-paper px-2.5 py-1 font-mono text-[11px]">
          {props.link}
        </span>
        <Button size="sm" variant="outline" onClick={() => void copy()}>
          {copied ? 'Copied' : 'Copy link'}
        </Button>
      </div>
      <p className="text-xs text-ash">{linkHint(props.platform)}</p>
    </div>
  )
}

/**
 * The operator posted the draft by hand and says so, in the words the
 * editor holds now, with the post's link when they have it: the link is how
 * the analyst finds its numbers.
 */
function MarkPosted(props: { postId: Doc<'posts'>['_id']; place: PlatformPlace; title: string; parts: string[]; problems: string[] }) {
  const markPosted = useMutation(api.private.posts.markPosted)
  const [url, setUrl] = React.useState('')
  const [state, setState] = React.useState<FormState>({ status: 'idle' })
  const linkInvalid = parsePostedLink(props.place, url).kind === 'invalid'
  const markAsPosted = async () => {
    if (state.status === 'saving') return
    setState({ status: 'saving' })
    try {
      await markPosted({ postId: props.postId, title: props.title, parts: props.parts, url })
      setState({ status: 'idle' })
    } catch (caught) {
      setState({ status: 'error', message: errorMessage(caught) })
    }
  }
  return (
    <section className="tint-alert-amber rounded-xl border border-[color-mix(in_oklch,var(--tint)_35%,transparent)] bg-[color-mix(in_srgb,var(--tint)_7%,var(--color-paper))] px-4 py-3">
      <h3 className="mb-1 text-sm font-medium text-alert-amber-deep">Waiting on you</h3>
      <p className="mb-3 text-sm">{POST_IT[PLATFORM_DRAFT_SHAPES[props.place.platform]](placeLabel(props.place))} Influstep never posts.</p>
      <PostedLinkField
        place={props.place}
        label="Link to the post"
        showLabel
        hint="Optional. With it the analyst reads the post's numbers."
        value={url}
        onChange={setUrl}
        placeholder="Link to your post"
      />
      <Button
        variant="primary"
        busy={state.status === 'saving'}
        disabled={props.problems.length > 0 || linkInvalid}
        onClick={() => void markAsPosted()}
        className="mt-2"
      >
        I posted it
      </Button>
      {state.status === 'error' && <ErrorLine>{state.message}</ErrorLine>}
    </section>
  )
}

/**
 * Two to six numbered parts of a thread on X, each held to X's full limit. Adding or removing
 * a part moves keyboard focus to a part's textarea: the removed button leaves
 * the page and the Add button disables itself at six, and either would drop
 * focus to the top of the page.
 */
function ThreadParts(props: {
  parts: PartDraft[]
  platform: Platform
  locked: boolean
  onChange: (id: string, text: string) => void
  onAdd: (part: PartDraft) => void
  onRemove: (id: string) => void
}) {
  const textareas = React.useRef(new Map<string, HTMLTextAreaElement>())
  // The part just added, focused when its textarea mounts.
  const focusOnMount = React.useRef<string | null>(null)

  const registerTextarea = (id: string) => (element: HTMLTextAreaElement | null) => {
    if (!element) return
    textareas.current.set(id, element)
    if (focusOnMount.current === id) {
      focusOnMount.current = null
      element.focus()
    }
    return () => {
      textareas.current.delete(id)
    }
  }
  const add = () => {
    const part = newPart('')
    focusOnMount.current = part.id
    props.onAdd(part)
  }
  const remove = (id: string) => {
    const index = props.parts.findIndex((part) => part.id === id)
    // The part before takes focus, or, when the first part goes, the one that becomes first.
    const neighbour = index > 0 ? props.parts[index - 1] : props.parts[index + 1]
    props.onRemove(id)
    // Remove is disabled at the fewest parts a thread allows, so a neighbour always exists; without one focus stays put.
    if (!neighbour) return
    const textarea = textareas.current.get(neighbour.id)
    // Every part's textarea registers on mount, so a missing one is a part that is not on the page; nothing to focus.
    if (!textarea) return
    textarea.focus()
  }

  return (
    <div className="grid gap-3">
      <ol className="grid gap-3">
        {props.parts.map((part, index) => (
          <li key={part.id}>
            <PartField
              label={`Part ${index + 1}`}
              platform={props.platform}
              text={part.text}
              locked={props.locked}
              onChange={(text) => props.onChange(part.id, text)}
              registerTextarea={registerTextarea(part.id)}
              action={
                !props.locked && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={props.parts.length <= THREAD_PARTS_MIN}
                    onClick={() => remove(part.id)}
                    aria-label={`Remove part ${index + 1}`}
                  >
                    Remove
                  </Button>
                )
              }
            />
          </li>
        ))}
      </ol>
      {!props.locked && (
        <div>
          <Button size="sm" disabled={props.parts.length >= THREAD_PARTS_MAX} onClick={add}>
            Add part
          </Button>
        </div>
      )}
    </div>
  )
}

/** A part's textarea with its live counter, counted as its platform counts; the label row also holds the thread's remove button. */
function PartField(props: {
  label: string
  platform: Platform
  text: string
  locked: boolean
  onChange: (text: string) => void
  action?: React.ReactNode
  /** The thread keeps each part's textarea, so adding or removing a part can move focus. */
  registerTextarea?: React.RefCallback<HTMLTextAreaElement>
}) {
  const id = React.useId()
  const counterId = `${id}-counter`
  return (
    <div className="grid gap-1.5">
      <div className="flex min-h-7 items-center justify-between gap-3">
        <label htmlFor={id} className="text-xs font-medium text-graphite">
          {props.label}
        </label>
        <span className="flex items-center gap-2">
          <CharacterCounter id={counterId} length={platformLength(props.text, props.platform)} limit={POST_PART_MAX[props.platform]} />
          {props.action}
        </span>
      </div>
      <Textarea
        id={id}
        // Wrapped, not passed straight through: the compiler takes a prop handed to `ref` as a ref and skips the component.
        ref={(element) => props.registerTextarea?.(element)}
        aria-describedby={counterId}
        value={props.text}
        onChange={(event) => props.onChange(event.target.value)}
        disabled={props.locked}
        className="min-h-24"
      />
    </div>
  )
}

/** Why the editor is read only: a killed or skipped post was let go; every other lock comes once the operator posted it. */
function lockNote(status: PostStatus): string {
  if (letGo(status)) return 'This post was let go, so it is locked.'
  return 'Locked once you posted it.'
}

function newPart(text: string): PartDraft {
  return { id: crypto.randomUUID(), text }
}

/**
 * The parts the editor opens with: the written post, or, before the writer
 * has run, the fewest empty parts the kind allows, so the operator can write
 * it by hand.
 */
function initialParts(kind: PostKind, written: string[] | undefined): PartDraft[] {
  if (written) return written.map(newPart)
  const count = kind === 'thread' ? THREAD_PARTS_MIN : 1
  return Array.from({ length: count }, () => newPart(''))
}
