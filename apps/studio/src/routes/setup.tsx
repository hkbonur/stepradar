import { api } from '@influstep/convex/_generated/api'
import type { SponsorProblem } from '@influstep/shared'
import { Navigate, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import React from 'react'
import { ProductFields, ValueFields, emptyProduct, productFields, productProblems, type ProductDraft } from '@/components/product-fields'
import { SetupSteps } from '@/components/setup-steps'
import { Button, ErrorLine, Skeleton } from '@/components/ui'
import { errorMessage } from '@/lib/errors'
import { platformsInWords } from '@/lib/platforms'

export const Route = createFileRoute('/setup')({ component: SetupPage })

/**
 * The first run (DESIGN.md, Setup): before any workspace exists the studio
 * opens here, without the sidebar, since every other page needs the product.
 * A welcome that says what Influstep does, then the product the accounts
 * promote, then what one paying customer is worth; saving it makes the
 * workspace and hands over to the account onboarding, the setup's last step.
 */
type Step = 'welcome' | 'product' | 'value'

/** The fields each step asks for, so a step only names its own problems. */
const STEP_FIELDS: Record<Exclude<Step, 'welcome'>, SponsorProblem['field'][]> = {
  product: ['sponsorName', 'sponsorUrl', 'sponsorPitch'],
  value: ['valuePerPaid', 'currency'],
}

function SetupPage() {
  const workspace = useQuery(api.private.workspace.get, {})
  const create = useMutation(api.private.workspace.create)
  const navigate = useNavigate()
  const [step, setStep] = React.useState<Step>('welcome')
  const [draft, setDraft] = React.useState<ProductDraft>(emptyProduct)
  // A blank form is not a wrong one: a step names its problems once the operator tried to go on.
  const [tried, setTried] = React.useState<Step | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  if (workspace === undefined) return <Skeleton className="h-96" />
  // Set up already, from another tab or a seed; while this tab saves, the save itself moves on.
  if (workspace !== null && !saving) return <Navigate to="/" replace />

  const patch = (change: Partial<ProductDraft>) => {
    setDraft((current) => ({ ...current, ...change }))
    setError(null)
  }
  const problemsOf = (of: Exclude<Step, 'welcome'>) => productProblems(draft).filter((problem) => STEP_FIELDS[of].includes(problem.field))
  const shown = (of: Exclude<Step, 'welcome'>) => (tried === of ? problemsOf(of) : [])

  const next = (of: Exclude<Step, 'welcome'>, then: () => void) => (event: React.FormEvent) => {
    event.preventDefault()
    setTried(of)
    if (problemsOf(of).length > 0) return
    then()
  }

  const save = async () => {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      await create({ ...productFields(draft), appUrl: window.location.origin })
      await navigate({ to: '/onboarding', search: { first: true }, replace: true })
    } catch (caught) {
      setError(errorMessage(caught))
      setSaving(false)
    }
  }

  if (step === 'welcome') return <Welcome onStart={() => setStep('product')} />

  return (
    <div className="space-y-8">
      <SetupSteps current={step} />
      {step === 'product' && (
        <form className="card space-y-5" onSubmit={next('product', () => setStep('value'))} noValidate>
          <StepHeading lead="The accounts build an audience around what it solves and mention it now and then, in their own words.">
            What do your accounts promote?
          </StepHeading>
          <ProductFields value={draft} onChange={patch} invalid={shown('product').map((problem) => problem.field)} />
          <Problems problems={shown('product')} />
          <Button type="submit" variant="primary">
            Next
          </Button>
        </form>
      )}
      {step === 'value' && (
        <form className="card space-y-5" onSubmit={next('value', () => void save())} noValidate>
          <StepHeading lead="The reports multiply each paying customer an account brings by it. Change it any time on the Providers page.">
            What is one paying customer worth to {draft.sponsorName.trim()}?
          </StepHeading>
          <ValueFields value={draft} onChange={patch} invalid={shown('value').map((problem) => problem.field)} />
          <Problems problems={shown('value')} />
          <div aria-live="polite">{error && <ErrorLine>{error}</ErrorLine>}</div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" busy={saving}>
              Save and build your accounts
            </Button>
            <Button variant="ghost" onClick={() => setStep('product')}>
              Back
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}

function Welcome(props: { onStart: () => void }) {
  const providers = useQuery(api.private.providers.status, {})
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-metric">Welcome to Influstep</h1>
        <p className="mt-2 max-w-[60ch] text-base text-graphite">
          Influstep is your engagement desk on {platformsInWords('conjunction')}. For each of your accounts it finds what people ask in its
          niche, drafts posts and replies, and reads what they bring your product. You post by hand; Influstep never posts.
        </p>
      </div>
      <div>
        <h2 className="eyebrow mb-3">Three steps to start</h2>
        <ol className="divide-y divide-mist border-y border-mist">
          {[
            ['Your product', 'What the accounts promote, in your words.'],
            ['What a customer is worth', 'So the reports can put a value on what each account brings.'],
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
          {providers?.mode === 'mock' &&
            ' Providers run in mock mode: posts, signals and numbers are made up until PROVIDERS_MODE=real and the keys are set on the Convex deployment. The Providers page lists them.'}
          {providers?.mode === 'real' &&
            !providers.keys.ANTHROPIC_API_KEY &&
            ' ANTHROPIC_API_KEY is not set on the Convex deployment, so the writer cannot propose your accounts until it is.'}
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
function Problems(props: { problems: SponsorProblem[] }) {
  return (
    <ul aria-live="polite" className="space-y-1 text-xs text-signal-red-deep">
      {props.problems.map((problem) => (
        <li key={problem.message}>{problem.message}</li>
      ))}
    </ul>
  )
}
