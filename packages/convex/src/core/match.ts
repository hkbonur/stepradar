import {
  MATCH_WINDOW_MS,
  POST_TITLE_MAX,
  itemTextOf,
  postHook,
  postedItemOf,
  sameThread,
  textSimilarity,
  type AccountPostSource,
  type ImportedPost,
  type Platform,
  type Posted,
} from '@influstep/shared'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { answerComments } from './comments'
import { sameCommunity } from './communities'
import { addDays, dayKey } from './dates'
import { insertAccountPosts } from './history'
import { matchPost } from './posts'
import { postedSince } from './posted'
import { matchReply, repliesWithStatus } from './replies'

/**
 * The match (docs/plan.md, "Match rules"): which of the account's own items,
 * as its platform reader lists them, a reply or a post came from. Drafts on
 * Reddit and Hacker News are meant to be rewritten, so a reply is found by
 * what it answers and when it went out; how alike the texts are only breaks
 * a tie. A post is found by where it went, its day and its title or first
 * line. An item a link already named goes to that reply or post, whatever
 * it says.
 */

/** A reply the match may find: a draft, or one the operator marked posted that no item was found for yet. */
export interface ReplyCandidate {
  id: Id<'replies'>
  /** The thread or comment it answers (the reply's `inReplyTo`). */
  inReplyTo: string
  writtenAt: number
  /** When the operator last copied it or opened its thread; null when never. */
  openedAt: number | null
  text: string
  /** The id the operator's link named, when they gave one. */
  externalId: string | null
}

/** A post the match may find: a draft, or one the operator marked posted that no item was found for yet. */
export interface PostCandidate {
  id: Id<'posts'>
  /** The id the operator's link named, when they gave one. */
  externalId: string | null
  /** Where it goes: a subreddit, or Hacker News's Ask, Show or front page; null on X and LinkedIn. */
  community: string | null
  plannedFor: string
  /** When the writer wrote it; null for a post written before the writer stamped it, which only its link finds. */
  writtenAt: number | null
  /** What an item's first line is compared with: its title where its platform posts one, else its hook. */
  line: string
}

/** How alike an item's first line and a post's line must be at the least: a post is the operator's own words, so the line is all there is to tell two posts of a day apart. */
export const POST_SIMILARITY_MIN = 0.25

export interface MatchOutcome {
  replies: { id: Id<'replies'>; item: ImportedPost }[]
  posts: { id: Id<'posts'>; item: ImportedPost }[]
}

/**
 * Matches the account's items to its replies and posts. An item whose id a
 * link named goes to that reply or post. A comment goes to a reply with the
 * same parent written before it, on a forum one in the same topic (shared
 * `sameThread`). A post of the account's own goes to a post
 * in the same community, planned for its day or the day before, written
 * before it went out, whose line is at least POST_SIMILARITY_MIN alike.
 * Where several pairs qualify, the closest texts pair first, then the draft
 * opened most recently, then the item posted first. Items whose ids are
 * `known` were found before and are left alone.
 */
export function matchItems(
  items: ImportedPost[],
  candidates: { replies: ReplyCandidate[]; posts: PostCandidate[] },
  context: { known: ReadonlySet<string>; timezone: string; platform: Platform }
): MatchOutcome {
  const byId = new Map(items.filter((item) => !context.known.has(item.externalId)).map((item) => [item.externalId, item]))
  const linkedReplies = linkedPairs(byId, candidates.replies)
  const linkedPosts = linkedPairs(byId, candidates.posts)
  const taken = new Set([...linkedReplies, ...linkedPosts].map((pair) => pair.item.externalId))
  const open = [...byId.values()].filter((item) => !taken.has(item.externalId))
  const replies = closestPairs(
    open.filter((item) => item.parentId !== null),
    candidates.replies.filter((reply) => reply.externalId === null),
    (item, reply) => replyQualifies(item, reply, context.platform),
    (item, reply) => ({ similarity: textSimilarity(itemTextOf(item), reply.text), openedAt: reply.openedAt })
  )
  const posts = closestPairs(
    open.filter((item) => item.parentId === null),
    candidates.posts.filter((post) => post.externalId === null),
    (item, post) => postQualifies(item, post, context.timezone),
    (item, post) => ({ similarity: textSimilarity(postHook(item.parts), post.line), openedAt: null })
  )
  return { replies: [...linkedReplies, ...replies], posts: [...linkedPosts, ...posts] }
}

/** The items a link named, each with the reply or post that gave it. */
function linkedPairs<I extends Id<'replies'> | Id<'posts'>>(
  items: ReadonlyMap<string, ImportedPost>,
  drafts: { id: I; externalId: string | null }[]
): { id: I; item: ImportedPost }[] {
  return drafts.flatMap((draft) => {
    const item = draft.externalId === null ? undefined : items.get(draft.externalId)
    return item === undefined ? [] : [{ id: draft.id, item }]
  })
}

/** A comment came from a reply that answers what it answers, in one thread (shared `sameThread`), and was written before it was posted. */
function replyQualifies(item: ImportedPost, reply: ReplyCandidate, platform: Platform): boolean {
  if (item.parentId === null || reply.writtenAt > item.postedAt) return false
  return sameThread(platform, item.parentId, reply.inReplyTo)
}

/**
 * A post of the account's own came from a post in the same community,
 * planned for its day or the day before (docs/plan.md: "the draft's day and
 * the day after"), written before it went out, whose line is close enough.
 */
function postQualifies(item: ImportedPost, post: PostCandidate, timezone: string): boolean {
  if (post.writtenAt === null || post.writtenAt > item.postedAt) return false
  if (!sameOptionalCommunity(item.community, post.community)) return false
  const day = dayKey(item.postedAt, timezone)
  if (day !== post.plannedFor && day !== addDays(post.plannedFor, 1)) return false
  return textSimilarity(postHook(item.parts), post.line) >= POST_SIMILARITY_MIN
}

/** Whether an item and a post were said in one place: both nowhere in particular, or in one community. */
function sameOptionalCommunity(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b
  return sameCommunity(a, b)
}

/**
 * Pairs items with drafts one to one among the pairs that qualify: the
 * closest texts first, then the draft opened most recently, then the item
 * posted first.
 */
function closestPairs<D extends { id: Id<'replies'> | Id<'posts'> }>(
  items: ImportedPost[],
  drafts: D[],
  qualifies: (item: ImportedPost, draft: D) => boolean,
  score: (item: ImportedPost, draft: D) => { similarity: number; openedAt: number | null }
): { id: D['id']; item: ImportedPost }[] {
  const pairs = items.flatMap((item) =>
    drafts.filter((draft) => qualifies(item, draft)).map((draft) => ({ item, draft, ...score(item, draft) }))
  )
  pairs.sort((a, b) => b.similarity - a.similarity || (b.openedAt ?? -1) - (a.openedAt ?? -1) || a.item.postedAt - b.item.postedAt)
  const usedItems = new Set<string>()
  const usedDrafts = new Set<string>()
  const chosen: { id: D['id']; item: ImportedPost }[] = []
  for (const { item, draft } of pairs) {
    if (usedItems.has(item.externalId) || usedDrafts.has(draft.id)) continue
    usedItems.add(item.externalId)
    usedDrafts.add(draft.id)
    chosen.push({ id: draft.id, item })
  }
  return chosen
}

type Reader = { db: QueryCtx['db'] }

/**
 * Whether the match has anything to look for on the account: a waiting reply
 * or post draft, a comment waiting for the operator's answer, or a reply or
 * post marked posted within MATCH_WINDOW_MS. Indexed reads of one row each,
 * since the schedule asks every ten minutes.
 */
export async function awaitsMatch(ctx: Reader, accountId: Id<'accounts'>, now: number): Promise<boolean> {
  const since = now - MATCH_WINDOW_MS
  const draft = await ctx.db
    .query('replies')
    .withIndex('by_account_status', (q) => q.eq('accountId', accountId).eq('status', 'draft'))
    .first()
  if (draft !== null) return true
  const postDraft = await ctx.db
    .query('posts')
    .withIndex('by_account_status', (q) => q.eq('accountId', accountId).eq('status', 'draft'))
    .first()
  if (postDraft !== null) return true
  const comment = await ctx.db
    .query('comments')
    .withIndex('by_account_status', (q) => q.eq('accountId', accountId).eq('status', 'new'))
    .first()
  if (comment !== null) return true
  const reply = await ctx.db
    .query('replies')
    .withIndex('by_account_posted', (q) => q.eq('accountId', accountId).gte('posted.at', since))
    .first()
  if (reply !== null) return true
  const post = await ctx.db
    .query('posts')
    .withIndex('by_account_posted', (q) => q.eq('accountId', accountId).gte('posted.at', since))
    .first()
  return post !== null
}

/**
 * What the match looks for: every waiting reply and post draft, and the
 * replies and posts marked posted within MATCH_WINDOW_MS that no item was
 * found for yet. `known` holds the ids found within the
 * window, so no item is matched twice.
 */
async function candidatesOf(ctx: Reader, account: Doc<'accounts'>, now: number) {
  const accountId = account._id
  const platform = account.platform
  const posted = await postedSince(ctx, accountId, now - MATCH_WINDOW_MS)
  const unmatched = <T extends { status: string; posted?: Posted }>(rows: T[]) =>
    rows.filter((row) => row.status === 'posted' && row.posted?.kind !== 'found')
  return {
    replies: [...(await repliesWithStatus(ctx, accountId, 'draft')), ...unmatched(posted.replies)].map(replyCandidateOf),
    posts: [...(await postDrafts(ctx, accountId)), ...unmatched(posted.posts)].map((post) => postCandidateOf(post, platform)),
    known: new Set([...posted.replies, ...posted.posts].flatMap((row) => (row.posted?.kind === 'found' ? [row.posted.externalId] : []))),
  }
}

/** The account's post drafts. */
async function postDrafts(ctx: Reader, accountId: Id<'accounts'>): Promise<Doc<'posts'>[]> {
  return ctx.db
    .query('posts')
    .withIndex('by_account_status', (q) => q.eq('accountId', accountId).eq('status', 'draft'))
    .collect()
}

function postCandidateOf(post: Doc<'posts'>, platform: Platform): PostCandidate {
  return {
    id: post._id,
    externalId: postedItemOf(post.posted)?.externalId ?? null,
    community: post.community ?? null,
    plannedFor: post.plannedFor,
    writtenAt: post.writtenAt ?? null,
    line: POST_TITLE_MAX[platform] === null ? post.hook : post.title,
  }
}

function replyCandidateOf(reply: Doc<'replies'>): ReplyCandidate {
  if (reply.writtenAt === undefined) throw new Error(`reply ${reply._id} at ${reply.status} was never written`)
  return {
    id: reply._id,
    inReplyTo: reply.inReplyTo,
    writtenAt: reply.writtenAt,
    openedAt: reply.openedAt ?? null,
    text: reply.text,
    externalId: postedItemOf(reply.posted)?.externalId ?? null,
  }
}

/** What one run of the match did. */
export interface MatchResult {
  replies: number
  posts: number
  /** Items read that were new to the account's history. */
  stored: number
  /** Comments the operator answered. */
  answered: number
}

/**
 * Matches the items the reader listed and stores what it found, in one
 * transaction with the read of what it looks for, so a reply the operator
 * moved meanwhile is never overwritten. Every item joins the account's
 * history, matched or not: a reply or post points at its item by id, and an
 * item none points at was posted without a draft.
 */
export async function storeMatches(
  ctx: MutationCtx,
  account: Doc<'accounts'>,
  items: ImportedPost[],
  args: { source: AccountPostSource; now: number }
): Promise<MatchResult> {
  const candidates = await candidatesOf(ctx, account, args.now)
  const outcome = matchItems(items, candidates, { known: candidates.known, timezone: account.timezone, platform: account.platform })
  let replies = 0
  for (const { id, item } of outcome.replies) if (await matchReply(ctx, account, id, item)) replies += 1
  let posts = 0
  for (const { id, item } of outcome.posts) if (await matchPost(ctx, account, id, item)) posts += 1
  const { added } = await insertAccountPosts(ctx, { accountId: account._id, source: args.source, posts: items })
  // An item under a comment is the operator's answer to it, drafted or not.
  const answered = await answerComments(
    ctx,
    account._id,
    items.flatMap((item) => (item.parentId === null ? [] : [item.parentId]))
  )
  return { replies, posts, stored: added, answered }
}
