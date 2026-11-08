import { v } from 'convex/values'
import {
  POST_LENGTH_LABELS,
  POST_TITLE_MAX,
  VOICE_EXAMPLES_MAX,
  isCold,
  EXPERIMENT_MEMORY_MS,
  beatenVariant,
  isPostExperimentKind,
  SPONSOR_LINKS,
  postDraftProblems,
  postLengthOf,
  engages,
  missingReasons,
  placeOf,
  repeatedShare,
  signalFreshness,
} from '@influstep/shared'
import { internal } from '../_generated/api'
import type { Doc, Id } from '../_generated/dataModel'
import { internalAction, internalMutation, internalQuery, type QueryCtx } from '../_generated/server'
import { createIdea, savePost } from '../core/posts'
import { applyEvent } from '../core/pipeline'
import { enqueueJob } from '../jobs/queue'
import { planPostSlots, planWaits, postIntentOf, sponsorAllowed, type KindSwap, type PostExperimentPlan } from '../core/planner'
import { lastCheck, researchFor } from '../core/research'
import { accountBriefOf, voiceBriefOf } from '../core/accounts'
import { examplePostsOf, postedLately } from '../core/history'
import { activeCommunities, communitiesOf, sameCommunity } from '../core/communities'
import { postDisclosureProblems } from '../core/disclosure'
import { draftChecked } from './drafting'
import { writerMemory, type WriterMemory } from '../core/memory'
import { workspaceOf } from '../core/workspace'
import { sponsorLinkOf } from '../core/links'
import { POST_LENGTH_TARGETS, llmProvider, type PostBrief, type PostDraft, type PostedLately } from '../providers/llm'
import type { BriefBasis, BriefVariant, WriterResearch } from '../providers/llm/types'
import { variantsOf } from '../core/variants'
import { bestToRework, whatWorked } from '../core/niche'
import { postPartsValidator } from '../lib/validators'

/**
 * The writer (CONTEXT.md, "Agent"): plans the week and writes each post the
 * day before it is due, after the last check. A thrown error fails the job,
 * and the post, in dispatch.ts.
 */

export const planWeek = internalMutation({
  args: { accountId: v.id('accounts'), weekStart: v.string() },
  handler: async (ctx, args): Promise<{ planned: number } | { skipped: string }> => {
    const account = await ctx.db.get(args.accountId)
    if (!account) throw new Error(`account ${args.accountId} not found`)
    if (account.paused) return { planned: 0 }
    const all = await ctx.db
      .query('posts')
      .withIndex('by_account', (q) => q.eq('accountId', account._id))
      .collect()
    const live = all.filter((post) => post.status !== 'killed')
    const now = Date.now()
    // Both rankers read a signal's freshness as its score, so a story from last week loses to one from this
    // morning, and a cold one is left out: it is too old to react to by the time the post is due.
    const signals = (
      await ctx.db
        .query('signals')
        .withIndex('by_account_status', (q) => q.eq('accountId', account._id).eq('status', 'new'))
        .collect()
    )
      .map((signal) => ({ id: signal._id, title: signal.title, score: signalFreshness(signal, now), topics: signal.topics }))
      .filter((signal) => !isCold(signal.score))
    const met = await communitiesOf(ctx, account._id)
    const waits = planWaits(placeOf(account), met)
    if (waits !== null) return { skipped: waits }
    const communities = activeCommunities(met)
    const worked = await whatWorked(ctx, account)
    const posts = planPostSlots({
      weekStart: args.weekStart,
      account,
      posts: live,
      communities: communities.map(({ name, selfPromotion, weight }) => ({ name, selfPromotion, weight })),
      signals,
      experiment: await postExperimentPlan(ctx, account._id),
      kindSwaps: await kindSwapsOf(ctx, account._id, now),
      standouts: worked.standouts,
      roundup: worked.roundup,
      rework: await bestToRework(ctx, account, now),
      now,
    })
    for (const post of posts) await createIdea(ctx, account, post)
    return { planned: posts.length }
  },
})

/** The running post experiment and the posts each of its variants already has, for the planner to tag the week's slots; null when none runs. */
async function postExperimentPlan(ctx: QueryCtx, accountId: Id<'accounts'>): Promise<PostExperimentPlan | null> {
  const running = await ctx.db
    .query('experiments')
    .withIndex('by_account_status', (q) => q.eq('accountId', accountId).eq('status', 'running'))
    .first()
  if (running === null || !isPostExperimentKind(running.kind)) return null
  const assigned: { sponsored: Record<string, number>; plain: Record<string, number> } = { sponsored: {}, plain: {} }
  for (const post of await ctx.db
    .query('posts')
    .withIndex('by_experiment', (q) => q.eq('experimentId', running._id))
    .collect()) {
    if (post.variantKey === undefined) continue
    const counts = post.sponsorSegment === 'none' ? assigned.plain : assigned.sponsored
    counts[post.variantKey] = (counts[post.variantKey] ?? 0) + 1
  }
  return { experimentId: running._id, kind: running.kind, keys: running.variants.map((variant) => variant.key), assigned }
}

/**
 * The post kinds the account decided within EXPERIMENT_MEMORY_MS, oldest
 * first, each with the kind it beat (shared `beatenVariant`): the planner
 * gives the winner the loser's turns (core/planner.ts `KindSwap`).
 */
async function kindSwapsOf(ctx: QueryCtx, accountId: Id<'accounts'>, now: number): Promise<KindSwap[]> {
  const decided = await ctx.db
    .query('experiments')
    .withIndex('by_account_status', (q) => q.eq('accountId', accountId).eq('status', 'decided'))
    .collect()
  return decided
    .flatMap((experiment) => {
      const decision = experiment.decision
      if (experiment.kind !== 'post_kind' || !decision || decision.decidedAt < now - EXPERIMENT_MEMORY_MS) return []
      const row = {
        id: experiment._id,
        kind: experiment.kind,
        variants: experiment.variants,
        status: 'decided' as const,
        winnerKey: decision.winnerKey,
        decidedAt: decision.decidedAt,
        ...(decision.runnerUpKey === undefined ? {} : { runnerUpKey: decision.runnerUpKey }),
      }
      return [{ decidedAt: decision.decidedAt, swap: { from: postIntentOf(beatenVariant(row).key), to: postIntentOf(decision.winnerKey) } }]
    })
    .sort((a, b) => a.decidedAt - b.decidedAt)
    .map(({ swap }) => swap)
}

/** The last check's swap, or none, in one transaction; it runs before the writer reads the post. */
export const lastCheckMutation = internalMutation({
  args: { postId: v.id('posts') },
  handler: async (ctx, args): ReturnType<typeof lastCheck> => lastCheck(ctx, args.postId, Date.now()),
})

interface PostContext {
  post: Doc<'posts'>
  account: Doc<'accounts'>
  workspace: Doc<'workspaces'>
  directives: Doc<'directives'>[]
  signals: Doc<'signals'>[]
  /** The account posts the operator or the analyst marked as examples of the voice, most engaging first. */
  examples: Doc<'accountPosts'>[]
  /** What the writer reads of the account's memory (core/memory.ts `writerMemory`). */
  memory: WriterMemory
  /**
   * What the researcher found (core/research.ts): the morning brief while it
   * has not expired, else null, and the open problems' texts, newest first, at
   * most five.
   */
  research: WriterResearch
  posted: PostedLately
  /** The account's communities, whose rules a post written for one of them follows. */
  communities: Doc<'communities'>[]
  /** How the post opens and ends: its post experiment's variant, else the one in force. */
  hook: BriefVariant
  callToAction: BriefVariant
}

/** Everything the writer reads to write one post. */
export const getPostContext = internalQuery({
  args: { postId: v.id('posts') },
  handler: async (ctx, args): Promise<PostContext> => {
    const post = await ctx.db.get(args.postId)
    if (!post) throw new Error(`post ${args.postId} not found`)
    const account = await ctx.db.get(post.accountId)
    if (!account) throw new Error(`account ${post.accountId} not found`)
    const workspace = await workspaceOf(ctx, account)
    const directives = await ctx.db
      .query('directives')
      .withIndex('by_account_active', (q) => q.eq('accountId', account._id).eq('active', true))
      .collect()
    const signals = (await Promise.all(post.signalIds.map((id) => ctx.db.get(id)))).filter(
      (signal): signal is Doc<'signals'> => signal !== null
    )
    // setExample caps the marks at VOICE_EXAMPLES_MAX; the cap holds here too, so the writer's prompt stays short.
    const examples = (await examplePostsOf(ctx, account._id)).slice(0, VOICE_EXAMPLES_MAX)
    const memory = await writerMemory(ctx, account._id, workspace.sponsorName)
    const research = await researchFor(ctx, account._id, Date.now())
    const posted = await postedLately(ctx, account._id, 'post')
    const communities = await communitiesOf(ctx, account._id)
    const variantOf = await variantsOf(ctx, post, account)
    return {
      post,
      account,
      workspace,
      directives,
      signals,
      examples,
      memory,
      research,
      posted,
      communities,
      hook: variantOf('hook'),
      callToAction: variantOf('call_to_action'),
    }
  },
})

/**
 * What the writer's job ends with: the title it wrote, or a skip when the
 * post was killed while the model was writing. Killing a post fails its
 * queued jobs but cannot stop one that is running, so the store step is
 * where a late draft is dropped, and the job still ends done.
 */
type WriterResult = { title: string } | { skipped: 'killed' } | { skipped: string }

/**
 * The writer. It writes the day before the post is due, so it first takes a
 * last look at what moved (core `lastCheck`): a reactive concept whose signal
 * went cold is swapped for the strongest fresh one before the context is
 * read, and the writer writes the new concept. The writer then reads this
 * morning's brief and the problem log with the rest of the context.
 *
 * The post is written to the intent and length the planner chose, in the
 * shape and limits of its platform and under its community's rules, in the
 * account's voice with its example posts in front of the writer. It names
 * the sponsor only where the post's place still allows it. A draft that
 * breaks a rule goes back to the model once with the problems named; a
 * second miss fails the post with them.
 */
export const writePost = internalAction({
  args: { postId: v.id('posts') },
  handler: async (ctx, args): Promise<WriterResult> => {
    const postId = args.postId
    await ctx.runMutation(internal.internal.writer.lastCheckMutation, { postId })
    const context: PostContext = await ctx.runQuery(internal.internal.writer.getPostContext, { postId })
    const { post, account, workspace, directives, signals, examples, memory, research, posted, communities, hook, callToAction } = context
    const { kind, length } = post
    const met = communityOf(communities, post)
    const sponsored = sponsorAllowed(account.platform, post, met) && post.sponsorSegment !== 'none'
    // A launch exists to name the product: where its community no longer allows that, it is skipped, never written without it.
    if (post.basis?.kind === 'launch' && !sponsored) return ctx.runMutation(internal.internal.writer.skipLaunch, { postId })
    const sponsor = sponsored ? { link: await ctx.runMutation(internal.internal.writer.sponsorLink, { postId }) } : null
    const brief: PostBrief = {
      account: accountBriefOf(account),
      kind,
      concept: post.concept,
      pillar: post.pillar ?? account.pillars[0] ?? '',
      sponsor,
      sponsorName: workspace.sponsorName,
      sponsorPitch: workspace.sponsorPitch,
      memory,
      directives: directives.map((directive) => directive.text),
      signals: signals.map((signal) => ({ title: signal.title, summary: signal.summary, url: signal.url })),
      basis: post.basis ?? null,
      research,
      community: post.community === undefined ? null : { name: post.community, rules: met?.rulesText ?? null },
      affiliationLine: account.affiliationLine,
      intent: post.intent,
      length,
      hook,
      callToAction,
      voice: voiceBriefOf(account),
      examples: examples.map((example) => example.parts),
      posted,
      problems: [],
      judged: judgedOf(post),
    }
    const llm = llmProvider()
    const { draft, problems } = await draftChecked(
      (asked) => llm.writePost(asked),
      brief,
      (written) => draftProblems(brief, post, written)
    )
    if (problems.length > 0) throw new Error(`The writer missed the post's rules twice: ${problems.join(' ')}`)
    return ctx.runMutation(internal.internal.writer.storePost, {
      postId: post._id,
      title: draft.title,
      parts: draft.parts,
      link: sponsor?.link ?? null,
    })
  },
})

/** A launch that may no longer name the product: skipped with why, as the operator reads it on the post. */
export const skipLaunch = internalMutation({
  args: { postId: v.id('posts') },
  handler: async (ctx, args): Promise<WriterResult> => {
    const post = await ctx.db.get(args.postId)
    if (!post) throw new Error(`post ${args.postId} not found`)
    const reason = `A launch that cannot name the product is no launch: ${post.community === undefined ? 'its place' : post.community} no longer allows it.`
    await applyEvent(ctx, post, { type: 'skipped', reason })
    return { skipped: reason }
  },
})

/** The link the sponsored post carries to the sponsor (core/links.ts), made before the writer writes it. */
export const sponsorLink = internalMutation({
  args: { postId: v.id('posts') },
  handler: async (ctx, args): Promise<string> => {
    const post = await ctx.db.get(args.postId)
    if (!post) throw new Error(`post ${args.postId} not found`)
    const account = await ctx.db.get(post.accountId)
    if (!account) throw new Error(`account ${post.accountId} not found`)
    return (await sponsorLinkOf(ctx, post, account, await workspaceOf(ctx, account))).url
  },
})

/**
 * What a post draft breaks: its platform's rules and its draft shape (shared
 * `postDraftProblems`), the sponsor's (core `postDisclosureProblems`) on what
 * the platform shows, which is the title too only where the platform posts
 * one, and on X the length the planner chose, which the account's voice is
 * learned in.
 */
function draftProblems(brief: PostBrief, post: Doc<'posts'>, draft: PostDraft): string[] {
  const platform = brief.account.platform
  const shown = POST_TITLE_MAX[platform] === null ? draft.parts : [draft.title, ...draft.parts]
  const problems = [
    ...postDraftProblems({ platform, kind: post.kind, community: post.community ?? null }, draft),
    ...postDisclosureProblems(shown.join('\n'), {
      sponsorName: brief.sponsorName,
      affiliationLine: brief.affiliationLine,
      sponsored: brief.sponsor !== null,
    }),
    ...linkProblems(shown.join('\n'), brief),
    ...modelProblems(shown.join('\n'), brief.basis),
  ]
  if (platform !== 'x') return problems
  const written = postLengthOf(draft.parts)
  if (written === post.length) return problems
  return [
    ...problems,
    `This post should be ${POST_LENGTH_TARGETS[post.length]}; the draft is a ${POST_LENGTH_LABELS[written].toLowerCase()}.`,
  ]
}

/** The judge's reading of the post's last draft when it found too few reasons to engage, for the writer to write for them. */
function judgedOf(post: Doc<'posts'>): PostBrief['judged'] {
  const judgment = post.judgment
  if (judgment === undefined || engages(judgment.reasons)) return null
  return { missing: missingReasons(judgment.reasons), fix: judgment.fix }
}

/** How much of the thread a post is modeled on its draft may repeat (shared `repeatedShare`) before it reads as a copy. */
const MODEL_REPEAT_MAX = 0.5

/**
 * A text this short is the topic itself, which the post is asked to be about
 * ("Self-hosting n8n"), so repeating it is no copy.
 */
const MODEL_QUOTE_MIN_WORDS = 6

/** A post modeled on a standout takes what made it work, never its words (core/niche.ts). */
function modelProblems(text: string, basis: BriefBasis | null): string[] {
  if (basis?.kind !== 'model') return []
  const { title, summary } = basis.thread
  const quoted = [title, summary].filter((source) => source.split(/\s+/).filter(Boolean).length >= MODEL_QUOTE_MIN_WORDS)
  if (quoted.every((source) => repeatedShare(source, text) <= MODEL_REPEAT_MAX)) return []
  return ['The draft repeats the thread it is modeled on. Take its topic and what made people answer it, and say it in your own words.']
}

/**
 * A sponsored post carries its link once and exactly as given, since the
 * operator posts what the draft says; where the link is the submission's
 * URL (shared SPONSOR_LINKS), the text leaves it out.
 */
function linkProblems(text: string, brief: PostBrief): string[] {
  const own = brief.sponsor?.link ?? null
  // A tracked link that is not this post's own counts its clicks for another post: one a reworked original carried, say.
  const foreign = (text.match(/\S*\/go\/[a-z0-9]+\S*/gi) ?? []).filter((link) => own === null || !link.includes(own))
  const problems = foreign.length === 0 ? [] : [`Leave out ${foreign.join(', ')}: a post carries no link but its own.`]
  if (own === null || SPONSOR_LINKS[brief.account.platform].placement !== 'text') return problems
  return text.split(own).length === 2 ? problems : [...problems, `Put the link ${own} in the post once, exactly as written.`]
}

/** The community a post goes to as the account met it, with its rules as the listener read them; undefined where it met none. */
function communityOf(communities: Doc<'communities'>[], post: Doc<'posts'>): Doc<'communities'> | undefined {
  const name = post.community
  if (name === undefined) return undefined
  return communities.find((community) => sameCommunity(community.name, name))
}

/**
 * The written post becomes the post's draft, through the same save as the
 * operator's editor, so its first line is its hook. It waits for the
 * operator, who posts it by hand.
 */
export const storePost = internalMutation({
  args: { postId: v.id('posts'), title: v.string(), parts: postPartsValidator, link: v.union(v.string(), v.null()) },
  handler: async (ctx, args): Promise<WriterResult> => {
    const post = await ctx.db.get(args.postId)
    if (!post) throw new Error(`post ${args.postId} not found`)
    if (post.status === 'killed') return { skipped: 'killed' }
    await savePost(ctx, args.postId, { title: args.title, parts: args.parts })
    await ctx.db.patch(args.postId, { sponsorLink: args.link ?? undefined })
    await applyEvent(ctx, post, { type: 'written', at: Date.now() })
    // The judge reads it from the reader's side before it waits for the operator (internal/judge.ts).
    await enqueueJob(ctx, { kind: 'judge_post', accountId: post.accountId, postId: args.postId, wordsBy: 'writer' })
    return { title: args.title }
  },
})
