import { api } from '@stepradar/convex/_generated/api'
import {
  SPONSOR_PITCH_MAX,
  SPONSOR_PROFILE_FIELDS,
  SPONSOR_PROFILE_LIMITS,
  emptySponsorProfile,
  sponsorProblems,
  sponsorProfileOfText,
  sponsorProfileText,
  withScheme,
  type ProfileProposal,
  type SponsorFields,
  type SponsorProblem,
  type SponsorProfileText,
} from '@stepradar/shared'
import { useAction } from 'convex/react'
import React from 'react'
import { errorMessage } from '@/lib/errors'
import { CharacterCounter } from './character-counter'
import { Button, ErrorLine, Field, Input, Textarea } from './ui'

/**
 * The product the accounts promote, as the first-run setup and the Providers
 * page edit it: what it is (`ProductFields`) and its profile, what a search
 * asks for (`ProfileFields`). The profile's lists are held as the text
 * the operator types (shared `SponsorProfileText`).
 */
export interface ProductDraft extends SponsorProfileText {
  sponsorName: string
  sponsorUrl: string
  sponsorPitch: string
}

/** A blank product. */
export function emptyProduct(): ProductDraft {
  return { sponsorName: '', sponsorUrl: '', sponsorPitch: '', ...sponsorProfileText(emptySponsorProfile()) }
}

/** The saved product as the form shows it. */
export function productDraft(saved: SponsorFields): ProductDraft {
  return {
    sponsorName: saved.sponsorName,
    sponsorUrl: saved.sponsorUrl,
    sponsorPitch: saved.sponsorPitch,
    ...sponsorProfileText(saved.sponsorProfile),
  }
}

/** The draft as the backend takes it, trimmed, the website with its scheme. */
export function productFields(draft: ProductDraft): SponsorFields {
  return {
    sponsorName: draft.sponsorName.trim(),
    sponsorUrl: withScheme(draft.sponsorUrl),
    sponsorPitch: draft.sponsorPitch.trim(),
    sponsorProfile: sponsorProfileOfText(draft),
  }
}

/** The shared check's problems, with the backend's own words. */
export function productProblems(draft: ProductDraft): SponsorProblem[] {
  return sponsorProblems(productFields(draft))
}

/** Name, website and what it does: what the writer needs to mention it. */
export function ProductFields(props: {
  value: ProductDraft
  onChange: (change: Partial<ProductDraft>) => void
  /** The fields a shown problem is about, marked invalid. */
  invalid?: readonly SponsorProblem['field'][]
}) {
  const pitchId = React.useId()
  const invalid = (field: SponsorProblem['field']) => props.invalid?.includes(field) || undefined
  const pitch = props.value.sponsorPitch
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Product name">
        <Input
          name="sponsorName"
          value={props.value.sponsorName}
          onChange={(event) => props.onChange({ sponsorName: event.target.value })}
          aria-invalid={invalid('sponsorName')}
          placeholder="Ledgerly"
          autoComplete="organization"
        />
      </Field>
      <Field label="Website" hint="Where tracked links send readers.">
        <Input
          name="sponsorUrl"
          value={props.value.sponsorUrl}
          onChange={(event) => props.onChange({ sponsorUrl: event.target.value })}
          aria-invalid={invalid('sponsorUrl')}
          placeholder="ledgerly.example"
          autoComplete="url"
        />
      </Field>
      <div className="grid gap-1.5 sm:col-span-2">
        <div className="flex items-center justify-between gap-3">
          <label htmlFor={pitchId} className="text-xs font-medium text-graphite">
            What it does, in one sentence
          </label>
          <CharacterCounter id={`${pitchId}-counter`} length={pitch.trim().length} limit={SPONSOR_PITCH_MAX} />
        </div>
        <Textarea
          id={pitchId}
          name="sponsorPitch"
          value={pitch}
          onChange={(event) => props.onChange({ sponsorPitch: event.target.value })}
          aria-invalid={invalid('sponsorPitch')}
          placeholder="Bookkeeping for freelancers that sorts every receipt the moment you snap it."
          className="min-h-16"
          aria-describedby={`${pitchId}-counter ${pitchId}-hint`}
        />
        <span id={`${pitchId}-hint`} className="text-xs text-ash">
          The accounts say it in their own words when they mention the product, never as an ad read.
        </span>
      </div>
    </div>
  )
}

/** Where a proposal stands: none asked, the writer at work, one filled in (with whether the website was read), or refused. */
type ProposalState =
  | { status: 'idle' }
  | { status: 'proposing' }
  | { status: 'proposed'; site: ProfileProposal['site'] }
  | { status: 'error'; message: string }

/**
 * The product's profile: its competitors and the search terms people use
 * for what it does. The writer proposes both from the product above and its
 * website, and the operator edits them; a proposal replaces what the fields
 * hold. Either field may stay empty.
 */
export function ProfileFields(props: {
  value: ProductDraft
  onChange: (change: Partial<ProductDraft>) => void
  /** The fields a shown problem is about, marked invalid. */
  invalid?: readonly SponsorProblem['field'][]
}) {
  const propose = useAction(api.private.workspace.proposeProfile)
  const [state, setState] = React.useState<ProposalState>({ status: 'idle' })
  const invalid = (field: SponsorProblem['field']) => props.invalid?.includes(field) || undefined
  const { sponsorName, sponsorUrl, sponsorPitch } = productFields(props.value)
  const filled = SPONSOR_PROFILE_FIELDS.some((field) => props.value[field].trim() !== '')

  const proposeNow = async () => {
    setState({ status: 'proposing' })
    try {
      const proposal = await propose({ sponsorName, sponsorUrl, sponsorPitch })
      props.onChange(sponsorProfileText(proposal.profile))
      setState({ status: 'proposed', site: proposal.site })
    } catch (caught) {
      setState({ status: 'error', message: errorMessage(caught) })
    }
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Button busy={state.status === 'proposing'} onClick={() => void proposeNow()}>
          Propose from the website
        </Button>
        <span aria-live="polite" className="text-xs text-ash">
          {state.status === 'idle' && filled && 'A proposal replaces what is here.'}
          {state.status === 'proposing' && 'Reading the website…'}
          {state.status === 'proposed' && state.site.read && 'Proposed from the website. Change anything.'}
          {state.status === 'proposed' &&
            !state.site.read &&
            `Proposed from the name and the pitch alone: the website was not read, ${state.site.why}.`}
        </span>
      </div>
      {state.status === 'error' && <ErrorLine>{state.message}</ErrorLine>}
      <Field
        label="Competitors"
        hint={`Other products people compare it with, comma separated, up to ${SPONSOR_PROFILE_LIMITS.competitors.count}. Searched by name beside each account's pillars.`}
      >
        <Input
          name="competitors"
          value={props.value.competitors}
          onChange={(event) => props.onChange({ competitors: event.target.value })}
          aria-invalid={invalid('competitors')}
          placeholder="QuickBooks, FreshBooks"
        />
      </Field>
      <Field
        label="Search terms"
        hint={`What people call what it does, one to three words each, comma separated, up to ${SPONSOR_PROFILE_LIMITS.searchTerms.count}. Searched beside each account's pillars.`}
      >
        <Input
          name="searchTerms"
          value={props.value.searchTerms}
          onChange={(event) => props.onChange({ searchTerms: event.target.value })}
          aria-invalid={invalid('searchTerms')}
          placeholder="receipt scanner, freelance bookkeeping"
        />
      </Field>
    </div>
  )
}
