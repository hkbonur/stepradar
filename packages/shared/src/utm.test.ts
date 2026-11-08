import { describe, expect, it } from 'vitest'
import { buildAttributedUrl, makeSlug, slugify } from './utm'

describe('buildAttributedUrl', () => {
  it('names the account, its place, the post and the variant', () => {
    const url = new URL(
      buildAttributedUrl('https://formstep.io/?ref=x', {
        accountHandle: 'automation.ada',
        medium: 'x',
        postSlug: 'n8n-webhook-retries',
        variantKey: 'wrong',
      })
    )
    expect(url.searchParams.get('ref')).toBe('x')
    expect(url.searchParams.get('utm_source')).toBe('automation.ada')
    expect(url.searchParams.get('utm_medium')).toBe('x')
    expect(url.searchParams.get('utm_campaign')).toBe('n8n-webhook-retries')
    expect(url.searchParams.get('utm_content')).toBe('wrong')
  })
})

describe('slugs', () => {
  it('is deterministic for one seed', () => {
    expect(makeSlug(8, 42)).toBe(makeSlug(8, 42))
    expect(makeSlug(8, 42)).not.toBe(makeSlug(8, 43))
  })
  it('slugifies titles', () => {
    expect(slugify('Set up n8n webhooks: retries & backoff!')).toBe('set-up-n8n-webhooks-retries-backoff')
  })
})
