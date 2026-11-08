import type { ImportedPost } from './history'

/**
 * How a post or a reply went out: the operator said they posted it, with no
 * link; gave its link; or the match found it among the account's own items
 * (CONTEXT.md, "Match"), at the platform's time, id and link. `at` is when it
 * went out. `editShare` is how much of the draft the operator changed, 0 to
 * 1, on X and LinkedIn only (shared `editShareOf`); it stays when the match
 * finds an item the operator had already marked posted. When the match found
 * it is not kept: a found one is matched, and the match looks for no other.
 */
export type Posted =
  | { kind: 'said'; at: number; editShare?: number }
  | { kind: 'linked'; at: number; url: string; externalId: string; editShare?: number }
  | { kind: 'found'; at: number; url?: string; externalId: string; editShare?: number }

/** What went out where its platform names it: linked by the operator, or found by the match. */
export type PostedItem = Exclude<Posted, { kind: 'said' }>

/** What the operator's word that they posted a draft writes: with the link they gave (shared `parsePostedLink`), or without. */
export function saidPosted(at: number, link: { url: string; externalId: string } | null, editShare: number | null): Posted {
  const share = editShare === null ? {} : { editShare }
  return link === null ? { kind: 'said', at, ...share } : { kind: 'linked', at, ...link, ...share }
}

/** What the match writes on what it found: the item's time, id and link, with the edit share decided for it. */
export function foundPosted(item: ImportedPost, editShare: number | null): Posted {
  return {
    kind: 'found',
    at: item.postedAt,
    externalId: item.externalId,
    ...(item.url === null ? {} : { url: item.url }),
    ...(editShare === null ? {} : { editShare }),
  }
}

/** What went out, where its platform names it; null before it went out, or when the operator said so without a link, so nothing can read it. */
export function postedItemOf(posted: Posted | undefined): PostedItem | null {
  if (posted === undefined || posted.kind === 'said') return null
  return posted
}

/** When a post or a reply went out; one at posted or measured without `posted` is a bug. */
export function wentOutAt(row: { _id: string; posted?: Posted }): number {
  if (row.posted === undefined) throw new Error(`${row._id} went out, but says nothing of when`)
  return row.posted.at
}
