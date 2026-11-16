import { htmlText } from '../html'
import type { SiteProvider, SiteRead } from './types'

/** How long the website has to answer. */
const TIMEOUT_MS = 10_000

/** How much of the page is read: a landing page says what the product is well before this. */
const HTML_MAX = 500_000

/** How much of the page's text the proposal reads. */
const TEXT_MAX = 6_000

/** Under this many characters a page said nothing to a visitor without JavaScript: an app's empty shell. */
const TEXT_MIN = 200

/**
 * The page at the address, fetched once like any visitor without JavaScript.
 * A page that does not answer, answers with an error or with something other
 * than HTML, or shows almost no text is not read, and says why: the profile
 * is then proposed from the name and the pitch alone, and the form says so.
 */
export const httpSite: SiteProvider = {
  name: 'http',
  async read(url): Promise<SiteRead> {
    let response: Response
    try {
      response = await fetch(url, { headers: { accept: 'text/html' }, signal: AbortSignal.timeout(TIMEOUT_MS) })
    } catch (caught) {
      const timedOut = caught instanceof Error && caught.name === 'TimeoutError'
      return { read: false, why: timedOut ? `it did not answer within ${TIMEOUT_MS / 1000} seconds` : 'it could not be reached' }
    }
    if (!response.ok) return { read: false, why: `it answered ${response.status}` }
    const type = response.headers.get('content-type') ?? ''
    if (!type.includes('html')) return { read: false, why: 'it is not a web page' }
    const text = pageText(await bodyStart(response, HTML_MAX))
    if (text.length < TEXT_MIN) return { read: false, why: 'it shows almost no text without JavaScript' }
    return { read: true, text: text.slice(0, TEXT_MAX) }
  },
}

/** The start of the answer's body, read no further than `max` characters. */
async function bodyStart(response: Response, max: number): Promise<string> {
  if (response.body === null) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  while (text.length < max) {
    const { done, value } = await reader.read()
    if (done) break
    text += decoder.decode(value, { stream: true })
  }
  await reader.cancel()
  return text.slice(0, max)
}

const HIDDEN = /<(script|style|noscript|svg|template|iframe)\b[^>]*>[\s\S]*?<\/\1>/gi

/** A page's title, its description and the text of its body, without what a visitor never reads: scripts, styles, pictures and comments. */
export function pageText(html: string): string {
  const title = htmlText(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '')
  const description = htmlText(metaDescription(html))
  const bodyAt = html.search(/<body\b/i)
  const body = htmlText(
    (bodyAt === -1 ? html.replace(/<head\b[\s\S]*?<\/head>/i, '') : html.slice(bodyAt)).replace(/<!--[\s\S]*?-->/g, '').replace(HIDDEN, '')
  ).replace(/[ \t]{2,}/g, ' ')
  return [title && `Title: ${title}`, description && `Description: ${description}`, body].filter(Boolean).join('\n\n')
}

/** The content of the page's description tag, whichever way round its attributes are written. */
function metaDescription(html: string): string {
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    if (!/\b(?:name|property)=["'](?:description|og:description)["']/i.test(tag)) continue
    const content = /\bcontent=(?:"([^"]*)"|'([^']*)')/i.exec(tag)
    if (content) return content[1] ?? content[2] ?? ''
  }
  return ''
}
