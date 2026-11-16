import type { SiteProvider } from './types'

/** A page that says only where it is: the mock proposal is made from the name and the pitch. */
export const mockSite: SiteProvider = {
  name: 'mock',
  async read(url) {
    return { read: true, text: `Title: ${new URL(url).hostname}` }
  },
}
