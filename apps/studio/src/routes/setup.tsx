import { api } from '@stepradar/convex/_generated/api'
import {
  PROVIDER_KEY_HINTS,
  PROVIDER_KEY_LABELS,
  providerKeyProblem,
  sponsorProductProblems,
  sponsorProfileProblems,
} from '@stepradar/shared'
import { Navigate, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import type { FunctionReturnType } from 'convex/server'
import React from 'react'
import { ProductFields, ProfileFields, emptyProduct, productFields, type ProductDraft } from '@/components/product-fields'
import { keyStatusText } from '@/components/provider-keys'
import { SetupSteps } from '@/components/setup-steps'
import { Button, ErrorLine, Field, Input, Mono, Skeleton } from '@/components/ui'
import { errorMessage } from '@/lib/errors'
import { platformsInWords } from '@/lib/platforms'

export const Route = createFileRoute('/setup')({ component: SetupPage })

/**
 * The first run (DESIGN.md, Setup): before any workspace exists the studio
 * opens here, without the sidebar, since every other page needs the product.
 * A welcome that says what Stepradar does, then the product the accounts
 * promote, then the Anthropic key the agents write with (ADR 0005), stored as
 * that step ends so the writer can propose the product's profile in the next
 * one: what a search asks for beyond each account's pillars. Saving makes the
 * workspace and hands over to the account onboarding, the setup's last step.
 * The key can wait in mock mode, and the profile can stay empty: the
 * Providers page takes both later.
 */
type Step = 'welcome' | 'product' | 'key' | 'profile'

/** The step that may show its problems: none until the operator tried to go on, so a blank form never opens red. */
type Tried = 'product' | 'key' | 'profile' | null

function SetupPage() {
  const workspace = useQuery(api.private.workspace.get, {})
  const providers = useQuery(api.private.providers.status, {})
  const create = useMutation(api.private.workspace.create)
  const storeKey = useMutation(api.private.keys.set)
  const navigate = useNavigate()
  const [step, setStep] = React.useState<Step>('welcome')
  const [draft, setDraft] = React.useState<ProductDraft>(emptyProduct)
  const [key, setKey] = React.useState('')
  const [tried, setTried] = React.useState<Tried>(null)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  if (workspace === undefined || providers === undefined) return <Skeleton className="h-96" />
  // Set up already, from another tab or a seed; while this tab saves, the save itself moves on.
  if (workspace !== null && !saving) return <Navigate to="/" replace />

  const patch = (change: Partial<ProductDraft>) => {
    setDraft((current) => ({ ...current, ...change }))
    setError(null)
  }
  const stored = providers.providerKeys.find((status) => status.name === 'ANTHROPIC_API_KEY')
  if (stored === undefined) throw new Error('the Providers status lists no Anthropic key')
  const keyProblem = providerKeyProblem('ANTHROPIC_API_KEY', key)
  // A key already stored, from an earlier try or the Providers page, needs no other.
  const keyNeeded = !stored.set || key.trim() !== ''

  // Each step checks its own part of the product (shared workspace.ts), so a step never names another's problem.
  const fields = productFields(draft)
  const productStepProblems = sponsorProductProblems(fields)
  const profileStepProblems = sponsorProfileProblems(fields.sponsorProfile, fields.sponsorName)

  const toKey = (event: React.FormEvent) => {
    event.preventDefault()
    setTried('product')
    if (productStepProblems.length > 0) return
    setStep('key')
  }

  /** The key is stored as its step ends, so the next step's proposal can be written with it. */
  const toProfile = async (withKey: boolean) => {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      if (withKey) await storeKey({ name: 'ANTHROPIC_API_KEY', value: key })
      setKey('')
      setTried(null)
      setStep('profile')
    } catch (caught) {
      setError(errorMessage(caught))
    }
    setSaving(false)
  }

  const submitKey = (event: React.FormEvent) => {
    event.preventDefault()
    setTried('key')
    if (keyNeeded && keyProblem !== null) return
    void toProfile(keyNeeded)
  }

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    setTried('profile')
    if (saving || profileStepProblems.length > 0) return
    setSaving(true)
    setError(null)
    try {
      await create({ ...fields, appUrl: window.location.origin })
      await navigate({ to: '/onboarding', search: { first: true }, replace: true })
    } catch (caught) {
      setError(errorMessage(caught))
      setSaving(false)
    }
  }

  if (step === 'welcome') return <Welcome mode={providers.mode} onStart={() => setStep('product')} />

  const productShown = tried === 'product' ? productStepProblems : []
  const profileShown = tried === 'profile' ? profileStepProblems : []
  return (
    <div className="space-y-8">
      <SetupSteps current={step} />
      {step === 'product' && (
        <form className="card space-y-5" onSubmit={toKey} noValidate>
          <StepHeading lead="The accounts build an audience around what it solves and mention it now and then, in their own words.">
            What do your accounts promote?
          </StepHeading>
          <ProductFields value={draft} onChange={patch} invalid={productShown.map((problem) => problem.field)} />
          <Problems messages={productShown.map((problem) => problem.message)} />
          <Button type="submit" variant="primary">
            Next
          </Button>
        </form>
      )}
      {step === 'key' && (
        <form className="card space-y-5" onSubmit={submitKey} noValidate>
          <StepHeading lead="The writer, the judge and the classifier run on Claude with your key. It stays in your Stepradar backend and is never shown again; the Providers page replaces or removes it.">
            Which Anthropic key do your accounts write with?
          </StepHeading>
          <Field label={PROVIDER_KEY_LABELS.ANTHROPIC_API_KEY} hint={PROVIDER_KEY_HINTS.ANTHROPIC_API_KEY}>
            <Input
              name="ANTHROPIC_API_KEY"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={key}
              onChange={(event) => {
                setKey(event.target.value)
                setError(null)
              }}
              placeholder={stored.set ? 'Paste a new key to replace it' : 'sk-ant-…'}
              aria-invalid={(tried === 'key' && keyNeeded && keyProblem !== null) || undefined}
            />
          </Field>
          {stored.set && <p className="text-xs text-field-green-deep">{keyStatusText(stored)}</p>}
          <Problems messages={tried === 'key' && keyNeeded && keyProblem !== null ? [keyProblem] : []} />
          {providers.mode === 'mock' && (
            <p className="max-w-[60ch] text-xs text-ash">
              Stepradar runs in mock mode now: nothing calls Claude until <Mono>PROVIDERS_MODE=real</Mono> is set on the Convex deployment.
            </p>
          )}
          <div aria-live="polite">{error && <ErrorLine>{error}</ErrorLine>}</div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" busy={saving}>
              Next
            </Button>
            {/* In real mode the writer needs the key to propose the profile and an account, the setup's next steps. */}
            {!stored.set && providers.mode === 'mock' && (
              <Button variant="ghost" disabled={saving} onClick={() => void toProfile(false)}>
                Add it later
              </Button>
            )}
            <Button variant="ghost" disabled={saving} onClick={() => setStep('product')}>
              Back
            </Button>
          </div>
        </form>
      )}
      {step === 'profile' && (
        <form className="card space-y-5" onSubmit={save} noValidate>
          <StepHeading
            lead={`Threads rarely say a product's pitch. They name what people use today, or call the thing by a plain word. The writer proposes both for ${draft.sponsorName.trim()} from its website, and a search asks for them beside each account's pillars; change anything, or leave it empty and fill it in later on the Providers page.`}
          >
            What should Stepradar search for?
          </StepHeading>
          <ProfileFields value={draft} onChange={patch} invalid={profileShown.map((problem) => problem.field)} />
          <Problems messages={profileShown.map((problem) => problem.message)} />
          <div aria-live="polite">{error && <ErrorLine>{error}</ErrorLine>}</div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" busy={saving}>
              Save and build your accounts
            </Button>
            <Button variant="ghost" disabled={saving} onClick={() => setStep('key')}>
              Back
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}

function Welcome(props: { mode: FunctionReturnType<typeof api.private.providers.status>['mode']; onStart: () => void }) {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-metric">Welcome to Stepradar</h1>
        <p className="mt-2 max-w-[60ch] text-base text-graphite">
          Stepradar is your engagement desk on {platformsInWords('conjunction')}. For each of your accounts it finds what people ask in its
          niche, drafts posts and replies, and reads what they reach. You post by hand; Stepradar never posts.
        </p>
      </div>
      <div>
        <h2 className="eyebrow mb-3">Four steps to start</h2>
        <ol className="divide-y divide-mist border-y border-mist">
          {[
            ['Your product', 'What the accounts promote, in your words.'],
            ['Your Anthropic key', 'The agents write with Claude on it; it can wait until you switch to real mode.'],
            ['What to search for', 'The competitors and search terms threads are found by, proposed from your website.'],
            [
              'Your accounts',
              `One to five of your own accounts on ${platformsInWords('conjunction')}, each with a niche and an audience you pick.`,
            ],
          ].map(([title, line], index) => (
            <li key={title} className="flex items-baseline gap-4 py-3">
              <span className="tabular w-4 shrink-0 font-mono text-xs text-ash">{index + 1}</span>
              <span>
                <span className="font-medium">{title}</span>
                <span className="block text-sm text-ash">{line}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>
      <div className="space-y-3">
        <Button variant="primary" onClick={props.onStart}>
          Get started
        </Button>
        <p className="max-w-[60ch] text-xs text-ash">
          Nothing goes out unless you post it.
          {props.mode === 'mock' &&
            ' Providers run in mock mode: posts, signals and numbers are made up until PROVIDERS_MODE=real is set on the Convex deployment.'}
        </p>
      </div>
    </div>
  )
}

/** The step's question as its heading, which takes focus when the step appears, and one line on why it is asked. */
function StepHeading(props: { children: React.ReactNode; lead: string }) {
  const ref = React.useRef<HTMLHeadingElement>(null)
  React.useEffect(() => ref.current?.focus(), [])
  return (
    <div>
      <h1 ref={ref} tabIndex={-1} className="text-metric outline-none">
        {props.children}
      </h1>
      <p className="mt-2 max-w-[60ch] text-graphite">{props.lead}</p>
    </div>
  )
}

/** The step's problems in the backend's words; a polite live list that stays mounted. */
function Problems(props: { messages: string[] }) {
  return (
    <ul aria-live="polite" className="space-y-1 text-xs text-signal-red-deep">
      {props.messages.map((message) => (
        <li key={message}>{message}</li>
      ))}
    </ul>
  )
}
