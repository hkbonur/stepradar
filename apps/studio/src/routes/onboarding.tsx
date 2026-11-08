import { api } from '@influstep/convex/_generated/api'
import type { FunctionReturnType } from 'convex/server'
import type { Id } from '@influstep/convex/_generated/dataModel'
import {
  DEFAULT_FORMATS,
  ONBOARDING_ACCOUNTS_MAX,
  PILLARS_MAX,
  PILLARS_MIN,
  PLATFORMS,
  PLATFORM_HANDLES,
  SPONSOR_RAMP_POSTS,
  parsePillars,
  namedAccountProblems,
  proposalProblems,
  type AccountIdentity,
  bareHandle,
  placeLabel,
  type AccountProposal,
  type Forum,
  type PlatformFormat,
  type PlatformPlace,
  postPlacingOf,
  type PostPlacing,
  handleOf,
  MET_COMMUNITY_NOUNS,
  PLATFORM_IN_WORDS,
  PLATFORM_KIND_LABELS,
} from '@influstep/shared'
import { Navigate, createFileRoute } from '@tanstack/react-router'
import { useAction, useMutation, useQuery } from 'convex/react'
import React from 'react'
import { z } from 'zod'
import { FormatFields } from '@/components/format-fields'
import { AccountMark } from '@/components/account-mark'
import { SetupSteps } from '@/components/setup-steps'
import { Button, ErrorLine, Field, Input, LinkButton, PageHeader, Skeleton, Textarea } from '@/components/ui'
import { errorMessage } from '@/lib/errors'
import { platformsInWords } from '@/lib/platforms'

// `count` skips the first question: the sidebar's + adds one account through the same flow. `first` is the first run's
// last setup step: the root keeps the setup's layout, without the sidebar, until the roster is built.
const searchSchema = z.object({
  count: z.number().int().min(1).max(ONBOARDING_ACCOUNTS_MAX).optional().catch(undefined),
  first: z.boolean().optional().catch(undefined),
})

export const Route = createFileRoute('/onboarding')({ component: OnboardingPage, validateSearch: searchSchema })

/** Where the flow stands: how many to build, one account at a time, then the roster it built. */
type Step = { kind: 'count' } | { kind: 'account'; index: number; total: number } | { kind: 'done'; created: Id<'accounts'>[] }

/** The parts of one account's step, in order. */
type Part = 'who' | 'profile' | 'posting'

const PARTS: Part[] = ['who', 'profile', 'posting']

const PART_LABELS: Record<Part, string> = {
  who: 'Which account',
  profile: 'How it sounds',
  posting: 'How often it posts',
}

/** The accounts the workspace already has, as the setup's query names them. */
type Roster = NonNullable<FunctionReturnType<typeof api.private.onboarding.start>>['roster']

function OnboardingPage() {
  const search = Route.useSearch()
  const start = useQuery(api.private.onboarding.start, {})
  const [step, setStep] = React.useState<Step>(() =>
    search.count === undefined ? { kind: 'count' } : { kind: 'account', index: 0, total: search.count }
  )
  const [created, setCreated] = React.useState<Id<'accounts'>[]>([])
  if (start === undefined) return <Skeleton className="h-96" />
  // No product yet: the setup comes first, and leads back here.
  if (start === null) return <Navigate to="/setup" replace />
  const firstRun = start.roster.length === 0 && created.length === 0
  // The setup's steps above every step of the first run, the roster's Done included.
  const steps = search.first === true && <SetupSteps current="accounts" />

  if (step.kind === 'count') {
    return (
      <CountStep
        steps={steps}
        firstRun={firstRun}
        sponsorName={start.sponsorName}
        onCount={(total) => setStep({ kind: 'account', index: 0, total })}
      />
    )
  }
  if (step.kind === 'done') return <DoneStep created={step.created} roster={start.roster} />
  return (
    <AccountStep
      steps={steps}
      // A new account starts from an empty draft.
      key={step.index}
      index={step.index}
      total={step.total}
      sponsorName={start.sponsorName}
      roster={start.roster}
      onCreated={(accountId) => {
        const next = [...created, accountId]
        setCreated(next)
        setStep(
          step.index + 1 < step.total ? { kind: 'account', index: step.index + 1, total: step.total } : { kind: 'done', created: next }
        )
      }}
    />
  )
}

/** The heading of a step takes focus when the step appears, so a keyboard or screen reader user starts at its top. */
function StepHeading(props: { children: React.ReactNode }) {
  const ref = React.useRef<HTMLHeadingElement>(null)
  React.useEffect(() => ref.current?.focus(), [])
  return (
    <h2 ref={ref} tabIndex={-1} className="text-title outline-none">
      {props.children}
    </h2>
  )
}

function CountStep(props: { steps: React.ReactNode; firstRun: boolean; sponsorName: string; onCount: (total: number) => void }) {
  const [count, setCount] = React.useState(1)
  return (
    <div className="max-w-2xl">
      {props.steps && <div className="mb-8">{props.steps}</div>}
      <PageHeader
        title={props.firstRun ? 'Build your roster' : 'Add accounts'}
        lead={`Each account is one of your own, on ${platformsInWords('disjunction')}, with its own niche and voice. Its agents read what moves in the niche, draft posts and replies for you to post, and read what they bring ${props.sponsorName}.`}
      />
      <form
        className="card space-y-4"
        onSubmit={(event) => {
          event.preventDefault()
          props.onCount(count)
        }}
      >
        <StepHeading>How many accounts do you want to start with?</StepHeading>
        <p className="text-ash">You set each one up in turn, and can add more one at a time later.</p>
        <fieldset className="flex flex-wrap gap-2">
          <legend className="sr-only">Accounts</legend>
          {Array.from({ length: ONBOARDING_ACCOUNTS_MAX }, (_, offset) => offset + 1).map((value) => (
            <label
              key={value}
              className="flex h-9 min-w-12 cursor-pointer items-center justify-center rounded-lg border border-mist px-3 tabular has-[:checked]:border-ink has-[:checked]:bg-paper-warm has-[:focus-visible]:outline-2"
            >
              <input
                type="radio"
                name="count"
                value={value}
                checked={count === value}
                onChange={() => setCount(value)}
                className="sr-only"
              />
              {value}
            </label>
          ))}
        </fieldset>
        <Button type="submit" variant="primary">
          Continue
        </Button>
      </form>
    </div>
  )
}

/** An account as the operator builds it: the niche and audience, then the proposal they edit, then how often it posts. */
interface Draft {
  niche: string
  audience: string
  name: string
  handle: string
  tone: string
  pillars: string
  bio: string
  bible: string
  affiliationLine: string
  format: PlatformFormat
  sponsorDial: number
  /** On a forum, its address as the operator typed it, and the forum the setup found there when it last proposed. */
  forumAddress: string
  forum: Forum | null
}

function AccountStep(props: {
  steps: React.ReactNode
  index: number
  total: number
  sponsorName: string
  roster: Roster
  onCreated: (accountId: Id<'accounts'>) => void
}) {
  const propose = useAction(api.private.onboarding.propose)
  const checkForum = useAction(api.private.onboarding.checkForum)
  const create = useMutation(api.private.onboarding.create)
  const [part, setPart] = React.useState<Part>('who')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [draft, setDraft] = React.useState<Draft>(() => ({
    niche: '',
    audience: '',
    name: '',
    handle: '',
    tone: '',
    pillars: '',
    bio: '',
    bible: '',
    affiliationLine: '',
    format: DEFAULT_FORMATS.x,
    sponsorDial: 0.3,
    forumAddress: '',
    forum: null,
  }))
  const patch = (change: Partial<Draft>) => setDraft((current) => ({ ...current, ...change }))
  const platform = draft.format.platform
  // A forum account takes part on the forum the setup found when it last proposed; until then it has no place.
  const place: PlatformPlace | null = platform !== 'forum' ? { platform } : draft.forum === null ? null : { platform, forum: draft.forum }
  const identityAt = (at: PlatformPlace): AccountIdentity => ({
    ...at,
    handle: bareHandle(draft.handle, platform),
    name: draft.name.trim(),
    niche: draft.niche,
    audience: draft.audience,
  })
  const proposal = (): AccountProposal => ({
    tone: draft.tone,
    pillars: parsePillars(draft.pillars),
    bio: draft.bio,
    bible: draft.bible,
    affiliationLine: draft.affiliationLine,
  })
  const problems = proposalProblems(proposal(), props.sponsorName)
  const askForProposal = async () => {
    setBusy(true)
    setError(null)
    // Not try/finally: React Compiler skips a component that uses it.
    try {
      // A forum is found again at its address on every proposal, so a changed address is the forum the account is made on.
      const at: PlatformPlace = platform === 'forum' ? { platform, forum: await checkForum({ address: draft.forumAddress }) } : { platform }
      const named = namedAccountProblems(identityAt(at), props.roster)
      if (named.length > 0) {
        setError(named.join(' '))
        setBusy(false)
        return
      }
      const proposed = await propose(identityAt(at))
      patch({ ...proposed, pillars: proposed.pillars.join(', '), forum: at.platform === 'forum' ? at.forum : null })
      setBusy(false)
      setPart('profile')
    } catch (caught) {
      setError(errorMessage(caught))
      setBusy(false)
    }
  }

  const createAccount = async () => {
    if (place === null) return
    setBusy(true)
    setError(null)
    try {
      const accountId = await create({
        ...identityAt(place),
        ...proposal(),
        ...draft.format,
        sponsorDial: draft.sponsorDial,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      })
      props.onCreated(accountId)
    } catch (caught) {
      setError(errorMessage(caught))
      setBusy(false)
    }
  }

  return (
    <div className="max-w-3xl">
      {props.steps && <div className="mb-8">{props.steps}</div>}
      <PageHeader
        title={props.total === 1 ? 'New account' : `Account ${props.index + 1} of ${props.total}`}
        lead={
          <ol className="flex flex-wrap gap-x-4 gap-y-1">
            {PARTS.map((candidate, position) => (
              <li
                key={candidate}
                aria-current={candidate === part ? 'step' : undefined}
                className={candidate === part ? 'text-ink' : undefined}
              >
                <span className="tabular">{position + 1}.</span> {PART_LABELS[candidate]}
              </li>
            ))}
          </ol>
        }
      />

      {part === 'who' && (
        <form
          className="card space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            void askForProposal()
          }}
        >
          <StepHeading>Which of your accounts is it, and who is it for?</StepHeading>
          <p className="text-ash">
            The writer proposes a tone, pillars, a bio, a bible and an affiliation line from these. You edit all of it next.
          </p>
          <fieldset className="space-y-2">
            <legend className="mb-1.5 text-xs font-medium text-graphite">Platform</legend>
            <div className="flex flex-wrap gap-2">
              {PLATFORMS.map((candidate) => (
                <label
                  key={candidate}
                  className="flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-mist pr-3 pl-1.5 has-[:checked]:border-ink has-[:checked]:bg-paper-warm has-[:focus-visible]:outline-2"
                >
                  <input
                    type="radio"
                    name="platform"
                    value={candidate}
                    checked={candidate === platform}
                    onChange={() => patch({ format: DEFAULT_FORMATS[candidate] })}
                    className="sr-only"
                  />
                  <AccountMark platform={candidate} size={24} state="idle" />
                  {PLATFORM_KIND_LABELS[candidate]}
                </label>
              ))}
            </div>
          </fieldset>
          {platform === 'forum' && (
            <Field label="Forum address" hint="Any page of the forum will do, such as community.n8n.io.">
              <Input value={draft.forumAddress} onChange={(event) => patch({ forumAddress: event.target.value })} required />
            </Field>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Handle"
              hint={`${PLATFORM_HANDLES[platform].hint} Links in its drafts carry it as utm_source, so the reports know which account brought a visit.`}
            >
              <Input value={draft.handle} onChange={(event) => patch({ handle: event.target.value })} required />
            </Field>
            <Field label="Name" hint="How the account is named in Influstep.">
              <Input value={draft.name} onChange={(event) => patch({ name: event.target.value })} required />
            </Field>
          </div>
          <Field label="Niche" hint="What the account posts about.">
            <Input
              value={draft.niche}
              onChange={(event) => patch({ niche: event.target.value })}
              placeholder="Notion setups for freelancers"
              required
            />
          </Field>
          <Field label="Audience" hint="Who reads it, in a few words.">
            <Input
              value={draft.audience}
              onChange={(event) => patch({ audience: event.target.value })}
              placeholder="freelance designers who juggle five clients"
              required
            />
          </Field>
          <StepError message={error} />
          <Button type="submit" variant="primary" busy={busy}>
            Propose the rest
          </Button>
        </form>
      )}

      {part === 'profile' && (
        <form
          className="card space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (problems.length === 0) setPart('posting')
          }}
        >
          <StepHeading>How {draft.name.trim()} sounds</StepHeading>
          <p className="text-ash">
            The writer's proposal for {draft.audience.trim()}. Change anything; every post and reply reads the tone, the pillars and the
            bible.
          </p>
          {place?.platform === 'forum' && <ForumRead forum={place.forum} />}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Tone">
              <Input value={draft.tone} onChange={(event) => patch({ tone: event.target.value })} />
            </Field>
            <Field label="Content pillars" hint={`The ${PILLARS_MIN} to ${PILLARS_MAX} topics it posts about, comma separated.`}>
              <Input value={draft.pillars} onChange={(event) => patch({ pillars: event.target.value })} />
            </Field>
            <Field label="Bio" hint="One sentence for its profile, which you put there yourself." className="sm:col-span-2">
              <Input value={draft.bio} onChange={(event) => patch({ bio: event.target.value })} />
            </Field>
            <Field label="Account bible" hint="How it speaks, what it shows, what it never says." className="sm:col-span-2">
              <Textarea value={draft.bible} onChange={(event) => patch({ bible: event.target.value })} rows={4} />
            </Field>
            <Field
              label="Affiliation line"
              hint={`How the account says that you build ${props.sponsorName}, said as written in every draft that names it.`}
              className="sm:col-span-2"
            >
              <Input value={draft.affiliationLine} onChange={(event) => patch({ affiliationLine: event.target.value })} />
            </Field>
          </div>
          <Problems problems={problems} />
          <StepError message={error} />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" disabled={problems.length > 0}>
              Next
            </Button>
            <Button variant="outline" busy={busy} onClick={() => void askForProposal()}>
              Propose again
            </Button>
            <Button variant="ghost" onClick={() => setPart('who')}>
              Back
            </Button>
          </div>
        </form>
      )}

      {part === 'posting' && (
        <form
          className="card space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            void createAccount()
          }}
        >
          <StepHeading>How often {draft.name.trim()} posts</StepHeading>
          <p className="text-ash">
            How often it posts and replies on {place === null ? PLATFORM_KIND_LABELS[platform] : placeLabel(place)}, and how often{' '}
            {props.sponsorName} comes up. {firstPlanLine(place)} You post each draft yourself.
          </p>
          <FormatFields value={draft.format} onChange={(format) => patch({ format })} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Sponsor dial"
              hint={`At 0.3, about 3 in 10 posts name ${props.sponsorName}; the first ${SPONSOR_RAMP_POSTS} never do.`}
            >
              <Input
                type="number"
                min={0}
                max={1}
                step={0.1}
                value={draft.sponsorDial}
                onChange={(event) => patch({ sponsorDial: Number(event.target.value) })}
              />
            </Field>
          </div>
          <StepError message={error} />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" busy={busy}>
              Create and plan the week
            </Button>
            <Button variant="ghost" onClick={() => setPart('profile')}>
              Back
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}

/** The proposal's problems as the operator types, in a polite live list; Next stays off while there are any. */
function Problems(props: { problems: string[] }) {
  return (
    <ul aria-live="polite" className="space-y-1 text-xs text-signal-red-deep">
      {props.problems.map((problem) => (
        <li key={problem}>{problem}</li>
      ))}
    </ul>
  )
}

/** What Influstep reads of the forum the setup found: a Discourse forum is read, any other forum software is run by hand. */
function ForumRead(props: { forum: Forum }) {
  if (props.forum.software === 'discourse') {
    return <p className="text-sm">{props.forum.name} runs on Discourse, so Influstep finds its threads and reads what you post there.</p>
  }
  return (
    <p className="text-sm">
      Influstep cannot read {props.forum.name}: paste a thread’s link to have it answered, and the link to what you posted.
    </p>
  )
}

/** A refusal from the backend, in a polite live region that stays mounted. */
function StepError(props: { message: string | null }) {
  return <div aria-live="polite">{props.message && <ErrorLine>{props.message}</ErrorLine>}</div>
}

/**
 * What a new account's first plan waits for where its posts do not go
 * anywhere from the start (shared `postPlacingOf`, core/planner `planWaits`);
 * null where it plans at once.
 */
function planWaitLine(placing: PostPlacing): string | null {
  switch (placing.kind) {
    case 'anywhere':
      return null
    case 'met':
      return `On ${PLATFORM_IN_WORDS[placing.platform]}, the first two weeks are planned once the listener meets a ${MET_COMMUNITY_NOUNS[placing.platform].one}.`
    case 'nowhere':
      return `On ${placing.forumName}, Influstep plans no post: it cannot read the forum's categories or their rules.`
  }
}

/** What creating the account plans: two weeks at once, or what its first plan waits for. */
function firstPlanLine(place: PlatformPlace | null): string {
  const waits = place === null ? null : planWaitLine(postPlacingOf(place))
  return waits ?? 'Creating it plans the rest of this week and next week.'
}

/** Each place's wait among the accounts the run built, once each, after Done's line. */
function planWaitLines(built: Roster): string {
  const lines = new Set(built.flatMap((account) => planWaitLine(postPlacingOf(account)) ?? []))
  return [...lines].map((line) => ` ${line}`).join('')
}

function DoneStep(props: { created: Id<'accounts'>[]; roster: Roster }) {
  const built = props.roster.filter((account) => props.created.includes(account._id))
  // The one account this run built, when it built one.
  const only = built.length === 1 ? built[0] : undefined
  return (
    <div className="max-w-2xl">
      <PageHeader title={only === undefined ? 'Roster ready' : 'Account created'} />
      <div className="card space-y-4">
        <StepHeading>{only === undefined ? 'Your accounts are set up.' : `${only.name} is set up.`}</StepHeading>
        <p className="text-ash">
          The writer plans the rest of this week and next week, and writes each post the day before it is due. Each draft waits for you on
          Today: post it yourself, then mark it posted.{planWaitLines(built)}
        </p>
        <p className="text-ash">Today also lists the steps only you can take, such as putting each bio on its profile.</p>
        <ul className="divide-y divide-mist rounded-lg border border-mist">
          {built.map((account) => (
            <li key={account._id} className="flex items-center gap-3 px-3 py-2">
              <AccountMark platform={account.platform} size={32} state="idle" />
              <span className="font-medium">{account.name}</span>
              <span className="font-mono text-xs text-ash">{handleOf(account)}</span>
              <LinkButton to="/accounts/$accountId" params={{ accountId: account._id }} variant="ghost" className="ml-auto">
                Open
              </LinkButton>
            </li>
          ))}
        </ul>
        <LinkButton to="/" variant="primary">
          Open Today
        </LinkButton>
      </div>
    </div>
  )
}
