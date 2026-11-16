import { afterEach, describe, expect, it, vi } from 'vitest'
import { httpSite, pageText } from './http'

const PAGE = `<!doctype html><html><head>
<title>Ledgerly &amp; receipts</title>
<meta content="Bookkeeping for freelancers." name="description">
<style>body { color: red }</style>
</head><body>
<script>window.app = { secret: 1 }</script>
<!-- build 42 -->
<h1>Receipts, sorted</h1>
<p>Snap a receipt and <a href="/how">Ledgerly files it</a>.</p>
<svg><path d="M0 0"/></svg>
</body></html>`

function stubPage(body: string, init: ResponseInit = { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(body, init))
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('pageText', () => {
  it('keeps the title, the description and what a visitor reads, without scripts, styles, pictures or comments', () => {
    expect(pageText(PAGE)).toBe(
      'Title: Ledgerly & receipts\n\nDescription: Bookkeeping for freelancers.\n\nReceipts, sorted\n\nSnap a receipt and Ledgerly files it.'
    )
  })
})

describe("the sponsor's website", () => {
  it('is read as its text', async () => {
    stubPage(PAGE.replace('</body>', `<p>${'Every receipt lands in the right category. '.repeat(6)}</p></body>`))
    const site = await httpSite.read('https://ledgerly.example')
    if (!site.read) throw new Error(`the page was not read: ${site.why}`)
    expect(site.text).toContain('Receipts, sorted')
    expect(site.text).not.toContain('secret')
  })

  it('says why a page was not read: an error, something other than a page, an empty shell, or no answer', async () => {
    stubPage('Forbidden', { status: 403, headers: { 'content-type': 'text/html' } })
    expect(await httpSite.read('https://ledgerly.example')).toEqual({ read: false, why: 'it answered 403' })
    stubPage('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    expect(await httpSite.read('https://ledgerly.example')).toEqual({ read: false, why: 'it is not a web page' })
    stubPage('<html><head><title>App</title></head><body><div id="root"></div><script src="/app.js"></script></body></html>')
    expect(await httpSite.read('https://ledgerly.example')).toEqual({ read: false, why: 'it shows almost no text without JavaScript' })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed')
      })
    )
    expect(await httpSite.read('https://ledgerly.example')).toEqual({ read: false, why: 'it could not be reached' })
  })
})
