import { SPONSOR_PITCH_MAX, sponsorProblems, withScheme, type SponsorProblem } from '@influstep/shared'
import React from 'react'
import { CharacterCounter } from './character-counter'
import { Field, Input, Textarea } from './ui'

/**
 * The product the accounts promote, as the first-run setup and the Providers
 * page edit it. The value stays text while it is typed, so a cleared field
 * reads as empty rather than as 0.
 */
export interface ProductDraft {
  sponsorName: string
  sponsorUrl: string
  sponsorPitch: string
  valuePerPaid: string
  currency: string
}

/** A blank product, its currency guessed from the browser's region. */
export function emptyProduct(): ProductDraft {
  return { sponsorName: '', sponsorUrl: '', sponsorPitch: '', valuePerPaid: '', currency: guessCurrency() }
}

/** The draft as the backend takes it, trimmed, the value a number and the currency in capitals. */
export function productFields(draft: ProductDraft) {
  return {
    sponsorName: draft.sponsorName.trim(),
    sponsorUrl: withScheme(draft.sponsorUrl),
    sponsorPitch: draft.sponsorPitch.trim(),
    // An empty value is no number, which the shared check names, rather than a silent 0.
    valuePerPaid: draft.valuePerPaid.trim() === '' ? Number.NaN : Number(draft.valuePerPaid),
    currency: draft.currency.trim().toUpperCase(),
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

/** What one paying customer is worth, for the reports' estimate. */
export function ValueFields(props: {
  value: ProductDraft
  onChange: (change: Partial<ProductDraft>) => void
  invalid?: readonly SponsorProblem['field'][]
}) {
  const invalid = (field: SponsorProblem['field']) => props.invalid?.includes(field) || undefined
  return (
    <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
      <Field label="Value of one paying customer" hint="An estimate is fine. 0 if you would rather not say.">
        <Input
          name="valuePerPaid"
          type="number"
          inputMode="decimal"
          min={0}
          step="any"
          value={props.value.valuePerPaid}
          onChange={(event) => props.onChange({ valuePerPaid: event.target.value })}
          aria-invalid={invalid('valuePerPaid')}
          placeholder="49"
        />
      </Field>
      <Field label="Currency">
        <Input
          name="currency"
          value={props.value.currency}
          onChange={(event) => props.onChange({ currency: event.target.value.toUpperCase() })}
          aria-invalid={invalid('currency')}
          maxLength={3}
          className="font-mono uppercase"
          autoComplete="off"
        />
      </Field>
    </div>
  )
}

/** The browser's currency, a fair start; the operator changes it. */
function guessCurrency(): string {
  const region = new Intl.Locale(navigator.language).maximize().region
  return region !== undefined && REGION_CURRENCY[region] !== undefined ? REGION_CURRENCY[region] : 'USD'
}

const EURO_REGIONS = [
  'AT',
  'BE',
  'CY',
  'DE',
  'EE',
  'ES',
  'FI',
  'FR',
  'GR',
  'HR',
  'IE',
  'IT',
  'LT',
  'LU',
  'LV',
  'MT',
  'NL',
  'PT',
  'SI',
  'SK',
]

const REGION_CURRENCY: Record<string, string> = {
  ...Object.fromEntries(EURO_REGIONS.map((region) => [region, 'EUR'])),
  US: 'USD',
  GB: 'GBP',
  NO: 'NOK',
  SE: 'SEK',
  DK: 'DKK',
  CH: 'CHF',
  CA: 'CAD',
  AU: 'AUD',
  JP: 'JPY',
  IN: 'INR',
  TR: 'TRY',
  BR: 'BRL',
  PL: 'PLN',
}
