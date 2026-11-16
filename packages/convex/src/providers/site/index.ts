import { providersMode } from '../../lib/env'
import { httpSite } from './http'
import { mockSite } from './mock'
import type { SiteProvider } from './types'

/** The website itself in real mode: one request for the page the operator named, no key. */
export function siteProvider(): SiteProvider {
  return providersMode() === 'mock' ? mockSite : httpSite
}
