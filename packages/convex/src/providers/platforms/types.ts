import {
  type AccountReach,
  type HeardThread,
  type ImportedPost,
  type ItemCounts,
  type Platform,
  type ReplyThread,
  type SignalSource,
  placeLabel,
  type PlatformPlace,
} from '@influstep/shared'

/** One item a search found, as the researcher stores it: a signal. */
export interface FoundSignal {
  source: SignalSource
  externalId: string
  title: string
  url: string
  summary: string
  score: number
  topics: string[]
  /**
   * When the source says the item was posted, in ms. Freshness decays from
   * it (shared `signalFreshness`); without it, from when it was found.
   */
  publishedAt?: number
}

/** What a search looks for: the account's pillars (and its niche, for the researcher), nothing older than `since`. */
export interface SearchQuery {
  terms: string[]
  since: number
  limit: number
  /** Where to look: the account's communities, or everywhere when null. */
  communities: string[] | null
  /** The sponsor's name: people ask about it too, and a search hears them. */
  sponsorName: string
}

/** A thread a search found: what it said and where, how many answered it, and what it is about. */
export interface FoundThread extends ReplyThread {
  postedAt: number
  author: { handle: string; name: string }
  reach: number
  /** The platform's id of the post: a fullname (t3_…) on Reddit, an item id on Hacker News. */
  externalId: string
  comments: number
  /** What it is about: the query's terms that found it, the first of them a pillar when the listener asked. */
  topics: string[]
}

/** A thread that names the account, heard to be answered. */
export type HeardMention = HeardThread & { origin: 'mention' }

/** Whose mentions to hear, and since when. */
export interface MentionsQuery {
  handle: string
  since: number
}

/** Whose own posts to read: the account, and the instant its newest post is dated just before. */
export interface ActivityQuery {
  handle: string
  /** Only what was posted since: the match reads the window it matches in, the history import everything (0). */
  since: number
  niche: string
  pillars: string[]
  now: number
}

/**
 * Which of the account's items to read the comments under, by the platform's
 * ids, since when, and the ids of the comments already read, which a reader
 * that fetches comment by comment (Hacker News) skips.
 */
export interface CommentsQuery {
  items: string[]
  since: number
  known: ReadonlySet<string>
}

/** Someone's comment under one of the account's posts or replies. */
export interface PlatformComment {
  externalId: string
  /** The account's item it answers, by the platform's id. */
  parentId: string
  author: { handle: string; name: string }
  text: string
  url: string
  /** Where it was said: a subreddit, or Hacker News; null where the platform has none. */
  community: string | null
  /** Its score where the platform shows one; 0 where it shows none (Hacker News, Reddit's inbox). */
  likes: number
  at: number
}

/** One of the account's posted items whose numbers are read: its id on the platform, whether it is a post or a reply, and when it went out. */
export interface CountsQuery {
  externalId: string
  kind: 'post' | 'reply'
  postedAt: number
}

/**
 * An item as its reader read it: its numbers, or that its community's
 * moderators removed it. An item the platform no longer shows at all, or its
 * author deleted, is left out of a read: that is no removal.
 */
export type CountedItem = { externalId: string; counts: ItemCounts } | { externalId: string; removed: true }

/**
 * The provider for one platform, read only (CONTEXT.md, "Platform reader"):
 * nothing here posts, likes, votes or follows (ADR 0004). Each capability is
 * a method the reader has or lacks, and what it lacks is a manual step the
 * operator sees, never mock data.
 */
export interface PlatformReader {
  readonly platform: Platform
  readonly name: string
  /** Threads about the terms: what the listener answers and the researcher learns from. */
  readonly search?: (query: SearchQuery) => Promise<FoundThread[]>
  /** What is said to the account: posts that mention it and comments under its posts, newest first. */
  readonly mentions?: (query: MentionsQuery) => Promise<HeardMention[]>
  /** The account's own posts, newest first, a thread folded into its root as shared `parseXArchive` does: the history import. */
  readonly activity?: (query: ActivityQuery) => Promise<ImportedPost[]>
  /**
   * The comments under the account's items since a time: under each item
   * asked for (Hacker News), or every answer in the account's inbox (Reddit).
   */
  readonly comments?: (query: CommentsQuery) => Promise<PlatformComment[]>
  /** What the account's posted items brought back so far; an item the platform no longer shows is left out. */
  readonly counts?: (items: readonly CountsQuery[]) => Promise<CountedItem[]>
  /** The account's reach: its karma or its followers. */
  readonly account?: (handle: string) => Promise<AccountReach>
  /** A community's rules, as text the classifier reads. */
  readonly rules?: (community: string) => Promise<string>
  /**
   * Where a thread was said, by the platform's id, for a pasted link that
   * does not say: a forum's links name no category. Null where the thread
   * is in none.
   */
  readonly community?: (externalId: string) => Promise<string | null>
}

/** Every capability a reader may have, in the order of the contract above. */
export const READER_CAPABILITIES = [
  'search',
  'mentions',
  'activity',
  'comments',
  'counts',
  'account',
  'rules',
  'community',
] as const satisfies readonly (keyof PlatformReader)[]

export type ReaderCapability = (typeof READER_CAPABILITIES)[number]

/** What a reader reads an account with once the operator connected it (core/connections.ts): the grant to refresh. */
export interface ReaderConnection {
  refreshToken: string
}

/**
 * The platform no longer accepts the account's grant: the operator revoked
 * it, or it lapsed. The caller stores the connection as revoked, so the
 * checklist asks to connect again (internal/connections.ts `readingAs`).
 */
export class ConnectionRevoked extends Error {}

/** What each capability reads, as a refusal names it. */
const CAPABILITY_WORDS: Record<ReaderCapability, string> = {
  search: 'threads to answer or learn from',
  mentions: 'what is said to the account',
  activity: "the account's own posts",
  comments: 'the comments under a post',
  counts: "a posted item's numbers",
  account: "the account's karma or followers",
  rules: "a community's rules",
  community: 'where a thread was said',
}

/** The refusal for a step the account's platform reader cannot do: "Influstep cannot read the account's own posts on X yet." */
export function cannotRead(place: PlatformPlace, capability: ReaderCapability): string {
  return `Influstep cannot read ${CAPABILITY_WORDS[capability]} on ${placeLabel(place)} yet.`
}
