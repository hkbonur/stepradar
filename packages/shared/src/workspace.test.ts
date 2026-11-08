import { describe, expect, it } from 'vitest'
import { isWebUrl, sponsorProblems, withScheme, type SponsorFields } from './workspace'

const FIELDS: SponsorFields = {
  sponsorName: 'Acme',
  sponsorUrl: 'https://acme.example',
  sponsorPitch: 'Invoices that chase themselves until they are paid.',
  valuePerPaid: 49,
  currency: 'USD',
}

describe('sponsorProblems', () => {
  it('takes a product with a name, a website, a one-sentence pitch and a value', () => {
    expect(sponsorProblems(FIELDS)).toEqual([])
    expect(sponsorProblems({ ...FIELDS, valuePerPaid: 0 })).toEqual([])
  })

  it('names every problem in form order', () => {
    expect(
      sponsorProblems({ sponsorName: ' ', sponsorUrl: 'acme.example', sponsorPitch: 'Invoices', valuePerPaid: -1, currency: 'usd' })
    ).toEqual([
      { field: 'sponsorName', message: 'Name the product.' },
      { field: 'sponsorUrl', message: 'The website must be a full address, such as https://example.com.' },
      { field: 'sponsorPitch', message: 'Say what the product does in a sentence of at least 20 characters.' },
      { field: 'valuePerPaid', message: 'A paying customer is worth 0 or more.' },
      { field: 'currency', message: 'The currency is three capital letters, such as USD or EUR.' },
    ])
    expect(sponsorProblems({ ...FIELDS, sponsorPitch: 'a'.repeat(201) })).toEqual([
      { field: 'sponsorPitch', message: 'Keep what the product does to 200 characters.' },
    ])
  })
})

describe('isWebUrl', () => {
  it('takes only http and https addresses', () => {
    expect(isWebUrl('https://acme.example/app')).toBe(true)
    expect(isWebUrl('mailto:hi@acme.example')).toBe(false)
  })
})

describe('withScheme', () => {
  it('reads an address typed without its scheme as https, and leaves a full one alone', () => {
    expect(withScheme(' ledgerly.example/app ')).toBe('https://ledgerly.example/app')
    expect(withScheme('http://localhost:3000')).toBe('http://localhost:3000')
    expect(withScheme('')).toBe('')
  })
})
