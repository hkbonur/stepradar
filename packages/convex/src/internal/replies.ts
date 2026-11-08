import { v } from 'convex/values'
import {
  answersFirst,
  fitVerdict,
  namesSponsor,
  repliesLeft,
  replyProblems,
  wentOutAt,
  REPLY_FRESH_MS,
  postsToMetCommunity,
  placeOf,
  type HeardThread,
} from '@influstep/shared'
import { internal } from '../_generated/api'
import type { Doc, Id } from '../_generated/dataModel'
import { internalAction, internalMutation, internalQuery, type ActionCtx } from '../_generated/server'
import { listens, replyBudget } from '../core/formats'
import { writerMemory, type WriterMemory } from '../core/memory'
import {
  REPLY_WRITES_PER_RUN,
  postedReplies,
  repliesWithStatus,
  repliesDraftedToday,
  storeHeard,
  storeWritten,
  type HeardOutcome,
  type WrittenReply,
  ruledHeard,
  storePasted,
} from '../core/replies'
import { accountBriefOf, voiceBriefOf } from '../core/accounts'
import { workspaceOf } from '../core/workspace'
import { queueRisingNotification } from '../core/notifications'
import { enqueueJob } from '../jobs/queue'
import { providersMode } from '../lib/env'
import { heardFitValidator, heardThreadValidator, threadLinkValidator, writtenReplyValidator } from '../lib/validators'
import { cannotRead, type FoundThread, type PlatformReader, type SearchQuery } from '../providers/platforms'
import { llmProvider, type PostedLately, type ReplyBrief, type ReplyDraft } from '../providers/llm'
import type { BriefVariant, LlmProvider } from '../providers/llm/types'
import { classifierProvider, classifyBriefOf } from '../providers/classifier'
import { actionReader } from './connections'
import { refusal } from '../lib/errors'
import { communitiesOf, mixSweep, sameCommunity, searchedCommunities } from '../core/communities'
import { postedLately } from '../core/history'
import { DISCLOSURE_WINDOW_MS, disclosureProblems, mayNameSponsor, type DisclosureContext } from '../core/disclosure'
import { readCommunityRules, type UnreadCommunity } from './communities'
import { draftChecked } from './drafting'
import { variantsOf } from '../core/variants'

/**
 * Replies: the listener's sweep (the researcher), the writer's
 * replies, and the analyst's read of what posted replies brought back. The
 * rules are in core/replies.ts.
 */

/** How many threads a sweep's search keeps over all the pillars, the ones that move most first. */
const LISTEN_SEARCH_LIMIT = 10

/** A found thread as the listener hears it: found by search, matched to the first pillar among its topics. */
function heardOf(thread: FoundThread, pillars: string[]): HeardThread {
  const { topics, ...heard } = thread
  return { ...heard, origin: 'search', pillar: topics.find((topic) => pillars.includes(topic)) ?? null }
}

/** The communities the account's Reddit or forum search keeps to (core/communities.ts `searchedCommunities`). */
export const searchedCommunitiesOf = internalQuery({
  args: { accountId: v.id('accounts') },
  handler: async (ctx, args): Promise<string[]> => searchedCommunities(await communitiesOf(ctx, args.accountId)),
})

/** A sweep's search: everywhere, and where the account has communities of its own, there too, mixed (core/communities.ts `mixSweep`). */
async function sweepSearch(
  search: NonNullable<PlatformReader['search']>,
  query: Omit<SearchQuery, 'communities' | 'limit'>,
  own: string[]
): Promise<FoundThread[]> {
  const limit = LISTEN_SEARCH_LIMIT
  if (own.length === 0) return search({ ...query, communities: null, limit })
  const [inOwn, everywhere] = await Promise.all([
    search({ ...query, communities: own, limit }),
    search({ ...query, communities: null, limit }),
  ])
  return mixSweep(inOwn, everywhere, limit)
}

/** What one pass of the listener's path did: the rows it kept or passed on, and the communities whose rules it could not read. */
export type HeardResult = HeardOutcome & { rulesUnread: UnreadCommunity[] }

/** The listener's sweep: what is said in the account's pillars, kept where it is worth answering. Mentions and comments come through the comment poll (internal/comments.ts). */
export const listen = internalAction({
  args: { accountId: v.id('accounts') },
  handler: async (ctx, args): Promise<HeardResult | { skipped: string }> => {
    const accountId = args.accountId
    const { account, workspace, connection } = await ctx.runQuery(internal.internal.data.getAccount, { accountId })
    if (!listens(account)) return { skipped: 'replies are off' }
    const reader = actionReader(ctx, account, connection)
    if (!reader.search) throw refusal(cannotRead(placeOf(account), 'search'))
    const own = postsToMetCommunity(account.platform)
      ? await ctx.runQuery(internal.internal.replies.searchedCommunitiesOf, { accountId })
      : []
    // A found thread is fresh for less long than a mention, so the search looks only that far back: older ones would crowd out what can be answered.
    const query = { terms: account.pillars, since: Date.now() - REPLY_FRESH_MS.search, sponsorName: workspace.sponsorName }
    const found = await sweepSearch(reader.search, query, own)
    return judgeAndStore(
      ctx,
      { account, workspace, reader },
      found.map((thread) => heardOf(thread, account.pillars))
    )
  },
})

/**
 * What was heard, judged and kept, for the listener's sweep and the comment
 * poll alike: the rules first (`ruledIn`), the classifier on what they keep,
 * then the rules of each community met. A thread in a community whose rules
 * cannot be read stays out until a later pass reads them (docs/plan.md,
 * ground rule 3). Storing queues the writer.
 */
export async function judgeAndStore(
  ctx: ActionCtx,
  source: { account: Doc<'accounts'>; workspace: Doc<'workspaces'>; reader: PlatformReader },
  heard: HeardThread[]
): Promise<HeardResult> {
  const { account, workspace, reader } = source
  // The classifier reads only what the rules keep, so no read is spent on a post they would drop anyway.
  const posts: HeardThread[] = await ctx.runQuery(internal.internal.replies.ruledIn, { accountId: account._id, posts: heard })
  const fits = await classifierProvider().classify(
    // A thread's title is half of what it asks, so the classifier reads both.
    classifyBriefOf(
      account,
      workspace,
      posts.map((post) => ({ origin: post.origin, text: post.title === null ? post.text : `${post.title}\n\n${post.text}` }))
    )
  )
  const judged = posts.map((post, index) => {
    const fit = fits[index]
    if (fit === undefined) throw new Error(`the classifier read ${fits.length} of ${posts.length} heard posts`)
    return { post, fit }
  })
  // Rules first: storing what was heard queues the writer, which reads them.
  const met = judged
    .filter(({ fit }) => fitVerdict(fit).kind !== 'drop')
    .flatMap(({ post }) => (post.community === null ? [] : [post.community]))
  const { unread } = await readCommunityRules(ctx, account, reader, met)
  const kept = judged.filter(
    ({ post }) => !unread.some((community) => post.community !== null && sameCommunity(community.name, post.community))
  )
  const outcome: HeardOutcome = await ctx.runMutation(internal.internal.replies.storeHeardMutation, {
    accountId: account._id,
    heard: kept,
    mock: providersMode() === 'mock',
  })
  return { ...outcome, rulesUnread: unread }
}

/** The heard posts the rules keep or pass on with a reason; what they drop unseen is left out. */
export const ruledIn = internalQuery({
  args: { accountId: v.id('accounts'), posts: v.array(heardThreadValidator) },
  handler: async (ctx, args): Promise<HeardThread[]> => {
    const account = await ctx.db.get(args.accountId)
    if (!account) throw new Error(`account ${args.accountId} not found`)
    const ruled = await ruledHeard(ctx, account, args.posts, Date.now())
    return ruled.filter(({ verdict }) => verdict.kind !== 'drop').map(({ post }) => post)
  },
})

/** What a reply is written to on each reply dimension the writer reads: its style, its length, and the sponsor mention in force. */
interface ReplyVariants {
  style: BriefVariant
  length: BriefVariant
  sponsorMention: BriefVariant
}

/** Keeps what the listener heard and, when anything is worth answering, queues the writer. */
export const storeHeardMutation = internalMutation({
  args: {
    accountId: v.id('accounts'),
    heard: v.array(v.object({ post: heardThreadValidator, fit: heardFitValidator })),
    mock: v.boolean(),
  },
  handler: async (ctx, args): Promise<HeardOutcome> => {
    const account = await ctx.db.get(args.accountId)
    if (!account) throw new Error(`account ${args.accountId} not found`)
    const now = Date.now()
    const outcome = await storeHeard(ctx, account, { heard: args.heard, now, mock: args.mock })
    if (outcome.kept > 0) await enqueueJob(ctx, { kind: 'write_replies', accountId: account._id })
    if (outcome.rising !== null) await queueRisingNotification(ctx, account, outcome.rising, { now, mock: args.mock })
    return outcome
  },
})

interface WritingContext {
  account: Doc<'accounts'>
  sponsorName: string
  sponsorPitch: string
  /** The replies posted within the disclosure window, and how many named the sponsor (core/disclosure.ts, rule 4). */
  week: { posted: number; named: number }
  /** The account's communities by name, with their rules as last read. */
  communities: Doc<'communities'>[]
  directives: string[]
  memory: WriterMemory
  posted: PostedLately
  /**
   * The heard threads to write, at most REPLY_WRITES_PER_RUN, each with the
   * reply style it is written in: the ones the operator asked for (pasted,
   * or asked for again) and the answers to comments and mentions first and
   * outside the budget (shared `answersFirst`), then the oldest others,
   * within what is left of today's reply budget. The rest wait for tomorrow's
   * budget, or go stale.
   */
  heard: { reply: Doc<'replies'>; variants: ReplyVariants }[]
  /** More threads that come first wait than this run writes: the writer queues another run. */
  more: boolean
}

export const writingContext = internalQuery({
  args: { accountId: v.id('accounts') },
  handler: async (ctx, args): Promise<WritingContext> => {
    const account = await ctx.db.get(args.accountId)
    if (!account) throw new Error(`account ${args.accountId} not found`)
    const workspace = await workspaceOf(ctx, account)
    const directives = await ctx.db
      .query('directives')
      .withIndex('by_account_active', (q) => q.eq('accountId', account._id).eq('active', true))
      .collect()
    const left = repliesLeft(replyBudget(account), await repliesDraftedToday(ctx, account, Date.now()))
    const waiting = (
      await ctx.db
        .query('replies')
        .withIndex('by_account_status', (q) => q.eq('accountId', account._id).eq('status', 'heard'))
        .collect()
    ).sort((a, b) => a.heardAt - b.heardAt)
    const first = waiting.filter(answersFirst)
    const rest = waiting.filter((reply) => !answersFirst(reply))
    const heard = [
      ...first.slice(0, REPLY_WRITES_PER_RUN),
      ...rest.slice(0, Math.min(Math.max(0, REPLY_WRITES_PER_RUN - first.length), left)),
    ]
    const styled: WritingContext['heard'] = []
    for (const reply of heard) {
      // The variants a reply experiment gave the reply when it was heard, else the ones in force.
      const variantOf = await variantsOf(ctx, reply, account)
      const variants = { style: variantOf('reply_style'), length: variantOf('reply_length'), sponsorMention: variantOf('sponsor_mention') }
      styled.push({ reply, variants })
    }
    const posted = (await postedReplies(ctx, account._id)).filter((reply) => wentOutAt(reply) >= Date.now() - DISCLOSURE_WINDOW_MS)
    // A draft that waits for the operator counts as posted, naming the sponsor or not: once posted, it is in the dial's week.
    const drafts = await repliesWithStatus(ctx, account._id, 'draft')
    const naming = drafts.filter((reply) => namesSponsor(reply.text, workspace.sponsorName))
    return {
      more: first.length > REPLY_WRITES_PER_RUN,
      account,
      sponsorName: workspace.sponsorName,
      sponsorPitch: workspace.sponsorPitch,
      week: {
        posted: posted.length + drafts.length,
        named: posted.filter((reply) => namesSponsor(reply.text, workspace.sponsorName)).length + naming.length,
      },
      communities: await communitiesOf(ctx, account._id),
      directives: directives.map((directive) => directive.text),
      memory: await writerMemory(ctx, account._id, workspace.sponsorName),
      posted: await postedLately(ctx, account._id, 'reply'),
      heard: styled,
    }
  },
})

/**
 * The writer answers every heard thread of the account, or passes on it. A
 * draft that breaks its platform's rules or a ground rule (core/disclosure.ts)
 * is written once more with the problems named; a second miss passes on the
 * thread with the reason, so the operator sees it rather than a thread that
 * waits forever.
 */
export const writeReplies = internalAction({
  args: { accountId: v.id('accounts') },
  handler: async (ctx, args): Promise<{ drafts: number; skipped: number }> => {
    const accountId = args.accountId
    const context = await ctx.runQuery(internal.internal.replies.writingContext, { accountId })
    const llm = llmProvider()
    const outcome = { drafts: 0, skipped: 0 }
    // The week grows with each draft this run writes, so a run of drafts cannot pass the dial together.
    let week = context.week
    for (const { reply, variants } of context.heard) {
      const community = communityOf(context, reply)
      const disclosure = disclosureFor(context, reply, community, week, variants)
      const written = await writeOne(llm, briefFor(context, reply, community, variants, disclosure), disclosure)
      const status = await ctx.runMutation(internal.internal.replies.storeWrittenMutation, { replyId: reply._id, written })
      if (status === 'draft') outcome.drafts += 1
      else if (status === 'skipped') outcome.skipped += 1
      // Every draft is in the dial's week once written; one naming the sponsor counts as named too.
      if (status === 'draft' && written.kind === 'reply') {
        week = { posted: week.posted + 1, named: week.named + (namesSponsor(written.text, context.sponsorName) ? 1 : 0) }
      }
    }
    if (context.more) await ctx.runMutation(internal.internal.replies.writeAgain, { accountId })
    return outcome
  },
})

/** Another writer run, for what came first and did not fit in this one. */
export const writeAgain = internalMutation({
  args: { accountId: v.id('accounts') },
  handler: async (ctx, args) => {
    await enqueueJob(ctx, { kind: 'write_replies', accountId: args.accountId })
  },
})

/** The thread's community, as the listener read its rules; null where the thread has none, or the rules were never read. */
function communityOf(context: WritingContext, reply: Doc<'replies'>): Doc<'communities'> | null {
  const name = reply.thread.community
  if (name === null) return null
  return context.communities.find((community) => sameCommunity(community.name, name)) ?? null
}

function disclosureFor(
  context: WritingContext,
  reply: Doc<'replies'>,
  community: Doc<'communities'> | null,
  week: DisclosureContext['week'],
  variants: ReplyVariants
): DisclosureContext {
  return {
    platform: context.account.platform,
    sponsorName: context.sponsorName,
    affiliationLine: context.account.affiliationLine,
    community: community === null ? null : { name: community.name, selfPromotion: community.selfPromotion },
    week,
    sponsorDial: context.account.sponsorDial,
    operatorAsked: reply.operatorAsked,
    sponsorMention: variants.sponsorMention.key,
  }
}

function briefFor(
  context: WritingContext,
  reply: Doc<'replies'>,
  community: Doc<'communities'> | null,
  variants: ReplyVariants,
  disclosure: DisclosureContext
): ReplyBrief {
  const { account } = context
  return {
    account: accountBriefOf(account),
    platform: account.platform,
    origin: reply.origin,
    thread: reply.thread,
    pillar: reply.pillar ?? null,
    sponsorName: context.sponsorName,
    sponsorPitch: context.sponsorPitch,
    affiliationLine: account.affiliationLine,
    mayNameSponsor: mayNameSponsor(disclosure),
    community: community === null ? null : { name: community.name, rules: community.rulesText },
    operatorAsked: reply.operatorAsked,
    style: variants.style,
    length: variants.length,
    memory: context.memory,
    directives: context.directives,
    voice: voiceBriefOf(account),
    posted: context.posted,
    problems: [],
  }
}

async function writeOne(llm: LlmProvider, brief: ReplyBrief, disclosure: DisclosureContext): Promise<WrittenReply> {
  const { draft, problems } = await draftChecked(
    (asked) => llm.writeReply(asked),
    brief,
    (written: ReplyDraft) =>
      written.kind === 'skip' ? [] : [...replyProblems(written.text, brief.platform), ...disclosureProblems(written.text, disclosure)]
  )
  if (problems.length === 0) return draft
  return { kind: 'skip', reason: `The writer missed the rules twice: ${problems.join(' ')}` }
}

export const storeWrittenMutation = internalMutation({
  args: { replyId: v.id('replies'), written: writtenReplyValidator },
  handler: async (ctx, args) => storeWritten(ctx, args.replyId, args.written, Date.now()),
})

export const storePastedMutation = internalMutation({
  args: { accountId: v.id('accounts'), link: threadLinkValidator, text: v.string(), fit: heardFitValidator },
  handler: async (ctx, args): Promise<Id<'replies'>> => {
    const account = await ctx.db.get(args.accountId)
    if (!account) throw new Error(`account ${args.accountId} not found`)
    return storePasted(ctx, account, { link: args.link, text: args.text, fit: args.fit }, Date.now())
  },
})
