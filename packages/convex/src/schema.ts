import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'
import {
  accountPostSourceValidator,
  accountReachValidator,
  itemRefValidator,
  itemCountsValidator,
  itemReadValidator,
  postedValidator,
  accountSourceCountsValidator,
  actorValidator,
  agentRoleValidator,
  checklistActionValidator,
  heardFitValidator,
  selfPromotionValidator,
  connectionStatusValidator,
  checklistStatusValidator,
  conversionKindValidator,
  decisionValidator,
  postBasisValidator,
  judgmentValidator,
  postPartsValidator,
  postKindValidator,
  postStatusValidator,
  commentStatusValidator,
  notificationKindValidator,
  notificationStatusValidator,
  quietHoursValidator,
  judgedWordsValidator,
  experimentKindValidator,
  experimentStatusValidator,
  jobKindValidator,
  jobStatusValidator,
  journalKindValidator,
  journalNumberValidator,
  memoryKindValidator,
  memoryStatusValidator,
  experimentMetricValidator,
  formatFields,
  forumValidator,
  platformValidator,
  probableBasisValidator,
  postIntentValidator,
  postLengthValidator,
  replyOriginValidator,
  replyStatusValidator,
  replyThreadValidator,
  signalSourceValidator,
  signalStatusValidator,
  sponsorSegmentValidator,
  strategyValidator,
  variantValidator,
  voiceCountsValidator,
  voiceValidator,
} from './lib/validators'

export default defineSchema({
  // One workspace today (the operator's). Accounts belong to it so a later
  // multi-tenant Influstep needs no migration.
  workspaces: defineTable({
    name: v.string(),
    sponsorName: v.string(),
    sponsorUrl: v.string(),
    // What the product does, in one sentence the writer says in its own words when an account mentions it.
    sponsorPitch: v.string(),
    // Public origin of the studio app, for tracked links.
    appUrl: v.string(),
    // What one paid conversion is worth to the sponsor, for the report's estimate.
    valuePerPaid: v.number(),
    currency: v.string(),
    // The operator's quiet hours, when nothing is pushed (shared notifications.ts); absent when they set none.
    quietHours: v.optional(quietHoursValidator),
  }),

  accounts: defineTable({
    workspaceId: v.id('workspaces'),
    name: v.string(),
    handle: v.string(),
    niche: v.string(),
    // Who the account talks to, asked for at onboarding (docs/plan.md, slice 13) and read by the writer.
    // Absent on an account created before onboarding asked for it.
    audience: v.optional(v.string()),
    tone: v.string(),
    bio: v.string(),
    // The account "bible": how it speaks, what it never says. Read by the writer.
    bible: v.string(),
    // How the account says it builds the sponsor (CONTEXT.md, "Affiliation line"); a draft naming the sponsor says it as written.
    affiliationLine: v.string(),
    pillars: v.array(v.string()),
    // The one platform the account takes part on, the local hour its posts start at, and its cadence (core/formats.ts).
    ...formatFields,
    // The forum a forum account takes part on, present on a forum account only: read through shared `placeOf`.
    forum: v.optional(forumValidator),
    // 0..1 share of posts that carry the sponsor (CONTEXT.md, "Sponsor dial").
    sponsorDial: v.number(),
    // The planner keeps the first N posts unsponsored so the account earns followers first.
    sponsorRampPosts: v.number(),
    paused: v.boolean(),
    timezone: v.string(),
    // How the X account this account took over writes, learned from its imported posts (accountPosts) and
    // edited by the operator. Absent until the analyst learns it, and again once the history is cleared.
    voice: v.optional(voiceValidator),
    // Pillar weights and the default per experiment dimension (docs/plan.md, v0.2 item 8). Absent until the
    // first decision or review; absent reads as equal pillar shares and every dimension's catalog control.
    strategy: v.optional(strategyValidator),
    createdAt: v.number(),
  })
    .index('by_workspace', ['workspaceId'])
    .index('by_platform', ['platform']),

  // One post on X, from its idea to its numbers (CONTEXT.md, "Post"). The writer writes it the day before it is due;
  // the operator posts it by hand and says so with its link, which is where its URL and id come from (ADR 0004).
  posts: defineTable({
    accountId: v.id('accounts'),
    slug: v.string(),
    // A text post or a thread (shared POST_KINDS).
    kind: postKindValidator,
    status: postStatusValidator,
    concept: v.string(),
    title: v.string(),
    // A post's first line (shared postHook), written only through it.
    hook: v.string(),
    // The post's parts, what the operator posts. Set once the post is written.
    parts: v.optional(postPartsValidator),
    // What the post sets out to do and how long it runs (shared post-mix.ts), set by the planner. A thread is always
    // long, a text post never is (core/posts.ts).
    intent: postIntentValidator,
    length: postLengthValidator,
    sponsorSegment: sponsorSegmentValidator,
    // Calendar day (YYYY-MM-DD in the account's timezone) and the instant the post is due.
    plannedFor: v.string(),
    scheduledAt: v.number(),
    signalIds: v.array(v.id('signals')),
    // What the post is drawn from besides its pillar: a standout it is modeled on, the questions a round-up answers, a
    // post of the account's it reworks (core/niche.ts), or what a launch announces (core/launch.ts); absent otherwise.
    basis: v.optional(postBasisValidator),
    // The judge's latest reading of its words (internal/judge.ts); absent until the judge read it.
    judgment: v.optional(judgmentValidator),
    pillar: v.optional(v.string()),
    // Where it is posted: a subreddit, or Hacker News's Ask, Show or front page; absent on X and LinkedIn.
    community: v.optional(v.string()),
    error: v.optional(v.string()),
    // Why it was skipped: its day passed before it was written, or the operator passed on it.
    skipReason: v.optional(v.string()),
    // When the writer wrote it; the match pairs it only with an item posted after (core/match.ts).
    writtenAt: v.optional(v.number()),
    // How it went out, once it did (shared Posted): the operator said so, gave its link, or the match found it. One
    // said with no link has no id, so the analyst has no numbers to read for it.
    posted: v.optional(postedValidator),
    // Its numbers at the analyst's last read in its measurement window; metricSnapshots keeps each read.
    numbers: v.optional(itemReadValidator),
    // When its community removed it, as its reader read it; the analyst reads it no more.
    removedAt: v.optional(v.number()),
    // The link to the sponsor a sponsored draft carries, as the writer was given it (core/links.ts).
    sponsorLink: v.optional(v.string()),
    // The variant of the post experiment that ran when it was planned (core/planner.ts).
    experimentId: v.optional(v.id('experiments')),
    variantKey: v.optional(v.string()),
    // The status a failed post failed from: a retry returns it there (shared POST_EVENTS).
    failedFrom: v.optional(postStatusValidator),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_account', ['accountId'])
    .index('by_experiment', ['experimentId'])
    .index('by_account_day', ['accountId', 'plannedFor'])
    .index('by_account_posted', ['accountId', 'posted.at'])
    .index('by_account_status', ['accountId', 'status'])
    .index('by_status', ['status'])
    .index('by_day', ['plannedFor']),

  // The history of the X account an account took over (docs/plan.md, slice 5): imported from the X archive,
  // pasted by the operator, or read from the timeline. Read only: importing never posts, likes or follows.
  // A self-thread is one row with its parts, root first. Example posts are the ones the writer imitates.
  accountPosts: defineTable({
    accountId: v.id('accounts'),
    // The X id of the post (a thread's root), or `paste-<hash>` for a pasted post; unique per account.
    externalId: v.string(),
    parts: v.array(v.string()),
    postedAt: v.number(),
    likes: v.number(),
    reposts: v.number(),
    replies: v.number(),
    // Likes plus reposts (core/history.ts, engagementOf), stored so the top posts are read through an index.
    // Set once on import: a stored post is never overwritten, so its counts never change.
    engagement: v.number(),
    // What it answers, as its platform writes the id; absent on an original. A reader's items also keep their link
    // and community, which an archived or pasted post does not know.
    parentId: v.optional(v.string()),
    url: v.optional(v.string()),
    community: v.optional(v.string()),
    // Whether it answers someone else's post (parentId is set), stored for the indexes; the voice is learned from
    // the rest (the originals).
    isReply: v.boolean(),
    // The language X detected; absent when it could not tell.
    lang: v.optional(v.string()),
    source: accountPostSourceValidator,
    example: v.boolean(),
    importedAt: v.number(),
  })
    .index('by_account_posted', ['accountId', 'postedAt'])
    .index('by_account_external', ['accountId', 'externalId'])
    .index('by_account_example', ['accountId', 'example'])
    // The originals (isReply false) most engaging first, and newest first: the top posts and what the analyst reads.
    .index('by_account_reply_engagement', ['accountId', 'isReply', 'engagement', 'postedAt'])
    .index('by_account_reply_posted', ['accountId', 'isReply', 'postedAt']),

  // What an account's imported history counts, kept as posts are imported and deleted (core/history.ts), so
  // the totals and the voice are read from one row and never from every post. One row per account that
  // holds imported posts: none before the first import, and none once Clear history is done.
  accountCounts: defineTable({
    accountId: v.id('accounts'),
    // Every imported post by where it came from; together, all of them.
    bySource: accountSourceCountsValidator,
    // The account's own posts counted for the voice (shared VoiceCounts); together, the originals.
    originals: voiceCountsValidator,
    // Clear history is deleting the posts a page at a time; importing and learning the voice wait until it is done.
    clearing: v.boolean(),
  }).index('by_account', ['accountId']),

  // Each read of a posted item's numbers in its measurement window: how its reach grew, day by day, for the report's
  // trend. The post or reply keeps the latest.
  metricSnapshots: defineTable({
    accountId: v.id('accounts'),
    item: itemRefValidator,
    takenAt: v.number(),
    counts: itemCountsValidator,
    mock: v.boolean(),
  }).index('by_account_time', ['accountId', 'takenAt']),

  // Each read of an account's karma or followers: the report's reach line.
  accountSnapshots: defineTable({
    accountId: v.id('accounts'),
    takenAt: v.number(),
    reach: accountReachValidator,
    mock: v.boolean(),
  }).index('by_account_time', ['accountId', 'takenAt']),

  // A tracked link (core/links.ts): a sponsored post's, sending readers to the sponsor's website as it was when the post
  // was written, or the account's bio link, which names no post and sends readers to the website as it is now.
  links: defineTable(
    v.union(
      v.object({
        kind: v.literal('post'),
        slug: v.string(),
        accountId: v.id('accounts'),
        postId: v.id('posts'),
        target: v.string(),
        clicks: v.number(),
        createdAt: v.number(),
      }),
      v.object({ kind: v.literal('bio'), slug: v.string(), accountId: v.id('accounts'), clicks: v.number(), createdAt: v.number() })
    )
  )
    .index('by_slug', ['slug'])
    .index('by_account_kind', ['accountId', 'kind'])
    .index('by_post', ['postId']),

  linkClicks: defineTable({
    linkId: v.id('links'),
    accountId: v.id('accounts'),
    postId: v.optional(v.id('posts')),
    at: v.number(),
    referrer: v.optional(v.string()),
    country: v.optional(v.string()),
  })
    .index('by_link', ['linkId'])
    .index('by_account_time', ['accountId', 'at']),

  conversions: defineTable({
    accountId: v.id('accounts'),
    postId: v.optional(v.id('posts')),
    variantKey: v.optional(v.string()),
    kind: conversionKindValidator,
    distinctId: v.string(),
    at: v.number(),
    mock: v.boolean(),
  })
    .index('by_account_time', ['accountId', 'at'])
    .index('by_distinct', ['distinctId', 'kind']),

  // A sponsor's conversion with no UTM parameters that is probably a platform's (shared probable.ts): it names the
  // platform, never an account or a post, so the report shows it apart and no experiment reads it.
  probableConversions: defineTable({
    platform: platformValidator,
    basis: probableBasisValidator,
    kind: conversionKindValidator,
    distinctId: v.string(),
    at: v.number(),
    mock: v.boolean(),
  })
    .index('by_platform_time', ['platform', 'at'])
    .index('by_distinct', ['distinctId', 'kind']),

  signals: defineTable({
    accountId: v.id('accounts'),
    source: signalSourceValidator,
    externalId: v.string(),
    title: v.string(),
    url: v.string(),
    summary: v.string(),
    score: v.number(),
    topics: v.array(v.string()),
    status: signalStatusValidator,
    foundAt: v.number(),
    // When the source says the item was posted. Freshness (shared `signalFreshness`) decays from it, and from
    // foundAt when a source does not say.
    publishedAt: v.optional(v.number()),
    mock: v.boolean(),
  })
    .index('by_account_status', ['accountId', 'status'])
    .index('by_account_external', ['accountId', 'source', 'externalId'])
    .index('by_found', ['foundAt']),

  experiments: defineTable({
    accountId: v.id('accounts'),
    name: v.string(),
    hypothesis: v.string(),
    kind: experimentKindValidator,
    metric: experimentMetricValidator,
    variants: v.array(variantValidator),
    status: experimentStatusValidator,
    // The items each variant needs before the analyst decides (shared `decideExperiment`).
    minItems: v.number(),
    minConfidence: v.number(),
    decision: v.optional(decisionValidator),
    // Who set it up: the analyst's strategy review or the operator. Absent on rows from before the review
    // existed, which the operator made.
    createdBy: v.optional(actorValidator),
    // A re-test of a default that stopped beating what it beat: the experiment that made it the default.
    retestOf: v.optional(v.id('experiments')),
    createdAt: v.number(),
  }).index('by_account_status', ['accountId', 'status']),

  // Every change to an account's strategy, by the review or the operator, with why and the numbers behind it
  // (core/strategy.ts, core/experiments.ts). Never edited; the strategy page reads it newest first.
  journal: defineTable({
    accountId: v.id('accounts'),
    kind: journalKindValidator,
    actor: actorValidator,
    // What changed, one sentence.
    text: v.string(),
    // Why, with the numbers.
    reason: v.string(),
    evidence: v.object({
      experimentId: v.optional(v.id('experiments')),
      postIds: v.array(v.id('posts')),
      // The signals a last check swapped between (core/research.ts); empty on every other entry.
      signalIds: v.array(v.id('signals')),
      numbers: v.array(journalNumberValidator),
    }),
    createdAt: v.number(),
  }).index('by_account_time', ['accountId', 'createdAt']),

  // What an account knows (shared memory.ts): learnings from decided experiments and from the strategy review's
  // changes, the morning's research brief, the problems it met, the operator's facts and rules, and the goal note
  // each review leaves. A newer entry on the same subject supersedes the older one, and the operator can retire a
  // fact, a rule or a problem; either way the row stays, so the memory page can show what changed.
  memories: defineTable({
    accountId: v.id('accounts'),
    kind: memoryKindValidator,
    text: v.string(),
    // Who wrote it: the analyst (learnings, goal notes), the researcher (briefs, problems) or the operator (facts,
    // rules, and the learning of an experiment they decided themselves).
    actor: actorValidator,
    dimension: v.optional(experimentKindValidator),
    evidence: v.object({
      experimentId: v.optional(v.id('experiments')),
      postIds: v.array(v.id('posts')),
      // The signals a brief names or a problem was logged from; empty on a learning.
      signalIds: v.array(v.id('signals')),
      // The operator's chat message a fact or a rule was told in; absent on one added on the memory page.
      messageId: v.optional(v.id('messages')),
    }),
    // A learning's 0..1: the decision's confidence, or 1 for the operator's own verdict. Every other entry has none.
    confidence: v.optional(v.number()),
    // A brief's: the writer never reads it after this.
    expiresAt: v.optional(v.number()),
    // What a newer entry of the same kind replaces it by. A problem's dedup key: `question:<tokens>`. A review
    // learning's subject: `pillars`.
    key: v.optional(v.string()),
    status: memoryStatusValidator,
    supersededBy: v.optional(v.id('memories')),
    // When the operator retired it.
    retiredAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index('by_account_status', ['accountId', 'status'])
    .index('by_account_kind_status', ['accountId', 'kind', 'status']),

  // Replies (shared replies.ts): one row per thread the listener heard or the operator pasted, answered or passed
  // on. A written reply waits as a draft until the operator posts it by hand and says so. Never deleted.
  replies: defineTable({
    accountId: v.id('accounts'),
    origin: replyOriginValidator,
    // The platform's id of the post or comment it answers; one row per thread per account, so nothing is answered twice.
    inReplyTo: v.string(),
    thread: replyThreadValidator,
    // The pillar a search matched the post on; absent on a mention or a reply.
    pillar: v.optional(v.string()),
    // The classifier's read of the post when the listener heard it; Today ranks drafts by it (docs/plan.md, slice 7).
    fit: heardFitValidator,
    // The reply experiment that gave it a variant when it was heard, and which; a reply heard in none carries neither.
    experimentId: v.optional(v.id('experiments')),
    variantKey: v.optional(v.string()),
    status: replyStatusValidator,
    // The reply as written, then as the operator edited it; empty until the writer writes it, and on a post passed on.
    text: v.string(),
    // Why it was passed on: the writer's reason, the rule it broke, the sponsor filter, a stale draft or the operator.
    skipReason: v.optional(v.string()),
    // The operator asked for this reply (Write a reply on a skipped post), so it may name the sponsor.
    operatorAsked: v.boolean(),
    heardAt: v.number(),
    // When the writer wrote it: the reply budget counts these per local day.
    writtenAt: v.optional(v.number()),
    // How it went out, once it did (shared Posted): the operator said so, gave its link, or the match found it, and
    // then its text is the platform's.
    posted: v.optional(postedValidator),
    // When the operator last copied the draft or opened its thread; the match orders its candidates by it (docs/plan.md, slice 5).
    openedAt: v.optional(v.number()),
    // Its numbers at the analyst's last read in its measurement window; metricSnapshots keeps each read.
    numbers: v.optional(itemReadValidator),
    // When its community removed it, as its reader read it; the analyst reads it no more.
    removedAt: v.optional(v.number()),
    mock: v.boolean(),
  })
    .index('by_account_status', ['accountId', 'status'])
    .index('by_experiment', ['experimentId'])
    .index('by_account_target', ['accountId', 'inReplyTo'])
    .index('by_account_written', ['accountId', 'writtenAt'])
    .index('by_account_posted', ['accountId', 'posted.at'])
    .index('by_status_heard', ['status', 'heardAt']),

  // Someone's answer under one of the account's posts or replies, or a mention of the account (shared comments.ts).
  // A fresh one gets an answer: a reply whose inReplyTo is this comment's externalId.
  comments: defineTable({
    accountId: v.id('accounts'),
    // The platform's id of the comment; one row per comment per account.
    externalId: v.string(),
    // The account's item it answers, by the platform's id; absent on a mention.
    inReplyTo: v.optional(v.string()),
    author: v.object({ handle: v.string(), name: v.string() }),
    text: v.string(),
    url: v.string(),
    // Where it was said, so its answer is written under that community's rules; absent where the platform has none.
    community: v.optional(v.string()),
    postedAt: v.number(),
    status: commentStatusValidator,
    heardAt: v.number(),
    mock: v.boolean(),
  })
    .index('by_account_external', ['accountId', 'externalId'])
    .index('by_account_status', ['accountId', 'status'])
    .index('by_account_posted', ['accountId', 'postedAt'])
    // The comments under one of the account's items: the Posted page's threads.
    .index('by_account_parent', ['accountId', 'inReplyTo']),

  // What the notifier pushed, or holds until the operator's quiet hours end (core/notifications.ts). Today's in-app
  // list reads it; in mock mode it is all there is.
  notifications: defineTable({
    kind: notificationKindValidator,
    // The account a comment notification is about; absent on the morning digest, which is about all of them.
    accountId: v.optional(v.id('accounts')),
    commentIds: v.array(v.id('comments')),
    title: v.string(),
    body: v.string(),
    url: v.string(),
    tag: v.string(),
    // When it may be pushed: when it was made, or the end of the quiet hours it was made in.
    dueAt: v.number(),
    status: notificationStatusValidator,
    // When a push run claimed it (status sending); a claim left standing by a run that died is taken back.
    claimedAt: v.optional(v.number()),
    // How many devices it reached once pushed, and what failed.
    devices: v.number(),
    sentAt: v.optional(v.number()),
    error: v.optional(v.string()),
    mock: v.boolean(),
  })
    .index('by_status_due', ['status', 'dueAt'])
    .index('by_tag', ['tag']),

  // One row per device the operator turned notifications on in (the browser's push subscription).
  pushSubscriptions: defineTable({
    endpoint: v.string(),
    p256dh: v.string(),
    auth: v.string(),
    // The device as the studio named it, e.g. "Chrome on macOS".
    label: v.string(),
    createdAt: v.number(),
    lastOkAt: v.optional(v.number()),
  }).index('by_endpoint', ['endpoint']),

  directives: defineTable({
    accountId: v.id('accounts'),
    text: v.string(),
    active: v.boolean(),
    createdAt: v.number(),
    withdrawnAt: v.optional(v.number()),
  }).index('by_account_active', ['accountId', 'active']),

  messages: defineTable({
    accountId: v.id('accounts'),
    author: v.union(v.literal('operator'), v.literal('account')),
    text: v.string(),
    // The directive the operator's message became, and on the account's reply the one it confirms.
    directiveId: v.optional(v.id('directives')),
    // On an account's reply: the post a chat change touched or created, and the job a chat task queued.
    postId: v.optional(v.id('posts')),
    jobId: v.optional(v.id('jobs')),
    createdAt: v.number(),
  }).index('by_account', ['accountId']),

  // One row per account on a platform that reads it only once the operator lets it (shared `CONNECTED_PLATFORMS`).
  // Kept apart from accounts, so no query that lists accounts ever sends a token to the studio.
  connections: defineTable({
    accountId: v.id('accounts'),
    status: connectionStatusValidator,
    // Connected in mock mode: no token was exchanged, and the mock reader reads as if it were.
    mock: v.boolean(),
  }).index('by_account', ['accountId']),

  // A subreddit or Hacker News where an account takes part: met by the listener, with its rules as last read.
  communities: defineTable({
    accountId: v.id('accounts'),
    // As its platform names it: `n8n` for r/n8n, `Ask HN` on Hacker News (shared `communityLabel`).
    name: v.string(),
    rulesText: v.string(),
    // The classifier's read of the rules, and why.
    selfPromotion: selfPromotionValidator,
    reason: v.string(),
    // How much the strategy weighs it; 1 when met (docs/plan.md, slice 10).
    weight: v.number(),
    // When its moderators removed one of the account's items (core/communities.ts `recordRemoval`): the plan and the listener
    // leave it out until the operator ticks off the checklist item that asks them to look.
    removedAt: v.optional(v.number()),
    rulesReadAt: v.number(),
  }).index('by_account_name', ['accountId', 'name']),

  checklistItems: defineTable({
    accountId: v.id('accounts'),
    postId: v.optional(v.id('posts')),
    // The community a removal asks the operator to look at; ticking the item off takes it back (core/communities.ts).
    communityId: v.optional(v.id('communities')),
    title: v.string(),
    why: v.string(),
    status: checklistStatusValidator,
    action: v.optional(checklistActionValidator),
    createdAt: v.number(),
    doneAt: v.optional(v.number()),
  })
    .index('by_status', ['status'])
    .index('by_account_status', ['accountId', 'status'])
    .index('by_post', ['postId']),

  jobs: defineTable({
    kind: jobKindValidator,
    role: agentRoleValidator,
    status: jobStatusValidator,
    accountId: v.id('accounts'),
    postId: v.optional(v.id('posts')),
    // The operator's chat message that asked for this job: set on a chat task (shared CHAT_TASKS).
    messageId: v.optional(v.id('messages')),
    // What a job needs beyond its account and post: the week a plan_week plans, the topic a chat task was asked on, and
    // whose words a judge_post reads.
    weekStart: v.optional(v.string()),
    topic: v.optional(v.string()),
    wordsBy: v.optional(judgedWordsValidator),
    result: v.optional(v.any()),
    error: v.optional(v.string()),
    attempts: v.number(),
    createdAt: v.number(),
    startedAt: v.optional(v.number()),
    finishedAt: v.optional(v.number()),
  })
    .index('by_status', ['status'])
    // Each agent's queue on the Agents page: one role's jobs in one status, oldest first.
    .index('by_role_status', ['role', 'status'])
    .index('by_account', ['accountId'])
    // The account's newest job of one kind, such as its last strategy review, however many other jobs came since.
    .index('by_account_kind', ['accountId', 'kind'])
    .index('by_post', ['postId']),
})
