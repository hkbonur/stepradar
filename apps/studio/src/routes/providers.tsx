import { api } from '@influstep/convex/_generated/api'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import React from 'react'
import { NotificationSettings } from '@/components/notification-settings'
import { ProductFields, ValueFields, productFields, productProblems, type ProductDraft } from '@/components/product-fields'
import { Alert, Button, Card, Collapsible, ErrorLine, Field, Input, Mono, PageHeader, Pill, Skeleton } from '@/components/ui'
import { cn } from '@/lib/cn'
import { errorMessage } from '@/lib/errors'
import { relativeTime } from '@/lib/format'

export const Route = createFileRoute('/providers')({ component: ProvidersPage })

function ProvidersPage() {
  const status = useQuery(api.private.providers.status, {})
  const retry = useMutation(api.private.jobs.retry)
  if (!status) return <Skeleton className="h-96 rounded-xl" />
  const failed = status.recentJobs.filter((job) => job.status === 'failed').length
  return (
    <>
      <PageHeader
        title="Providers"
        lead="Where the drafts and the numbers come from, your product, and the devices that get notifications."
      />
      {status.mode === 'mock' ? (
        <Alert tone="info" title="Running in mock mode" className="mb-6">
          Signals, threads, drafts and numbers are generated, so the whole loop can be walked. Set <Mono>PROVIDERS_MODE=real</Mono> and the
          keys below on the Convex deployment to switch.
        </Alert>
      ) : (
        <Alert tone="success" title="Running in real mode" className="mb-6">
          Each adapter below reads its platform with its key; one without its key fails by name, never served from a mock.
        </Alert>
      )}
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Card
          title="Adapters"
          count={status.providers.length}
          flush
          footer={
            <Collapsible summary="Where keys live and sources">
              <p>Keys live in the Convex deployment's environment. An adapter without its key fails loudly instead of pretending.</p>
              <p className="mt-1.5">
                The researcher searches every platform whose reader can, and Google's suggestions. Comments come from each account's posts
                through its platform's reader, and problems from each account's problem log. What a reader cannot do is a step you take by
                hand.
              </p>
            </Collapsible>
          }
        >
          <div className="overflow-x-auto">
            <table className="card-table w-full text-sm">
              <thead className="bg-paper-tint text-xs text-ash">
                <tr className="text-left">
                  <th className="py-2 pr-4 font-medium">Provider</th>
                  <th className="py-2 pr-4 font-medium">Real adapter</th>
                  <th className="py-2 font-medium">Needs</th>
                </tr>
              </thead>
              <tbody>
                {status.providers.map((provider) => {
                  const missing = provider.needs.filter((key) => !status.keys[key as keyof typeof status.keys])
                  return (
                    <tr key={provider.name} className="border-t border-mist">
                      <td className="py-2.5 pr-4 whitespace-nowrap">
                        <Mono>{provider.name}</Mono>
                      </td>
                      <td className="py-2.5 pr-4">
                        {provider.real}
                        {!provider.hasReal && <span className="ml-1 text-xs whitespace-nowrap text-ash">mock only</span>}
                      </td>
                      <td className="py-2.5">
                        <span className="flex flex-wrap gap-1">
                          {provider.needs.map((key) => (
                            <Pill key={key} tint={missing.includes(key) ? (status.mode === 'real' ? 'signal-red' : 'fog') : 'field-green'}>
                              {key}
                            </Pill>
                          ))}
                          {provider.needs.length === 0 && <span className="text-xs text-ash">no key</span>}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="min-w-0 space-y-6">
          <Card title="Your product" description="What every account promotes, and what one paying customer is worth.">
            <WorkspaceForm />
          </Card>

          <Card title="Notifications">
            <NotificationSettings />
          </Card>

          <Card>
            <Collapsible
              summary="Recent jobs"
              count={status.recentJobs.length}
              defaultOpen={failed > 0}
              meta={failed > 0 && <span className="text-signal-red-deep">{failed} failed</span>}
            >
              <ul className="space-y-1.5 font-mono text-[11px]">
                {status.recentJobs.map((job) => (
                  <li key={job._id} className="flex flex-wrap items-center gap-2">
                    <span
                      aria-hidden
                      className={cn('size-1.5 shrink-0 rounded-full', {
                        'bg-field-green': job.status === 'done',
                        'bg-signal-red': job.status === 'failed',
                        'bg-note-blue': job.status === 'running',
                        'bg-fog': job.status === 'queued',
                      })}
                    />
                    <span className="text-graphite">{job.kind}</span>
                    <span className="text-ash">
                      {job.status}
                      {job.attempts > 1 && ` · attempt ${job.attempts}`}
                    </span>
                    <span className="ml-auto text-ash">{relativeTime(job.finishedAt ?? job.startedAt ?? job.createdAt)}</span>
                    {job.status === 'failed' && (
                      <button type="button" className="text-ink hover:underline" onClick={() => retry({ jobId: job._id })}>
                        retry
                      </button>
                    )}
                    {job.error && <span className="basis-full truncate text-signal-red-deep">{job.error}</span>}
                  </li>
                ))}
              </ul>
            </Collapsible>
          </Card>
        </div>
      </div>
    </>
  )
}

const SAVED_FOR_MS = 2000

/** The form is in exactly one of these; "Saved" shows for a moment, then the form is idle again. */
type WorkspaceFormState = { status: 'idle' } | { status: 'saving' } | { status: 'saved' } | { status: 'error'; message: string }

/** The product the accounts promote, what one paying customer is worth to it, and where the studio lives for links. */
function WorkspaceForm() {
  const workspace = useQuery(api.private.workspace.get, {})
  if (workspace === undefined) return <Skeleton className="h-40" />
  // The root sends a first run to the setup, so this page never shows without a workspace.
  if (workspace === null) return null
  // Keyed on what is saved, so a save from another tab or the setup refills the form.
  return (
    <ProductForm
      key={[workspace.sponsorName, workspace.sponsorUrl, workspace.sponsorPitch, workspace.valuePerPaid, workspace.currency].join('\u0000')}
      saved={{
        sponsorName: workspace.sponsorName,
        sponsorUrl: workspace.sponsorUrl,
        sponsorPitch: workspace.sponsorPitch,
        valuePerPaid: String(workspace.valuePerPaid),
        currency: workspace.currency,
      }}
      appUrl={workspace.appUrl}
    />
  )
}

function ProductForm(props: { saved: ProductDraft; appUrl: string }) {
  const update = useMutation(api.private.workspace.update)
  const [draft, setDraft] = React.useState(props.saved)
  const [appUrl, setAppUrl] = React.useState(props.appUrl)
  const [state, setState] = React.useState<WorkspaceFormState>({ status: 'idle' })
  const savedTimer = React.useRef<number | null>(null)
  const problems = productProblems(draft)
  const patch = (change: Partial<ProductDraft>) => {
    setDraft((current) => ({ ...current, ...change }))
    if (state.status === 'error') setState({ status: 'idle' })
  }
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (state.status === 'saving' || problems.length > 0) return
    setState({ status: 'saving' })
    try {
      await update({ ...productFields(draft), appUrl: appUrl.trim() })
      setState({ status: 'saved' })
      if (savedTimer.current !== null) window.clearTimeout(savedTimer.current)
      savedTimer.current = window.setTimeout(
        () => setState((current) => (current.status === 'saved' ? { status: 'idle' } : current)),
        SAVED_FOR_MS
      )
    } catch (caught) {
      setState({ status: 'error', message: errorMessage(caught) })
    }
  }
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <ProductFields value={draft} onChange={patch} invalid={problems.map((problem) => problem.field)} />
      <ValueFields value={draft} onChange={patch} invalid={problems.map((problem) => problem.field)} />
      <Field label="Studio address" hint="Where tracked links live.">
        <Input name="appUrl" type="url" value={appUrl} onChange={(event) => setAppUrl(event.target.value)} />
      </Field>
      <ul aria-live="polite" className="space-y-1 text-xs text-signal-red-deep">
        {problems.map((problem) => (
          <li key={problem.message}>{problem.message}</li>
        ))}
      </ul>
      {state.status === 'error' && <ErrorLine>{state.message}</ErrorLine>}
      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" busy={state.status === 'saving'} disabled={problems.length > 0}>
          Save
        </Button>
        {state.status === 'saved' && <span className="text-xs text-ash">Saved</span>}
      </div>
    </form>
  )
}
