const ENTITIES: Record<string, string> = {
  '&quot;': '"',
  '&#39;': "'",
  '&#x27;': "'",
  '&lt;': '<',
  '&gt;': '>',
  '&nbsp;': ' ',
  '&hellip;': '…',
  '&amp;': '&',
}

/**
 * HTML as the plain text a reader sees, for a Discourse post and a website's
 * page alike: a paragraph, a line break, a list item and a heading end a
 * line; a link keeps its text.
 */
export function htmlText(html: string): string {
  return html
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<\/(?:p|li|h\d|pre|blockquote|aside|div)>/g, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(?:quot|#39|#x27|lt|gt|nbsp|hellip|amp);/g, (entity) => ENTITIES[entity] ?? entity)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
