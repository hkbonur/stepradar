import {
  ACCOUNT_POST_SOURCES,
  POST_LENGTHS,
  VOICE_EXAMPLES_MAX,
  VOICE_SAMPLE_MIN,
  countVoice,
  voicedPostOf,
  voiceEditProblems,
  voiceSampleSize,
  wentOutAt,
  type AccountPostSource,
  type ImportedPost,
  type VoiceCounts,
  type VoiceEdit,
  ARCHIVE_PLATFORM,
} from '@influstep/shared'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { refusal } from '../lib/errors'
import type { PostedLately } from '../providers/llm/types'
import { openVoiceItem } from './checklist'
import { postTextOf } from './posts'
import { postedReplies } from './replies'

/**
 * Taking over an X account (docs/plan.md, slice 5): the account's imported
 * history and the voice learned from it. The operator's import and the
 * researcher's timeline import both store posts through here, so a post is
 * deduplicated one way whatever brought it in. Importing only reads the
 * account: nothing here posts, likes or follows.
 *
 * An archive can hold tens of thousands of posts, so nothing here reads every
 * one of them: the totals and the voice's counts live in one accountCounts row
 * kept as posts come and go, the lists are index reads with a limit, and Clear
 * history deletes a page per mutation.
 */

type Reader = { db: QueryCtx['db'] }

export const ARCHIVE_NEEDS_X = "An archive or a paste is X's format, so it imports only into an account on X."

/** Said while Clear history is still deleting posts: a post imported now would be deleted with the rest. */
export const HISTORY_BEING_DELETED = 'The history is still being deleted; try again once it is gone.'

/** How many imported posts one mutation of Clear history deletes; a bigger history goes a page at a time. */
export const DELETE_PAGE_SIZE = 500

/** The account, when it is on the platform whose archive and paste the import reads (shared `ARCHIVE_PLATFORM`). */
export async function requireArchiveAccount(ctx: Reader, accountId: Id<'accounts'>): Promise<Doc<'accounts'>> {
  const account = await ctx.db.get(accountId)
  if (!account) throw new Error(`account ${accountId} not found`)
  if (account.platform !== ARCHIVE_PLATFORM) throw refusal(ARCHIVE_NEEDS_X)
  return account
}

/** The account's counts row; null while it holds no imported post. */
export async function accountCountsOf(ctx: Reader, accountId: Id<'accounts'>): Promise<Doc<'accountCounts'> | null> {
  return ctx.db
    .query('accountCounts')
    .withIndex('by_account', (q) => q.eq('accountId', accountId))
    .unique()
}

/**
 * Stores the posts the account does not hold yet, by their X id (a pasted
 * post's id is a hash of its text), and adds them to the counts. A post
 * already there is skipped, never overwritten, so importing the same archive
 * twice adds nothing and keeps the operator's example marks. A post repeated
 * within one batch is stored once.
 */
export async function insertAccountPosts(
  ctx: MutationCtx,
  args: { accountId: Id<'accounts'>; source: AccountPostSource; posts: ImportedPost[] }
): Promise<{ added: number; skipped: number }> {
  const counts = await accountCountsOf(ctx, args.accountId)
  if (counts !== null && counts.clearing) throw refusal(HISTORY_BEING_DELETED)
  const importedAt = Date.now()
  const added: ImportedPost[] = []
  for (const post of args.posts) {
    if (post.parts.length === 0) throw new Error(`imported post ${post.externalId} has no parts`)
    const existing = await ctx.db
      .query('accountPosts')
      .withIndex('by_account_external', (q) => q.eq('accountId', args.accountId).eq('externalId', post.externalId))
      .first()
    if (existing) continue
    await ctx.db.insert('accountPosts', {
      accountId: args.accountId,
      externalId: post.externalId,
      parts: post.parts,
      postedAt: post.postedAt,
      likes: post.likes,
      reposts: post.reposts,
      replies: post.replies,
      engagement: engagementOf(post),
      parentId: post.parentId ?? undefined,
      url: post.url ?? undefined,
      community: post.community ?? undefined,
      isReply: voicedPostOf(post).isReply,
      // A row has no language when X could not tell.
      ...(post.lang === null ? {} : { lang: post.lang }),
      source: args.source,
      example: false,
      importedAt,
    })
    added.push(post)
  }
  const skipped = args.posts.length - added.length
  if (added.length === 0) return { added: 0, skipped }
  const change = added.map((post) => ({ ...voicedPostOf(post), source: args.source }))
  if (counts === null) {
    await ctx.db.insert('accountCounts', { accountId: args.accountId, ...shiftedCounts(null, change, 1), clearing: false })
  } else {
    await ctx.db.patch(counts._id, shiftedCounts(counts, change, 1))
  }
  return { added: added.length, skipped }
}

type CountedPost = Pick<Doc<'accountPosts'>, 'source' | 'parts' | 'isReply'>
type Counts = Pick<Doc<'accountCounts'>, 'bySource' | 'originals'>

/** The counts with `posts` added (`sign` 1) or taken off (-1). Null counts are an account's before its first import: all zero. */
function shiftedCounts(counts: Counts | null, posts: CountedPost[], sign: 1 | -1): Counts {
  const bySource: Record<AccountPostSource, number> = counts === null ? { archive: 0, paste: 0, api: 0, mock: 0 } : { ...counts.bySource }
  for (const post of posts) bySource[post.source] += sign
  const change = countVoice(posts)
  const before: VoiceCounts = counts === null ? countVoice([]) : counts.originals
  const lengths = { ...before.lengths }
  for (const length of POST_LENGTHS) lengths[length] += sign * change.lengths[length]
  return {
    bySource,
    originals: {
      lengths,
      withEmoji: before.withEmoji + sign * change.withEmoji,
      withHashtag: before.withHashtag + sign * change.withHashtag,
    },
  }
}

/** The newest imported posts, replies included. */
export async function newestAccountPostsOf(ctx: Reader, accountId: Id<'accounts'>, limit: number): Promise<Doc<'accountPosts'>[]> {
  return ctx.db
    .query('accountPosts')
    .withIndex('by_account_posted', (q) => q.eq('accountId', accountId))
    .order('desc')
    .take(limit)
}

/** The account's own posts with the most likes plus reposts, newest first among equals: the order byEngagement sorts in. */
export async function topOriginalsOf(ctx: Reader, accountId: Id<'accounts'>, limit: number): Promise<Doc<'accountPosts'>[]> {
  return ctx.db
    .query('accountPosts')
    .withIndex('by_account_reply_engagement', (q) => q.eq('accountId', accountId).eq('isReply', false))
    .order('desc')
    .take(limit)
}

/** The account's newest own posts. */
export async function newestOriginalsOf(ctx: Reader, accountId: Id<'accounts'>, limit: number): Promise<Doc<'accountPosts'>[]> {
  return ctx.db
    .query('accountPosts')
    .withIndex('by_account_reply_posted', (q) => q.eq('accountId', accountId).eq('isReply', false))
    .order('desc')
    .take(limit)
}

/** The posts the writer imitates, most engaging first. setExamplePost keeps them to VOICE_EXAMPLES_MAX. */
export async function examplePostsOf(ctx: Reader, accountId: Id<'accounts'>): Promise<Doc<'accountPosts'>[]> {
  const examples = await ctx.db
    .query('accountPosts')
    .withIndex('by_account_example', (q) => q.eq('accountId', accountId).eq('example', true))
    .collect()
  return examples.sort(byEngagement)
}

/** What the account's audience gave a post: likes plus reposts, the order "top posts" means. */
export function engagementOf(post: Pick<ImportedPost, 'likes' | 'reposts'>): number {
  return post.likes + post.reposts
}

function byEngagement(a: Doc<'accountPosts'>, b: Doc<'accountPosts'>): number {
  return b.engagement - a.engagement || b.postedAt - a.postedAt
}

export interface AccountTotals {
  count: number
  /** Posts that are not replies to someone else; the voice is learned from these. */
  originals: number
  replies: number
  /** Every source, zero included. */
  bySource: Record<AccountPostSource, number>
}

/** The totals a counts row comes to; without a row the account holds no imported post. */
export function accountTotals(counts: Counts | null): AccountTotals {
  if (counts === null) return { count: 0, originals: 0, replies: 0, bySource: { archive: 0, paste: 0, api: 0, mock: 0 } }
  const count = ACCOUNT_POST_SOURCES.reduce((sum, source) => sum + counts.bySource[source], 0)
  const originals = voiceSampleSize(counts.originals)
  return { count, originals, replies: count - originals, bySource: { ...counts.bySource } }
}

/** The history's totals, and whether Clear history is still deleting it. */
export async function accountHistoryOf(ctx: Reader, accountId: Id<'accounts'>): Promise<{ totals: AccountTotals; clearing: boolean }> {
  const counts = await accountCountsOf(ctx, accountId)
  return { totals: accountTotals(counts), clearing: counts !== null && counts.clearing }
}

/** The summary the account page shows: how many posts the account holds and how many are examples. */
export async function historySummary(ctx: Reader, accountId: Id<'accounts'>): Promise<{ posts: number; examples: number }> {
  const { totals } = await accountHistoryOf(ctx, accountId)
  return { posts: totals.count, examples: (await examplePostsOf(ctx, accountId)).length }
}

/**
 * The originals' counts a voice is learned from. Refuses while Clear history
 * is still deleting posts, and under VOICE_SAMPLE_MIN originals with how many
 * there are.
 */
export function voiceSampleOf(counts: Pick<Doc<'accountCounts'>, 'originals' | 'clearing'> | null): VoiceCounts {
  if (counts === null) throw tooFewToLearn(0)
  if (counts.clearing) throw refusal(HISTORY_BEING_DELETED)
  const originals = voiceSampleSize(counts.originals)
  if (originals < VOICE_SAMPLE_MIN) throw tooFewToLearn(originals)
  return counts.originals
}

function tooFewToLearn(originals: number): Error {
  return refusal(`Import at least ${VOICE_SAMPLE_MIN} posts first; there are ${originals}.`)
}

/** The operator's edit, trimmed, or a refusal naming the first thing wrong with it (shared `voiceEditProblems`). */
export function assertVoiceEdit(edit: VoiceEdit): VoiceEdit {
  const [problem] = voiceEditProblems(edit)
  if (problem) throw refusal(problem.message)
  return { language: edit.language.trim(), summary: edit.summary.trim(), traits: edit.traits.map((trait) => trait.trim()) }
}

/**
 * Marks or unmarks a post as an example. Unmarking always works; marking
 * refuses once the account has VOICE_EXAMPLES_MAX, so the writer's prompt
 * stays short.
 */
export async function setExamplePost(ctx: MutationCtx, accountPostId: Id<'accountPosts'>, example: boolean): Promise<void> {
  const post = await ctx.db.get(accountPostId)
  if (!post) throw new Error(`account post ${accountPostId} not found`)
  if (post.example === example) return
  if (example) {
    const examples = await examplePostsOf(ctx, post.accountId)
    if (examples.length >= VOICE_EXAMPLES_MAX) {
      throw refusal(`A voice keeps at most ${VOICE_EXAMPLES_MAX} example posts; unmark one first.`)
    }
  }
  await ctx.db.patch(accountPostId, { example })
}

/**
 * One page of Clear history: deletes up to DELETE_PAGE_SIZE of the account's
 * imported posts and takes them off the counts. A full page may leave posts
 * behind, so the counts say the history is being deleted and the caller
 * schedules the next page (`more`). A short page was the last: the counts row
 * and the voice learned from the posts go too.
 */
export async function deleteHistoryPage(ctx: MutationCtx, accountId: Id<'accounts'>): Promise<{ deleted: number; more: boolean }> {
  const counts = await accountCountsOf(ctx, accountId)
  const page = await ctx.db
    .query('accountPosts')
    .withIndex('by_account_posted', (q) => q.eq('accountId', accountId))
    .take(DELETE_PAGE_SIZE)
  for (const post of page) await ctx.db.delete(post._id)
  if (page.length === DELETE_PAGE_SIZE) {
    if (counts === null) throw new Error(`account ${accountId} has account posts but no counts`)
    await ctx.db.patch(counts._id, { ...shiftedCounts(counts, page, -1), clearing: true })
    return { deleted: page.length, more: true }
  }
  if (counts !== null) await ctx.db.delete(counts._id)
  const account = await ctx.db.get(accountId)
  if (!account) throw new Error(`account ${accountId} not found`)
  // The voice learned from the posts goes with them, so the checklist asks for it again.
  if (account.voice !== undefined) await openVoiceItem(ctx, account, Date.now())
  await ctx.db.patch(accountId, { voice: undefined })
  return { deleted: page.length, more: false }
}

/** How many of the operator's posted texts the writer reads. */
const POSTED_LATELY = 5

/**
 * The account's last POSTED_LATELY posted replies or posts, newest first, in
 * the words that went out (the operator's, or the platform's once the match
 * found them), and their average edit share where one was kept.
 */
export async function postedLately(ctx: Reader, accountId: Id<'accounts'>, kind: 'reply' | 'post'): Promise<PostedLately> {
  const rows =
    kind === 'reply'
      ? (await postedReplies(ctx, accountId)).map((reply) => ({
          text: reply.text,
          at: wentOutAt(reply),
          editShare: reply.posted?.editShare,
        }))
      : (
          await ctx.db
            .query('posts')
            .withIndex('by_account', (q) => q.eq('accountId', accountId))
            .collect()
        )
          .filter((post) => post.status === 'posted' || post.status === 'measured')
          .map((post) => ({ text: postTextOf(post), at: wentOutAt(post), editShare: post.posted?.editShare }))
  const latest = rows.sort((a, b) => b.at - a.at).slice(0, POSTED_LATELY)
  const shares = latest.flatMap(({ editShare }) => (editShare === undefined ? [] : [editShare]))
  return {
    texts: latest.map((row) => row.text),
    editShare: shares.length === 0 ? null : shares.reduce((sum, share) => sum + share, 0) / shares.length,
  }
}
