import { describe, expect, it } from 'vitest'
import {
  emptySponsorProfile,
  fitSponsorProfile,
  isWebUrl,
  profileSearchTerms,
  sponsorProblems,
  sponsorProfileOfText,
  sponsorProfileText,
  withScheme,
  type SponsorFields,
  type SponsorProfile,
} from './workspace'

const FIELDS: SponsorFields = {
  sponsorName: 'Acme',
  sponsorUrl: 'https://acme.example',
  sponsorPitch: 'Invoices that chase themselves until they are paid.',
  sponsorProfile: emptySponsorProfile(),
}

const PROFILE: SponsorProfile = {
  competitors: ['FreshBooks', 'Xero'],
  searchTerms: ['invoice reminders', 'late payment'],
}

describe('sponsorProblems', () => {
  it('takes a product with a name, a website and a one-sentence pitch', () => {
    expect(sponsorProblems(FIELDS)).toEqual([])
  })

  it('names every problem in form order', () => {
    expect(sponsorProblems({ ...FIELDS, sponsorName: ' ', sponsorUrl: 'acme.example', sponsorPitch: 'Invoices' })).toEqual([
      { field: 'sponsorName', message: 'Name the product.' },
      { field: 'sponsorUrl', message: 'The website must be a full address, such as https://example.com.' },
      { field: 'sponsorPitch', message: 'Say what the product does in a sentence of at least 20 characters.' },
    ])
    expect(sponsorProblems({ ...FIELDS, sponsorPitch: 'a'.repeat(201) })).toEqual([
      { field: 'sponsorPitch', message: 'Keep what the product does to 200 characters.' },
    ])
  })
})

describe("the sponsor's profile", () => {
  it('takes a profile within its limits, and an empty one', () => {
    expect(sponsorProblems({ ...FIELDS, sponsorProfile: PROFILE })).toEqual([])
  })

  it('names a list that is too long, an entry that is, and the sponsor among its own competitors', () => {
    const sponsorProfile = {
      competitors: ['acme', 'B', 'C', 'D', 'E', 'F', 'G'],
      searchTerms: ['x'.repeat(41)],
    }
    expect(sponsorProblems({ ...FIELDS, sponsorProfile })).toEqual([
      { field: 'competitors', message: 'Keep to 6 competitors.' },
      { field: 'searchTerms', message: 'Keep each search term to 40 characters.' },
      { field: 'competitors', message: 'A competitor is another product: take Acme out.' },
    ])
  })

  it('reads what the operator typed: commas between the entries, one said twice once', () => {
    const profile = sponsorProfileOfText({ competitors: ' FreshBooks, xero ,,Xero', searchTerms: 'late   payment' })
    expect(profile).toEqual({ competitors: ['FreshBooks', 'xero'], searchTerms: ['late payment'] })
    expect(sponsorProfileOfText(sponsorProfileText(profile))).toEqual(profile)
  })

  it('makes a proposal fit: the sponsor out of its competitors, an entry too long dropped, each list cut to its count', () => {
    const proposed = {
      competitors: ['Acme', 'FreshBooks', 'Xero', 'Wave', 'Zoho', 'Sage', 'Bonsai', 'Harvest'],
      searchTerms: ['invoicing', 'z'.repeat(41)],
    }
    expect(fitSponsorProfile(proposed, 'acme')).toEqual({
      competitors: ['FreshBooks', 'Xero', 'Wave', 'Zoho', 'Sage', 'Bonsai'],
      searchTerms: ['invoicing'],
    })
  })

  it('searches for the terms, then the competitors, and for nothing where the profile is empty', () => {
    expect(profileSearchTerms({ ...PROFILE, searchTerms: ['invoice reminders', 'xero'] })).toEqual([
      'invoice reminders',
      'xero',
      'FreshBooks',
    ])
    expect(profileSearchTerms(emptySponsorProfile())).toEqual([])
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
