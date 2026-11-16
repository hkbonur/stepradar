import { describe, expect, it } from 'vitest'
import { htmlText } from './html'

describe('htmlText', () => {
  it('ends a line at a paragraph, a break or a list item, keeps a link’s text and decodes what a page escapes', () => {
    expect(htmlText('<p>Use the <a href="/t/x/1" class="mention">@kai</a> fix &amp; log</p><ul><li>once</li></ul>A<br>B &hellip;')).toBe(
      'Use the @kai fix & log\n\nonce\n\nA\nB …'
    )
  })
})
