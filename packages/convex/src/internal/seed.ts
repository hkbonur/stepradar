import { v } from 'convex/values'
import {
  DEFAULT_FORMATS,
  postHook,
  voiceStats,
  voicedPostOf,
  type Forum,
  type ItemCounts,
  type PlatformFormat,
  type PostIntent,
  type PostKind,
  type PostLength,
  type SponsorSegment,
} from '@influstep/shared'
import type { Doc, Id, TableNames } from '../_generated/dataModel'
import { internalMutation, type MutationCtx } from '../_generated/server'
import { insertAccountPosts, topOriginalsOf } from '../core/history'
import { addDays, dayKey, instantAt } from '../core/dates'
import { createIdea } from '../core/posts'
import { sponsorLinkOf } from '../core/links'
import { workspaceOf } from '../core/workspace'
import { rememberFromOperator } from '../core/memory'
import { logRepeatedQuestions, writeDailyBrief } from '../core/research'
import { reviewStrategy } from '../core/strategy'
import { storeCommunityRules } from '../core/communities'
import { ADA_VOICE_TEXT, SEEDED_REPLIES, adaXHistory } from './seedData'

/**
 * The demo workspace: two X accounts and Ada's account on the n8n Community
 * forum, with the two categories she takes part in, a planned week, a running reply
 * experiment, signals, a post at every status the operator meets (an idea,
 * a draft to post, one posted, a month of measured ones), the X account Ada
 * took over with its history and learned voice, and her replies by where
 * they stand, so Today, the reports and the replies page show something on
 * first open. Ada's memory holds a fact the operator told her in the chat and
 * rules added on the memory page, and a review a week ago left her goal note
 * and started her reply experiment. Max has neither. `pnpm seed` runs this;
 * it is idempotent by workspace name.
 */

const TIMEZONE = 'Europe/Oslo'
const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000

/** Ada's X: her own hour, two posts a day, and the default reply budget. */
const ADA_FORMAT = DEFAULT_FORMATS.x

/** The n8n Community, where Ada also answers: a Discourse forum, read by the forum reader. */
const N8N_FORUM: Forum = { origin: 'https://community.n8n.io', name: 'n8n Community', software: 'discourse' }

/** The forum's guidelines as the listener read them for each of Ada's categories there. */
const N8N_RULES =
  'Be civil. No spam and no advertising: share your own product only where it answers the question. Mark the reply that solved it.'

/** Max posts once a day, later, and answers fewer people. */
const MAX_FORMAT: PlatformFormat = {
  platform: 'x',
  publishHour: 17,
  cadence: { ...DEFAULT_FORMATS.x.cadence, postsPerDay: 1, repliesPerDay: 3 },
}

export const run = internalMutation({
  args: { appUrl: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ workspaceId: Id<'workspaces'> }> => {
    // The demo is a fictional run for Formstep, the product Influstep was first built for. A workspace set up for another
    // product is the operator's own: the demo's accounts would land in it, so the seed leaves it alone.
    const workspaces = await ctx.db.query('workspaces').collect()
    const existing = workspaces.find((workspace) => workspace.name === 'Formstep')
    if (existing) return { workspaceId: existing._id }
    if (workspaces.length > 0)
      throw new Error('This backend is set up for your own product; the demo seed runs only on an empty one (pnpm seed:fresh wipes it).')
    const now = Date.now()
    const today = dayKey(now, TIMEZONE)
    const workspaceId = await ctx.db.insert('workspaces', {
      name: 'Formstep',
      sponsorName: 'Formstep',
      sponsorUrl: 'https://formstep.io',
      sponsorPitch: 'Forms that workflows and AI agents send to one customer; the answers come back into the flow.',
      appUrl: args.appUrl ?? 'http://localhost:3300',
      valuePerPaid: 29,
      currency: 'EUR',
    })

    const adaId = await ctx.db.insert('accounts', {
      workspaceId,
      name: 'Ada Automates',
      handle: 'ada_automates',
      niche: 'n8n and workflow automation for small teams',
      audience: 'people at small companies who automate their own busywork',
      tone: 'calm, precise, a little dry',
      bio: 'One n8n fix a day. No fluff, no plugins you do not need.',
      bible:
        'Ada speaks in short sentences and says the point first. She never says "game changer" or "insane". She admits when a tool is the wrong choice. She calls readers "you", never "guys".',
      affiliationLine: "I'm building Formstep, so take this with salt.",
      pillars: ['n8n tutorials', 'AI agent workflows', 'Automation fails'],
      ...ADA_FORMAT,
      sponsorDial: 0.4,
      sponsorRampPosts: 10,
      paused: false,
      timezone: TIMEZONE,
      createdAt: now - 40 * DAY_MS,
    })
    const maxId = await ctx.db.insert('accounts', {
      workspaceId,
      name: 'Max Builds Agents',
      handle: 'max_builds',
      niche: 'Claude Code, MCP, and agents that do real work',
      audience: 'developers who want agents in production, not demos',
      tone: 'curious, fast, honest about failures',
      bio: 'I build an AI agent a week and post where it broke.',
      bible:
        'Max writes what the agent did, then what broke. Every post ends with what he would do differently. He never promises an agent "just works". He says "the agent" not "the AI".',
      affiliationLine: 'I work on Formstep, so weigh this accordingly.',
      pillars: ['Claude Code recipes', 'MCP servers', 'Agents in production'],
      ...MAX_FORMAT,
      sponsorDial: 0.3,
      sponsorRampPosts: 10,
      paused: false,
      timezone: TIMEZONE,
      createdAt: now - 10 * DAY_MS,
    })
    const ada = await requireAccount(ctx, adaId)
    const max = await requireAccount(ctx, maxId)

    await seedChat(ctx, adaId, now)
    await seedSignals(ctx, { adaId, maxId, now })

    // A month of Ada's posts, posted and measured, so the report has a funnel and the review has numbers.
    const adaPast = [
      ['Name every n8n node before the workflow grows', 'n8n tutorials', 'none'],
      ['The error workflow that pages you only once', 'Automation fails', 'none'],
      ['Let an agent sort the inbox, then ask before it replies', 'AI agent workflows', 'mention'],
      ['A webhook that fails silently is a webhook with no error path', 'Automation fails', 'none'],
      ['Retry the step, not the workflow', 'n8n tutorials', 'none'],
      ['Ask the customer once, in one form, and let the flow wait', 'AI agent workflows', 'mention'],
      ['Three n8n settings I turn on before the first real run', 'n8n tutorials', 'none'],
      ['When an agent should stop and ask a human', 'AI agent workflows', 'none'],
    ] as const
    const adaPosted: Id<'posts'>[] = []
    for (const [index, [concept, pillar, sponsorSegment]] of adaPast.entries()) {
      adaPosted.push(
        await seedPostedPost(ctx, ada, {
          concept,
          pillar,
          sponsorSegment,
          plannedFor: addDays(today, -(28 - index * 3)),
          measured: true,
          impressions: 1_200 + ((index * 431) % 2_400),
          follows: 4 + ((index * 7) % 15),
          clicks: sponsorSegment === 'none' ? 0 : 30 + index * 4,
          tag: `a${index}`,
          now,
        })
      )
    }
    // The paid customers and signups the sponsored posts brought, first touch through their links.
    for (const [index, kind] of (['signup', 'signup', 'paid', 'signup', 'paid', 'trial_started'] as const).entries()) {
      const postId = index % 2 === 0 ? adaPosted[2] : adaPosted[5]
      if (postId === undefined) throw new Error('the seed has no sponsored post to credit')
      await ctx.db.insert('conversions', {
        accountId: adaId,
        postId,
        kind,
        distinctId: `seed-ada-${index}`,
        at: now - (20 - index * 3) * DAY_MS,
        mock: true,
      })
    }
    await seedFollowers(ctx, ada, { start: 1_180, perDay: 9, now })
    // Yesterday's post is out: the operator posted it and gave its link, and the analyst has not closed it yet.
    await seedPostedPost(ctx, ada, {
      concept: 'n8n queue mode, in one paragraph',
      pillar: 'n8n tutorials',
      sponsorSegment: 'none',
      plannedFor: addDays(today, -1),
      measured: false,
      impressions: 2_400,
      follows: 9,
      clicks: 0,
      tag: 'a-yesterday',
      now,
    })
    // Today's draft waits for the operator to post it.
    await seedDraft(ctx, ada, {
      concept: 'Set an error workflow before the first real run',
      pillar: 'Automation fails',
      plannedFor: today,
      kind: 'text',
      intent: 'teach',
      length: 'medium',
      parts: [
        'Set an error workflow before the first real run of any n8n flow. One Error Trigger, one message to the channel someone actually reads. The first silent failure costs more than the ten minutes this takes.',
      ],
      now,
    })
    // The rest of the week: ideas the writer takes the day before each is due. Tomorrow's is written at once.
    for (const [offset, concept, pillar] of [
      [1, 'How do you retry a failed webhook step?', 'n8n tutorials'],
      [2, 'Agents that wait for a human answer', 'AI agent workflows'],
      [3, 'The n8n setting nobody turns on', 'n8n tutorials'],
    ] as const) {
      await createIdea(ctx, ada, {
        plannedFor: addDays(today, offset),
        concept,
        pillar,
        sponsorSegment: 'none',
        signalIds: [],
        kind: offset === 2 ? 'thread' : 'text',
        intent: 'teach',
        length: offset === 2 ? 'long' : 'medium',
        publishHour: DEFAULT_FORMATS.x.publishHour,
      })
    }

    // Ada took over an X account that already had a history: the hand-written posts and replies, and the voice
    // the analyst learned from them, with her five most engaging originals as the writer's examples.
    const adaHistory = adaXHistory(now)
    await insertAccountPosts(ctx, { accountId: adaId, source: 'mock', posts: adaHistory })
    for (const example of await topOriginalsOf(ctx, adaId, 5)) await ctx.db.patch(example._id, { example: true })
    await ctx.db.patch(adaId, { voice: { ...ADA_VOICE_TEXT, ...voiceStats(adaHistory.map(voicedPostOf)), learnedAt: now - 3 * DAY_MS } })

    // A week ago her analyst reviewed the strategy: it left a goal note and started the next reply experiment.
    const reviewed = await requireAccount(ctx, adaId)
    const review = await reviewStrategy(ctx, reviewed, now - 6 * DAY_MS)
    const experiment = review.startedExperimentId === undefined ? null : await ctx.db.get(review.startedExperimentId)

    // Whom Ada does not answer, and her replies by where they stand: drafts for the operator, replies the
    // operator posted this week with what they brought back, and posts passed on, one naming the sponsor and
    // one her rule covers. The replies heard since the review carry the experiment's variants in turn.
    const replyRule = await rememberFromOperator(
      ctx,
      { _id: adaId },
      { kind: 'rule', text: 'never reply to politics', now: now - 5 * DAY_MS }
    )
    if (replyRule.status !== 'stored') throw new Error(`the seeded reply rule was not stored: ${replyRule.status}`)
    for (const [index, reply] of SEEDED_REPLIES.entries()) {
      const heardAt = now - reply.hoursAgo * HOUR_MS
      const variantKey = experiment && reply.status !== 'skipped' ? experiment.variants[index % experiment.variants.length]?.key : undefined
      await ctx.db.insert('replies', {
        accountId: adaId,
        origin: reply.origin,
        inReplyTo: `seed-x-post-${reply.key}`,
        thread: {
          url: `https://x.com/${reply.author.handle}/status/${xId('185', reply.key)}`,
          title: null,
          text: reply.post,
          postedAt: heardAt - HOUR_MS,
          author: { handle: reply.author.handle, name: reply.author.name },
          reach: reply.author.followers,
          community: null,
        },
        pillar: reply.pillar,
        // The seeded posts are on topic: a question, scored a little lower the older it is.
        fit: {
          relevant: true,
          intent: 'question',
          replyWorthy: true,
          score: Math.max(0.5, 0.9 - reply.hoursAgo * 0.01),
          confidence: 0.7,
          reason: reply.pillar ? `about ${reply.pillar}` : 'spoken to the account',
        },
        ...(experiment && variantKey !== undefined ? { experimentId: experiment._id, variantKey } : {}),
        status: reply.status,
        text: reply.text,
        ...(reply.status === 'skipped' ? { skipReason: reply.skipReason } : {}),
        operatorAsked: false,
        heardAt,
        writtenAt: heardAt + 5 * 60_000,
        ...(reply.status === 'posted'
          ? {
              posted: {
                kind: 'linked' as const,
                at: heardAt + HOUR_MS,
                url: `https://x.com/ada_automates/status/${xId('186', reply.key)}`,
                externalId: xId('186', reply.key),
              },
              numbers: { counts: { platform: 'x' as const, ...reply.brought }, readAt: now - 2 * HOUR_MS, mock: true },
            }
          : {}),
        mock: true,
      })
    }

    // This morning's research: the repeated question becomes a problem, and the brief names it.
    await logRepeatedQuestions(ctx, ada, now)
    await writeDailyBrief(ctx, ada, now)

    await seedFollowers(ctx, max, { start: 420, perDay: 3, now })
    // Max: two measured posts and the next two days' ideas. Tomorrow's is written at once, so the writer has
    // work on first run whatever today is.
    for (const [index, [concept, pillar]] of [
      ['Claude Code wrote the migration and dropped the wrong column', 'Agents in production'],
      ['An MCP server for your calendar in forty lines', 'MCP servers'],
    ].entries()) {
      await seedPostedPost(ctx, max, {
        concept,
        pillar,
        sponsorSegment: 'none',
        plannedFor: addDays(today, -(8 - index * 3)),
        measured: true,
        impressions: 3_100 + index * 900,
        follows: 21 + index * 8,
        clicks: 0,
        tag: `m${index}`,
        now,
      })
    }
    for (const [offset, concept] of [
      [1, 'Give Claude Code an MCP server for your own API'],
      [2, 'An agent that opens the pull request and waits for review'],
    ] as const) {
      await createIdea(ctx, max, {
        plannedFor: addDays(today, offset),
        concept,
        pillar: 'MCP servers',
        sponsorSegment: 'none',
        signalIds: [],
        kind: 'text',
        intent: 'teach',
        length: 'medium',
        publishHour: 17,
      })
    }

    // Ada on the n8n Community: the categories she has met, whose guidelines forbid advertising, and tomorrow's question.
    const forumId = await ctx.db.insert('accounts', {
      workspaceId,
      name: 'Ada on the n8n forum',
      handle: 'ada_automates',
      niche: 'n8n workflows for small teams',
      audience: 'n8n users stuck on a webhook, a retry or an error workflow',
      tone: 'calm, precise, helpful first',
      bio: 'I answer n8n questions with the setting that fixed it for me.',
      bible: 'Ada answers the question asked, with the node and the setting. She posts the workflow JSON only when it helps.',
      affiliationLine: "I'm building Formstep, so take this with salt.",
      pillars: ['webhooks', 'error workflows', 'forms in workflows'],
      ...DEFAULT_FORMATS.forum,
      forum: N8N_FORUM,
      sponsorDial: 0.1,
      sponsorRampPosts: 10,
      paused: false,
      timezone: TIMEZONE,
      createdAt: now - 5 * DAY_MS,
    })
    for (const name of ['Questions', 'Help me Build my Workflow']) {
      await storeCommunityRules(
        ctx,
        forumId,
        { name, rulesText: N8N_RULES, selfPromotion: 'forbidden', reason: 'a rule forbids advertising' },
        now - 4 * DAY_MS
      )
    }
    await createIdea(ctx, await requireAccount(ctx, forumId), {
      plannedFor: addDays(today, 1),
      concept: 'How do you stop a form webhook from running twice?',
      pillar: 'webhooks',
      community: 'Questions',
      sponsorSegment: 'none',
      signalIds: [],
      kind: 'text',
      intent: 'ask',
      length: 'medium',
      publishHour: DEFAULT_FORMATS.forum.publishHour,
    })
    return { workspaceId }
  },
})

async function requireAccount(ctx: MutationCtx, accountId: Id<'accounts'>): Promise<Doc<'accounts'>> {
  const account = await ctx.db.get(accountId)
  if (!account) throw new Error(`account ${accountId} vanished`)
  return account
}

/** A directive, the chat that set it, a fact told in the chat and a rule added on the memory page. */
async function seedChat(ctx: MutationCtx, adaId: Id<'accounts'>, now: number): Promise<void> {
  await ctx.db.insert('directives', {
    accountId: adaId,
    text: 'focus on n8n error handling for two weeks',
    active: true,
    createdAt: now - 3 * DAY_MS,
  })
  await ctx.db.insert('messages', {
    accountId: adaId,
    author: 'operator',
    text: 'Focus on n8n error handling for two weeks',
    createdAt: now - 3 * DAY_MS,
  })
  await ctx.db.insert('messages', {
    accountId: adaId,
    author: 'account',
    text: 'Noted. From now on: "focus on n8n error handling for two weeks". The next posts and replies follow it.',
    createdAt: now - 3 * DAY_MS + 5_000,
  })
  const toldAt = now - 2 * DAY_MS
  const tellId = await ctx.db.insert('messages', {
    accountId: adaId,
    author: 'operator',
    text: "Remember that readers hate the word 'guys'",
    createdAt: toldAt,
  })
  const told = await rememberFromOperator(
    ctx,
    { _id: adaId },
    { kind: 'fact', text: "readers hate the word 'guys'", messageId: tellId, now: toldAt }
  )
  if (told.status !== 'stored') throw new Error(`the seeded fact was not stored: ${told.status}`)
  await ctx.db.insert('messages', {
    accountId: adaId,
    author: 'account',
    text: `I will remember that: "${told.text}" I read what I know before every post and reply.`,
    createdAt: toldAt + 3_000,
  })
  const ruled = await rememberFromOperator(
    ctx,
    { _id: adaId },
    { kind: 'rule', text: "never name a customer's company without asking", now: toldAt + HOUR_MS }
  )
  if (ruled.status !== 'stored') throw new Error(`the seeded rule was not stored: ${ruled.status}`)
}

/**
 * Signals the researcher would have found, each with when it was found and when it was posted, so freshness
 * reads like a real feed. Ada's three comments ask one question in different words, so her problem log has
 * one entry; her search suggestions and the fresh Reddit thread are this morning's. Max has one story.
 */
async function seedSignals(ctx: MutationCtx, ids: { adaId: Id<'accounts'>; maxId: Id<'accounts'>; now: number }): Promise<void> {
  const { adaId, maxId, now } = ids
  const signals: {
    accountId: Id<'accounts'>
    source: 'hackernews' | 'reddit' | 'comments' | 'search'
    title: string
    summary: string
    url: string
    score: number
    topics: string[]
    foundHoursAgo: number
    publishedHoursAgo: number
  }[] = [
    {
      accountId: adaId,
      source: 'reddit',
      title: 'n8n webhook fails silently when the client sends a form, how do I debug?',
      summary: 'r/n8n thread, 140 comments, most answers are about error workflows.',
      url: 'https://www.reddit.com/r/n8n/comments/example1',
      score: 92,
      topics: ['n8n', 'webhooks', 'debugging'],
      foundHoursAgo: 48,
      publishedHoursAgo: 50,
    },
    {
      accountId: adaId,
      source: 'hackernews',
      title: 'Ask HN: How do you get customer sign-off inside an automated pipeline?',
      summary: 'Thread about pausing workflows until a client approves a quote.',
      url: 'https://news.ycombinator.com/item?id=1',
      score: 81,
      topics: ['workflows', 'approvals', 'customers'],
      foundHoursAgo: 30,
      publishedHoursAgo: 40,
    },
    ...(
      [
        ['Can you show how to retry a failed webhook step?', 118],
        ['How do I retry a failed webhook step in n8n?', 70],
        ['Is there a way to retry the failed webhook step?', 18],
      ] as const
    ).map(([title, hoursAgo]) => ({
      accountId: adaId,
      source: 'comments' as const,
      title,
      summary: "Asked under one of Ada's posts on X.",
      url: 'https://x.com/ada_automates',
      score: 64,
      topics: ['n8n', 'webhooks'],
      foundHoursAgo: hoursAgo - 2,
      publishedHoursAgo: hoursAgo,
    })),
    {
      accountId: adaId,
      source: 'search',
      title: 'n8n error workflow',
      summary: 'People type "n8n error workflow" into Google.',
      url: 'https://www.google.com/search?q=n8n%20error%20workflow',
      score: 70,
      topics: ['n8n', 'error', 'workflow'],
      foundHoursAgo: 2,
      publishedHoursAgo: 2,
    },
    {
      accountId: adaId,
      source: 'reddit',
      title: 'n8n queue mode for webhooks: is it worth turning on?',
      summary: 'r/n8n thread from this morning, 60 comments and climbing.',
      url: 'https://www.reddit.com/r/n8n/comments/example2',
      score: 88,
      topics: ['n8n', 'webhooks'],
      foundHoursAgo: 2,
      publishedHoursAgo: 3,
    },
    {
      accountId: maxId,
      source: 'hackernews',
      title: 'Claude Code and MCP: the agent that files its own tickets',
      summary: 'MCP servers that let an agent act on real tools, with a long comment thread on safety.',
      url: 'https://news.ycombinator.com/item?id=2',
      score: 95,
      topics: ['ai agents', 'mcp', 'claude'],
      foundHoursAgo: 15,
      publishedHoursAgo: 20,
    },
  ]
  for (const [index, signal] of signals.entries()) {
    const { foundHoursAgo, publishedHoursAgo, ...row } = signal
    await ctx.db.insert('signals', {
      ...row,
      externalId: `seed-${index}`,
      status: 'new',
      foundAt: now - foundHoursAgo * HOUR_MS,
      publishedAt: now - publishedHoursAgo * HOUR_MS,
      mock: true,
    })
  }
}

/**
 * A post the operator posted on X at its slot, with the link they gave, and the snapshots the analyst took
 * after it: one a day for three days, or one so far for a post still in its window. A sponsored one carried
 * a tracked link that readers clicked.
 */
async function seedPostedPost(
  ctx: MutationCtx,
  account: Doc<'accounts'>,
  post: {
    concept: string
    pillar: string
    sponsorSegment: SponsorSegment
    plannedFor: string
    measured: boolean
    impressions: number
    follows: number
    clicks: number
    tag: string
    now: number
  }
): Promise<Id<'posts'>> {
  const postedAt = instantAt(post.plannedFor, account.publishHour, account.timezone)
  const parts = [
    `${post.concept}. ${account.name === 'Ada Automates' ? 'The fix is smaller than the problem.' : 'Here is where the agent broke.'}`,
  ]
  const externalId = xId('184', String(postedAt / 1000))
  const slug = `${post.concept
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)}-${post.tag}`
  const postId = await ctx.db.insert('posts', {
    accountId: account._id,
    slug,
    kind: 'text',
    intent: 'teach',
    length: 'medium',
    status: post.measured ? 'measured' : 'posted',
    concept: post.concept,
    title: post.concept,
    hook: postHook(parts),
    parts,
    sponsorSegment: post.sponsorSegment,
    plannedFor: post.plannedFor,
    scheduledAt: postedAt,
    signalIds: [],
    pillar: post.pillar,
    posted: { kind: 'linked', at: postedAt, url: `https://x.com/${account.handle}/status/${externalId}`, externalId },
    createdAt: postedAt - DAY_MS,
    updatedAt: postedAt,
  })
  if (post.sponsorSegment !== 'none') {
    // The tracked link the writer would have made, through the same path, at the end of what was posted.
    const link = await sponsorLinkOf(ctx, { _id: postId, slug, variantKey: undefined }, account, await workspaceOf(ctx, account))
    if (link.kind !== 'tracked') throw new Error('a seeded X post got no tracked link')
    const linkId = link.linkId
    await ctx.db.patch(postId, { sponsorLink: link.url, parts: parts.map((part) => `${part} ${link.url}`) })
    await ctx.db.patch(linkId, { clicks: post.clicks, createdAt: postedAt })
    for (let click = 0; click < post.clicks; click += 1) {
      await ctx.db.insert('linkClicks', {
        linkId,
        accountId: account._id,
        postId,
        at: postedAt + ((click + 1) * DAY_MS) / (post.clicks + 1),
      })
    }
  }
  const days = post.measured ? [1, 2, 3] : [1]
  for (const day of days) {
    const share = day / days.length
    const impressions = Math.round(post.impressions * share)
    const counts: ItemCounts = {
      platform: 'x',
      impressions,
      likes: Math.round(impressions * 0.03),
      replies: Math.round(impressions * 0.004),
      reposts: Math.round(impressions * 0.005),
      profileVisits: Math.round(impressions * 0.02),
      follows: Math.round(post.follows * share),
    }
    const takenAt = Math.min(post.now, postedAt + day * DAY_MS)
    await ctx.db.insert('metricSnapshots', { accountId: account._id, item: { kind: 'post', postId }, takenAt, counts, mock: true })
    await ctx.db.patch(postId, { numbers: { counts, readAt: takenAt, mock: true } })
  }
  return postId
}

/** A nineteen-digit X id from a prefix and a number, spelled out: an X id is past what a JavaScript number holds exactly. */
function xId(prefix: string, key: string): string {
  return `${prefix}${key.padStart(16, '0')}`
}

/** The account's followers as the analyst read them once a day for four weeks, climbing: the report's reach line. */
async function seedFollowers(
  ctx: MutationCtx,
  account: Doc<'accounts'>,
  line: { start: number; perDay: number; now: number }
): Promise<void> {
  for (let day = 27; day >= 0; day -= 1) {
    const followers = line.start + (27 - day) * line.perDay + (day % 3)
    await ctx.db.insert('accountSnapshots', {
      accountId: account._id,
      takenAt: line.now - day * DAY_MS,
      reach: { platform: 'x', followers },
      mock: true,
    })
  }
}

/** A post the writer wrote, waiting for the operator to post it by hand. */
async function seedDraft(
  ctx: MutationCtx,
  account: Doc<'accounts'>,
  draft: {
    concept: string
    pillar: string
    plannedFor: string
    kind: PostKind
    intent: PostIntent
    length: PostLength
    parts: string[]
    now: number
  }
): Promise<Id<'posts'>> {
  return ctx.db.insert('posts', {
    accountId: account._id,
    slug: `${draft.plannedFor}-draft`,
    kind: draft.kind,
    intent: draft.intent,
    length: draft.length,
    status: 'draft',
    concept: draft.concept,
    title: draft.concept,
    hook: postHook(draft.parts),
    parts: draft.parts,
    sponsorSegment: 'none',
    plannedFor: draft.plannedFor,
    scheduledAt: instantAt(draft.plannedFor, account.publishHour, account.timezone),
    signalIds: [],
    pillar: draft.pillar,
    createdAt: draft.now - DAY_MS,
    updatedAt: draft.now - DAY_MS,
  })
}

/**
 * Every table in the schema, so `reset` cannot forget one: adding a table
 * to schema.ts without adding it here is a type error.
 */
const TABLES = {
  workspaces: true,
  accounts: true,
  posts: true,
  accountPosts: true,
  accountCounts: true,
  metricSnapshots: true,
  accountSnapshots: true,
  links: true,
  linkClicks: true,
  conversions: true,
  probableConversions: true,
  replies: true,
  signals: true,
  experiments: true,
  journal: true,
  memories: true,
  directives: true,
  messages: true,
  connections: true,
  communities: true,
  comments: true,
  notifications: true,
  pushSubscriptions: true,
  checklistItems: true,
  jobs: true,
} satisfies Record<TableNames, true>

/**
 * Wipes the deployment so `run` seeds from nothing: every document in every
 * table, plus the pending scheduled functions (they would wake up to jobs
 * that no longer exist). One transaction, which fits a seed-sized
 * deployment; a deployment with more than a few thousand rows needs this in
 * batches.
 */
export const reset = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ deleted: number }> => {
    let deleted = 0
    for (const scheduled of await ctx.db.system.query('_scheduled_functions').collect()) {
      if (scheduled.state.kind === 'pending') await ctx.scheduler.cancel(scheduled._id)
    }
    for (const table of Object.keys(TABLES) as TableNames[]) {
      for (const row of await ctx.db.query(table).collect()) {
        await ctx.db.delete(row._id)
        deleted += 1
      }
    }
    return { deleted }
  },
})
