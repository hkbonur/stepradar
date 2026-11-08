import { api } from '@influstep/convex/_generated/api'
import type { Doc, Id } from '@influstep/convex/_generated/dataModel'
import { PLATFORM_POST_KINDS, POST_KIND_LABELS, parsePillars, placeLabel, placeOf, type PlatformFormat } from '@influstep/shared'
import { useMutation } from 'convex/react'
import type { FunctionReturnType } from 'convex/server'
import React from 'react'
import { FormatFields } from './format-fields'
import { Button, Card, ErrorLine, Field, type FormState, Input, Mono, Textarea } from './ui'
import { errorMessage } from '@/lib/errors'
import { formatHour, plural } from '@/lib/format'

type BioLinkData = NonNullable<NonNullable<FunctionReturnType<typeof api.private.accounts.get>>['bioLink']>

/**
 * The account as it was set up, as one card: who it talks to, how often it
 * posts and replies, the sponsor dial, its pillars, its bio and the bio link
 * the operator puts on its profile.
 */
export function ProfileCard(props: { account: Doc<'accounts'>; bioLink: BioLinkData | null }) {
  const account = props.account
  return (
    <Card title="Profile">
      <dl className="space-y-3 text-sm">
        {account.audience && <Row label="Audience">{account.audience}</Row>}
        <Row label={`On ${placeLabel(placeOf(account))}`}>
          <span className="tabular">{account.cadence.postsPerDay}</span> {plural(account.cadence.postsPerDay, 'post', 'posts')} a day at{' '}
          <Mono>{formatHour(account.publishHour)}</Mono> {account.timezone}:{' '}
          {account.cadence.kinds.map((kind) => POST_KIND_LABELS[kind].toLowerCase()).join(', ')}.{' '}
          <span className="tabular">{account.cadence.repliesPerDay}</span> {plural(account.cadence.repliesPerDay, 'reply', 'replies')} a
          day.
        </Row>
        <Row label="Sponsor dial">
          <span className="tabular">
            {Math.round(account.sponsorDial * 100)}% after {account.sponsorRampPosts} posts
          </span>
        </Row>
        <Row label="Pillars">{account.pillars.join(', ')}</Row>
        <Row label="Bio">{account.bio}</Row>
        <Row label="Bio link">{props.bioLink === null ? <MakeBioLink accountId={account._id} /> : <BioLink link={props.bioLink} />}</Row>
      </dl>
    </Card>
  )
}

/** One fact of the profile: its label in 12px ash over it, so a long value never squeezes into a narrow column. */
function Row(props: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-ash">{props.label}</dt>
      <dd className="mt-0.5">{props.children}</dd>
    </div>
  )
}

/** Make the bio link, for an account made before every account got one. */
function MakeBioLink(props: { accountId: Id<'accounts'> }) {
  const makeBioLink = useMutation(api.private.accounts.makeBioLink)
  const [state, setState] = React.useState<FormState>({ status: 'idle' })
  const make = async () => {
    setState({ status: 'saving' })
    try {
      await makeBioLink({ accountId: props.accountId })
      setState({ status: 'idle' })
    } catch (caught) {
      setState({ status: 'error', message: errorMessage(caught) })
    }
  }
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Button size="sm" busy={state.status === 'saving'} onClick={() => void make()}>
        Make a bio link
      </Button>
      {state.status === 'error' && <ErrorLine>{state.message}</ErrorLine>}
    </span>
  )
}

/** The link the operator puts on the account's profile, with Copy and, where Influstep counts them, its clicks. */
function BioLink(props: { link: BioLinkData }) {
  const [copy, setCopy] = React.useState<{ status: 'idle' | 'copied' } | { status: 'error'; message: string }>({ status: 'idle' })
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(props.link.url)
      setCopy({ status: 'copied' })
    } catch (caught) {
      setCopy({ status: 'error', message: `Copy failed: ${errorMessage(caught)} Select the link and copy it.` })
    }
  }
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <Mono className="break-all">{props.link.url}</Mono>
      <Button size="sm" variant="ghost" className="h-6 px-1.5" onClick={() => void copyLink()}>
        {copy.status === 'copied' ? 'Copied' : 'Copy'}
      </Button>
      {props.link.kind === 'tracked' && (
        <span className="text-ash">
          <span className="tabular">{props.link.clicks}</span> {plural(props.link.clicks, 'click', 'clicks')}
        </span>
      )}
      {copy.status === 'error' && <ErrorLine>{copy.message}</ErrorLine>}
    </span>
  )
}

export function AccountSettings(props: { account: Doc<'accounts'>; onDone: () => void }) {
  const update = useMutation(api.private.accounts.update)
  const [state, setState] = React.useState<FormState>({ status: 'idle' })
  const [format, setFormat] = React.useState<PlatformFormat>(() => {
    // An older cadence may list a thread where only X takes one; the planner writes text posts there, so the form opens on those.
    const taken = props.account.cadence.kinds.filter((kind) => PLATFORM_POST_KINDS[props.account.platform].includes(kind))
    return {
      platform: props.account.platform,
      publishHour: props.account.publishHour,
      cadence: { ...props.account.cadence, kinds: taken.length > 0 ? taken : ['text'] },
    }
  })
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const text = (name: string) => String(form.get(name) ?? '').trim()
    setState({ status: 'saving' })
    try {
      await update({
        accountId: props.account._id,
        name: text('name'),
        niche: text('niche'),
        // Cleared, the account has no audience: the writer then reads the niche alone.
        audience: text('audience') || undefined,
        tone: text('tone'),
        bio: text('bio'),
        bible: text('bible'),
        affiliationLine: text('affiliationLine'),
        pillars: parsePillars(text('pillars')),
        publishHour: format.publishHour,
        cadence: format.cadence,
        sponsorDial: Number(form.get('sponsorDial')),
        sponsorRampPosts: Number(form.get('sponsorRampPosts')),
        timezone: text('timezone'),
      })
      props.onDone()
    } catch (caught) {
      setState({ status: 'error', message: errorMessage(caught) })
    }
  }
  const p = props.account
  return (
    <Card title="Settings" description="What the writer and the planner read for this account." className="mb-6">
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Name">
          <Input name="name" defaultValue={p.name} required />
        </Field>
        <Field label="Niche" className="lg:col-span-2">
          <Input name="niche" defaultValue={p.niche} required />
        </Field>
        <Field label="Audience" className="sm:col-span-2 lg:col-span-3" hint="Who it talks to. The writer reads it with the niche.">
          <Input name="audience" defaultValue={p.audience ?? ''} />
        </Field>
        <Field label="Tone">
          <Input name="tone" defaultValue={p.tone} required />
        </Field>
        <Field label="Content pillars" hint="Comma separated." className="lg:col-span-2">
          <Input name="pillars" defaultValue={p.pillars.join(', ')} required />
        </Field>
        <Field label="Bio" className="sm:col-span-2 lg:col-span-3">
          <Input name="bio" defaultValue={p.bio} required />
        </Field>
        <Field label="Account bible" className="sm:col-span-2 lg:col-span-3">
          <Textarea name="bible" defaultValue={p.bible} required className="min-h-28" />
        </Field>
        <Field
          label="Affiliation line"
          hint="Said as written in every draft that names your product."
          className="sm:col-span-2 lg:col-span-3"
        >
          <Input name="affiliationLine" defaultValue={p.affiliationLine} required />
        </Field>
        <Field label="Sponsor dial" hint="0 to 1">
          <Input name="sponsorDial" type="number" min={0} max={1} step={0.05} defaultValue={p.sponsorDial} />
        </Field>
        <Field label="Unsponsored ramp" hint="Posts before the dial applies.">
          <Input name="sponsorRampPosts" type="number" min={0} defaultValue={p.sponsorRampPosts} />
        </Field>
        <Field label="Timezone" hint="The post hour is local to it.">
          <Input name="timezone" defaultValue={p.timezone} required />
        </Field>
        <FormatFields value={format} onChange={setFormat} className="sm:col-span-2 lg:col-span-3" />
        {state.status === 'error' && (
          <div className="sm:col-span-2 lg:col-span-3">
            <ErrorLine>{state.message}</ErrorLine>
          </div>
        )}
        <div className="flex gap-2 sm:col-span-2 lg:col-span-3">
          <Button type="submit" variant="primary" busy={state.status === 'saving'}>
            Save
          </Button>
          <Button variant="ghost" onClick={props.onDone}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  )
}
