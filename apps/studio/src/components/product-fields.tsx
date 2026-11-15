import { SPONSOR_PITCH_MAX, sponsorProblems, withScheme, type SponsorProblem } from '@stepradar/shared'
import React from 'react'
import { CharacterCounter } from './character-counter'
import { Field, Input, Textarea } from './ui'

/**
 * The product the accounts promote, as the first-run setup and the Providers
 * page edit it.
 */
export interface ProductDraft {
  sponsorName: string
  sponsorUrl: string
  sponsorPitch: string
}

/** A blank product. */
export function emptyProduct(): ProductDraft {
  return { sponsorName: '', sponsorUrl: '', sponsorPitch: '' }
}

/** The draft as the backend takes it, trimmed, the website with its scheme. */
export function productFields(draft: ProductDraft) {
  return {
    sponsorName: draft.sponsorName.trim(),
    sponsorUrl: withScheme(draft.sponsorUrl),
    sponsorPitch: draft.sponsorPitch.trim(),
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
