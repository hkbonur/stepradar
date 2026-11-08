import { PLATFORM_IN_WORDS, type Platform } from './platforms'
import { X_POST_LIMIT, platformLength } from './posts'

/**
 * Replies: an account also grows by answering other people. The listener
 * finds threads worth answering on the account's platform, the writer drafts
 * a reply in the platform's shape or passes on the thread within the
 * account's daily reply budget, and the operator posts the reply by hand and
 * says so. Influstep never posts, likes, votes or follows (ADR 0004).
 */

/**
 * Where the thread a reply answers came from: a post that mentions the
 * account, a comment under one of its own posts, a thread in its pillars the
 * listener found by searching, or a thread the operator pasted where no
 * reader searches.
 */
export const REPLY_ORIGINS = ['mention', 'comment', 'search', 'pasted'] as const
export type ReplyOrigin = (typeof REPLY_ORIGINS)[number]

export const REPLY_ORIGIN_LABELS: Record<ReplyOrigin, string> = {
  mention: 'Mentioned the account',
  comment: 'Answered its post',
  search: 'Found by the listener',
  pasted: 'Pasted by you',
}

/**
 * Heard: found, not written yet. Draft: written, waiting for the operator to
 * post it. Posted: the operator posted it and said so. Measured: its
 * measurement window closed. Skipped: the writer, a rule, the sponsor
 * filter or the operator passed on it, or the draft went stale.
 */
export const REPLY_STATUSES = ['heard', 'draft', 'posted', 'measured', 'skipped'] as const
export type ReplyStatus = (typeof REPLY_STATUSES)[number]

export const REPLY_STATUS_LABELS: Record<ReplyStatus, string> = {
  heard: 'Being written',
  draft: 'Waiting for you',
  posted: 'Posted',
  measured: 'Measured',
  skipped: 'Skipped',
}

interface ReplyEventRule {
  from: readonly ReplyStatus[]
  to: ReplyStatus
  /** What the operator reads when the event comes from another status. An agent's events have none: that would be a bug. */
  refusal?: (at: string) => string
}

/**
 * What can happen to a reply, from which statuses, and where it goes: the
 * one table core/replies.ts `moveReply` moves a reply by. `at` is the
 * status's label in lower case.
 */
export const REPLY_EVENTS = {
  written: { from: ['heard'], to: 'draft' },
  passed: { from: ['heard'], to: 'skipped' },
  stale: { from: ['heard', 'draft'], to: 'skipped' },
  posted: { from: ['draft'], to: 'posted', refusal: (at) => `This reply is ${at}; only a reply waiting for you can be marked posted.` },
  skipped: { from: ['draft'], to: 'skipped', refusal: (at) => `This reply is ${at}; only one waiting for you can be skipped.` },
  asked: { from: ['skipped'], to: 'heard', refusal: () => 'Only a post the account passed on can be asked for again.' },
  measured: { from: ['posted'], to: 'measured' },
  // The match found it among the account's own items: a draft goes out, a reply marked posted gets the platform's words.
  matched: { from: ['draft', 'posted'], to: 'posted' },
} as const satisfies Record<string, ReplyEventRule>

export type ReplyEventType = keyof typeof REPLY_EVENTS

export function canApplyReply(status: ReplyStatus, event: ReplyEventType): boolean {
  const from: readonly ReplyStatus[] = REPLY_EVENTS[event].from
  return from.includes(status)
}

/** How many reply drafts the writer prepares for an account a day. Zero turns listening off. */
export const REPLIES_PER_DAY_MIN = 0
export const REPLIES_PER_DAY_MAX = 20
export const REPLIES_PER_DAY_DEFAULT = 5

/** On X, a found post needs an author with this many followers: a reply under a post nobody reads brings nobody back. */
export const REPLY_REACH_MIN = 1000

/** Under the standout reply target, a found post's author on X has fewer followers than this, where a reply stands out. */
export const REPLY_PEER_MAX = 10_000

/** Under the standout reply target, a thread on Reddit or Hacker News is younger than this when heard, with at most STANDOUT_COMMENTS_MAX comments. */
export const STANDOUT_AGE_MS = 2 * 3_600_000
export const STANDOUT_COMMENTS_MAX = 5

const HOUR_MS = 3_600_000

/**
 * A found thread is rising when it is younger than RISING_AGE_MS and drew at
 * least RISING_COMMENTS_MIN comments, at RISING_COMMENTS_PER_HOUR an hour or
 * more: a reply now lands while people still read it, so the operator is
 * told at once. Its age counts at least RISING_AGE_FLOOR_MS, so a thread
 * heard a minute after it went up needs more than a handful of comments.
 */
export const RISING_AGE_MS = 2 * HOUR_MS
export const RISING_COMMENTS_MIN = 5
export const RISING_COMMENTS_PER_HOUR = 10
const RISING_AGE_FLOOR_MS = 10 * 60_000

/** A rising thread's read: its comments, how many minutes it took, and the rate the rule reads. */
export interface RisingRead {
  comments: number
  minutes: number
  perHour: number
}

/** The thread's read when it is rising, null when it is not. */
export function risingRead(thread: { postedAt: number; comments: number | null }, now: number): RisingRead | null {
  if (thread.comments === null || thread.comments < RISING_COMMENTS_MIN) return null
  const age = now - thread.postedAt
  if (age >= RISING_AGE_MS) return null
  const perHour = thread.comments / (Math.max(age, RISING_AGE_FLOOR_MS) / HOUR_MS)
  if (perHour < RISING_COMMENTS_PER_HOUR) return null
  return { comments: thread.comments, minutes: Math.max(1, Math.round(age / 60_000)), perHour }
}

/**
 * How old a thread may be to still get an answer: a found thread goes cold
 * within the day, a mention or a comment keeps two, and a thread the operator
 * pasted is answered however old it is.
 */
export const REPLY_FRESH_MS = {
  mention: 48 * HOUR_MS,
  comment: 48 * HOUR_MS,
  search: 12 * HOUR_MS,
  pasted: null,
} as const satisfies Record<ReplyOrigin, number | null>

/**
 * Written first and outside the day's reply budget: what the operator asked
 * for, and an answer to a comment or a mention, a conversation the account
 * is already in.
 */
export function answersFirst(reply: { operatorAsked: boolean; origin: ReplyOrigin }): boolean {
  return reply.operatorAsked || reply.origin === 'comment' || reply.origin === 'mention'
}

/**
 * How much a waiting draft deserves the operator's next minute, from 0 to 1:
 * the classifier's score, weighed by how much of the thread's freshness is
 * left (REPLY_FRESH_MS). A pasted thread, which goes cold on nobody's clock,
 * keeps its whole score.
 */
export function draftRank(reply: { origin: ReplyOrigin; fit: HeardFit; thread: { postedAt: number | null } }, now: number): number {
  const fresh = REPLY_FRESH_MS[reply.origin]
  if (fresh === null || reply.thread.postedAt === null) return reply.fit.score
  return reply.fit.score * Math.max(0, 1 - (now - reply.thread.postedAt) / fresh)
}

/** A draft nobody posted within a day answers a conversation that moved on, so it is skipped as stale. */
export const DRAFT_STALE_MS = 24 * HOUR_MS

/**
 * How far back the match reads the account's posts, which is also how long
 * a draft the operator opened waits before it asks for its link: a comment
 * from it would have been found by then.
 */
export const MATCH_WINDOW_MS = 48 * HOUR_MS

/** A draft the operator opened may be out already, so it waits this long before it goes stale, asking for its link. */
export const OPENED_DRAFT_STALE_MS = 7 * 24 * HOUR_MS

type WaitingTimes = { heardAt: number; writtenAt?: number; openedAt?: number }

/**
 * When a reply that waits goes stale: OPENED_DRAFT_STALE_MS after the
 * operator last opened it, else DRAFT_STALE_MS after it was written, or
 * heard when it was not written yet.
 */
export function staleAt(reply: WaitingTimes): number {
  if (reply.openedAt !== undefined) return reply.openedAt + OPENED_DRAFT_STALE_MS
  return (reply.writtenAt ?? reply.heardAt) + DRAFT_STALE_MS
}

/** Whether a waiting draft asks the operator for its link: they opened it more than MATCH_WINDOW_MS ago and it is still not found. */
export function asksForLink(reply: { status: ReplyStatus } & WaitingTimes, now: number): boolean {
  if (reply.status !== 'draft' || reply.openedAt === undefined) return false
  return now - reply.openedAt > MATCH_WINDOW_MS
}

/** The thread a reply answers, as the reply keeps it: what was said, by whom, where and with what reach. */
export interface ReplyThread {
  url: string
  /** A Reddit or Hacker News thread's title; null on X, where a post has none. */
  title: string | null
  text: string
  /** When it was posted; null on a pasted thread, whose link does not say. */
  postedAt: number | null
  /** Who wrote it; null where the platform or the pasted link does not say. */
  author: { handle: string; name: string } | null
  /**
   * How far it reaches: its author's followers on X, its score on Reddit, its
   * points on Hacker News; null where nothing read it (a pasted thread, a
   * Reddit mention).
   */
  reach: number | null
  /** Where it was said: a subreddit or Hacker News; null on X, which has none. */
  community: string | null
}

/** A thread the listener heard, as the account's platform reader returns it: a reader always says when and by whom. */
export interface HeardThread extends ReplyThread {
  postedAt: number
  author: { handle: string; name: string }
  origin: ReplyOrigin
  /** The platform's id of the post or comment the reply answers. */
  externalId: string
  /** The pillar a search matched it on; null for a mention, a comment or a paste. */
  pillar: string | null
  /** The comments under it when heard, where the search says; null for a mention, a comment or a paste. */
  comments: number | null
}

/** What a thread's reach counts on each platform, as the replies page names it. */
export const REACH_LABELS: Record<Platform, string> = {
  reddit: 'points',
  hackernews: 'points',
  x: 'followers',
  linkedin: 'followers',
  forum: 'likes',
}

/**
 * What becomes of a heard post: kept for the writer, dropped unseen (too old,
 * too little reach, already answered, the account's own), or kept as skipped
 * with the reason the operator reads (it names the sponsor).
 */
export type HeardVerdict = { kind: 'keep' } | { kind: 'drop'; reason: string } | { kind: 'skip'; reason: string }

/** What the author of a heard post wants, as the classifier reads it. */
export const HEARD_INTENTS = ['question', 'recommendation', 'complaint', 'discussion', 'other'] as const
export type HeardIntent = (typeof HEARD_INTENTS)[number]

/**
 * The classifier's read of a heard post (docs/plan.md, slice 3): whether it
 * is about the account's niche at all, what its author wants, whether the
 * account has something worth saying back, how good a fit it is to answer
 * (0 to 1) and how sure the classifier is (0 to 1), with its reason in a
 * few words.
 */
export interface HeardFit {
  relevant: boolean
  intent: HeardIntent
  replyWorthy: boolean
  score: number
  confidence: number
  reason: string
}

/**
 * A post the rules keep stays kept only when the classifier finds it on the
 * account's topic and worth an answer; otherwise it is dropped unseen, with
 * the classifier's reason.
 */
export function fitVerdict(fit: HeardFit): HeardVerdict {
  if (!fit.relevant) return { kind: 'drop', reason: `off topic: ${fit.reason}` }
  if (!fit.replyWorthy) return { kind: 'drop', reason: `nothing worth saying back: ${fit.reason}` }
  return { kind: 'keep' }
}

export function heardVerdict(
  post: HeardThread,
  context: { platform: Platform; accountHandle: string; sponsorName: string; answered: ReadonlySet<string>; now: number }
): HeardVerdict {
  if (sameHandle(post.author.handle, context.accountHandle)) return { kind: 'drop', reason: 'the account wrote it' }
  if (context.answered.has(post.externalId)) return { kind: 'drop', reason: 'already answered or passed on' }
  const fresh = REPLY_FRESH_MS[post.origin]
  if (fresh !== null && context.now - post.postedAt > fresh) return { kind: 'drop', reason: 'too old to answer' }
  if (fewFollowers(post, context.platform)) return { kind: 'drop', reason: `fewer than ${REPLY_REACH_MIN} followers` }
  // Someone asking the account about its sponsor is answered under the ground rules; a stranger's thread naming it waits for the operator.
  if (post.origin === 'search' && namesSponsor(post.text, context.sponsorName))
    return { kind: 'skip', reason: `It names ${context.sponsorName}; the account answers about its sponsor only when you ask.` }
  return { kind: 'keep' }
}

/** A found post on X whose author has fewer than REPLY_REACH_MIN followers. Reach means followers on X only; a thread's score elsewhere is no author's audience (docs/plan.md, slice 10). */
function fewFollowers(post: HeardThread, platform: Platform): boolean {
  if (post.origin !== 'search' || platform !== 'x' || post.reach === null) return false
  return post.reach < REPLY_REACH_MIN
}

/** Largest reach first; a thread whose reach is unknown last. */
export function byReach(a: ReplyThread, b: ReplyThread): number {
  return (b.reach ?? -1) - (a.reach ?? -1)
}

/** Whether two handles are one account's: case and a leading @ aside. */
export function sameHandle(a: string, b: string): boolean {
  return a.replace(/^@/, '').toLowerCase() === b.replace(/^@/, '').toLowerCase()
}

/** Whether the text names the sponsor as a word, in any case ("acme", "Acme's"). */
export function namesSponsor(text: string, sponsorName: string): boolean {
  const name = sponsorName.trim().toLowerCase()
  if (name === '') return false
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, 'i').test(text)
}

const LINK = /https?:\/\/|www\./i

/**
 * What a reply draft is on each platform (docs/plan.md, ground rule 6): ready
 * to post on X and LinkedIn; on Reddit and on a forum a full reply the
 * operator rewrites in their own words, since many subreddits and forums
 * remove machine-written text; on
 * Hacker News talking points and facts to cite, since its moderators remove
 * generated comments and the operator writes the comment.
 */
export const DRAFT_SHAPES = ['text', 'rewrite', 'points'] as const
export type DraftShape = (typeof DRAFT_SHAPES)[number]

export const PLATFORM_DRAFT_SHAPES: Record<Platform, DraftShape> = {
  reddit: 'rewrite',
  hackernews: 'points',
  x: 'text',
  linkedin: 'text',
  forum: 'rewrite',
}

/** At most this many talking points in a Hacker News draft, one per line beginning "- ". */
export const TALKING_POINTS_MAX = 3

/** Rule 6 beyond the length: a Hacker News draft is at most TALKING_POINTS_MAX talking points, one per line beginning "- ". */
export function pointsProblems(text: string): string[] {
  const points = text.split('\n').filter((line) => line.trim().startsWith('- '))
  if (points.length === 0) return ['Write the talking points, one per line beginning "- ".']
  if (points.length > TALKING_POINTS_MAX) return [`At most ${TALKING_POINTS_MAX} talking points; this draft has ${points.length}.`]
  return []
}

/** The longest reply each platform takes, counted the way it counts: X weighs links and wide characters (shared `xLength`). */
export const REPLY_LIMITS: Record<Platform, number> = {
  reddit: 10_000,
  hackernews: 4_000,
  x: X_POST_LIMIT,
  linkedin: 1_250,
  forum: 32_000,
}

/**
 * Why a reply cannot go out on its platform as written: empty, longer than
 * the platform takes, or a link on X, where a reply that links reads as spam
 * and is ranked down. Empty when it can. The sponsor's rules are core
 * disclosure's.
 */
export function replyProblems(text: string, platform: Platform): string[] {
  const problems: string[] = []
  const trimmed = text.trim()
  if (trimmed === '') return ['Write the reply.']
  const length = platformLength(trimmed, platform)
  const limit = REPLY_LIMITS[platform]
  if (length > limit) problems.push(`A reply on ${PLATFORM_IN_WORDS[platform]} is at most ${limit} characters; this one is ${length}.`)
  if (platform === 'x' && LINK.test(trimmed)) problems.push('Leave links out of a reply on X.')
  return problems
}

/** How many more reply drafts the budget allows today. */
export function repliesLeft(budget: number, draftedToday: number): number {
  return Math.max(0, budget - draftedToday)
}

/**
 * A rule about whom or what the account answers ("never reply to politics",
 * "only reply to people building agents", "don't answer anyone selling
 * courses"). The chat stores one as a rule in memory with or without
 * "remember" (shared `parseChatIntent`), and the writer reads it before every
 * reply.
 */
export const REPLY_RULE = /^(?:never|don't|do not|dont|no|stop|only)\s+(?:reply|replies|replying|answer|answering)\b/i

const REPLY_RULE_SUBJECT =
  /^(never|don't|do not|dont|no|stop|only)\s+(?:reply|replies|replying|answer|answering)(?:\s+(?:to|under))?\s+(?:posts?\s+(?:about|on|from)\s+|anything\s+(?:about|on)\s+|anyone\s+|people\s+|someone\s+)?(.+?)[.!]*$/i

/** Words that say who or what in any rule, so they never decide whether a post is covered. */
const GENERIC_WORDS: ReadonlySet<string> = new Set([
  'about',
  'anyone',
  'anything',
  'folks',
  'people',
  'post',
  'posts',
  'someone',
  'that',
  'their',
  'them',
  'they',
  'those',
  'what',
  'which',
  'with',
  'who',
])

/**
 * What a reply rule covers, read word for word: "never" rules pass on a post
 * that holds one of the subject's words, "only" rules pass on a post that
 * holds none. A plural loses its "s", so "agents" covers "agent". Null when
 * the sentence is no reply rule. The mock writer reads rules this way; the
 * real writer reads them as sentences.
 */
export function replyRuleOf(rule: string): { kind: 'never' | 'only'; words: string[] } | null {
  const match = REPLY_RULE_SUBJECT.exec(rule.trim())
  if (!match?.[1] || !match[2]) return null
  const words = match[2]
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 4 && !GENERIC_WORDS.has(word))
    .map((word) => (word.length > 4 && word.endsWith('s') ? word.slice(0, -1) : word))
  if (words.length === 0) return null
  return { kind: match[1].toLowerCase() === 'only' ? 'only' : 'never', words }
}

/** Whether a reply rule tells the account to pass on this post. */
export function replyRuleCovers(rule: string, postText: string): boolean {
  const read = replyRuleOf(rule)
  if (!read) return false
  const text = postText.toLowerCase()
  const holds = read.words.some((word) => text.includes(word))
  return read.kind === 'never' ? holds : !holds
}
