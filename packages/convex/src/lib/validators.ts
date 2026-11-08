import { v, type Infer, type Validator } from 'convex/values'
import {
  ACCOUNT_POST_SOURCES,
  AGENT_ROLES,
  CHECKLIST_STATUSES,
  CONVERSION_KINDS,
  PROBABLE_BASES,
  POST_STATUSES,
  EXPERIMENT_KINDS,
  EXPERIMENT_METRICS,
  EXPERIMENT_STATUSES,
  HABITS,
  JOB_KIND_LIST,
  JOB_STATUSES,
  JOURNAL_ACTORS,
  JOURNAL_KINDS,
  MEMORY_KINDS,
  MEMORY_STATUSES,
  OPERATOR_MEMORY_KINDS,
  PLATFORMS,
  FORUM_SOFTWARE,
  POST_INTENTS,
  POST_KINDS,
  POST_LENGTHS,
  HEARD_INTENTS,
  REPLY_ORIGINS,
  SELF_PROMOTION,
  REPLY_STATUSES,
  SIGNAL_SOURCES,
  SIGNAL_STATUSES,
  SPONSOR_SEGMENTS,
  COMMENT_STATUSES,
  NOTIFICATION_KINDS,
  NOTIFICATION_STATUSES,
} from '@influstep/shared'

/** One validator per shared enum, so the schema and the app read the same list. */
function literals<const T extends readonly string[]>(values: T): Validator<T[number]> {
  const [first, ...rest] = values.map((value) => v.literal(value))
  if (!first) throw new Error('literals() needs at least one value')
  if (rest.length === 0) return first as Validator<T[number]>
  return v.union(first, ...rest) as Validator<T[number]>
}

export const postStatusValidator = literals(POST_STATUSES)
export const commentStatusValidator = literals(COMMENT_STATUSES)
export const notificationKindValidator = literals(NOTIFICATION_KINDS)
export const notificationStatusValidator = literals(NOTIFICATION_STATUSES)

/** The operator's quiet hours (shared `QuietHours`). */
export const quietHoursValidator = v.object({ start: v.number(), end: v.number(), timezone: v.string() })

/** What one device made of a push (providers/notifier `PushOutcome`). */
export const pushOutcomeValidator = v.union(
  v.object({ kind: v.literal('sent') }),
  v.object({ kind: v.literal('recorded') }),
  v.object({ kind: v.literal('gone') }),
  v.object({ kind: v.literal('failed'), error: v.string() })
)
export const sponsorSegmentValidator = literals(SPONSOR_SEGMENTS)
export const platformValidator = literals(PLATFORMS)

/** The forum a forum account takes part on (shared `Forum`). */
export const forumValidator = v.object({ origin: v.string(), name: v.string(), software: literals(FORUM_SOFTWARE) })
export const agentRoleValidator = literals(AGENT_ROLES)
export const jobStatusValidator = literals(JOB_STATUSES)
export const jobKindValidator = literals(JOB_KIND_LIST)
export const signalSourceValidator = literals(SIGNAL_SOURCES)
export const signalStatusValidator = literals(SIGNAL_STATUSES)
export const experimentMetricValidator = literals(EXPERIMENT_METRICS)
export const experimentKindValidator = literals(EXPERIMENT_KINDS)
export const experimentStatusValidator = literals(EXPERIMENT_STATUSES)
export const checklistStatusValidator = literals(CHECKLIST_STATUSES)
export const conversionKindValidator = literals(CONVERSION_KINDS)
export const probableBasisValidator = literals(PROBABLE_BASES)
export const postKindValidator = literals(POST_KINDS)
export const postIntentValidator = literals(POST_INTENTS)
export const postLengthValidator = literals(POST_LENGTHS)
export const habitValidator = literals(HABITS)
export const accountPostSourceValidator = literals(ACCOUNT_POST_SOURCES)
export const journalKindValidator = literals(JOURNAL_KINDS)
export const actorValidator = literals(JOURNAL_ACTORS)
export const memoryKindValidator = literals(MEMORY_KINDS)
export const memoryStatusValidator = literals(MEMORY_STATUSES)
export const operatorMemoryKindValidator = literals(OPERATOR_MEMORY_KINDS)
export const replyOriginValidator = literals(REPLY_ORIGINS)
export const selfPromotionValidator = literals(SELF_PROMOTION)

/** A link to a thread the operator pasted, as the paste action read it (shared `ThreadLink`). */
export const threadLinkValidator = v.object({
  kind: v.literal('link'),
  url: v.string(),
  externalId: v.string(),
  author: v.union(v.string(), v.null()),
  community: v.union(v.string(), v.null()),
})

/** The classifier's read of a heard post (shared `HeardFit`). */
export const heardFitValidator = v.object({
  relevant: v.boolean(),
  intent: literals(HEARD_INTENTS),
  replyWorthy: v.boolean(),
  score: v.number(),
  confidence: v.number(),
  reason: v.string(),
})
export const replyStatusValidator = literals(REPLY_STATUSES)

const threadAuthorValidator = v.object({ handle: v.string(), name: v.string() })

/** The thread a reply answers (shared `ReplyThread`). */
const replyThreadFields = {
  url: v.string(),
  title: v.union(v.string(), v.null()),
  text: v.string(),
  postedAt: v.union(v.number(), v.null()),
  author: v.union(threadAuthorValidator, v.null()),
  reach: v.union(v.number(), v.null()),
  community: v.union(v.string(), v.null()),
}

export const replyThreadValidator = v.object(replyThreadFields)

/** A thread a post is drawn from, as the researcher found it: kept on the post, since its signal may be dismissed and age out. */
const basisThreadValidator = v.object({ signalId: v.id('signals'), title: v.string(), summary: v.string(), url: v.string() })

/** Another account's post a post reworks, as it went out: kept on the post, since the operator may edit or kill the original. */
const basisPostValidator = v.object({
  postId: v.id('posts'),
  placeName: v.string(),
  title: v.string(),
  text: v.string(),
  url: v.union(v.string(), v.null()),
})

/**
 * What a post is drawn from besides its pillar: a standout thread it is
 * modeled on, the questions about one pillar a round-up answers (shared
 * what-worked.ts), another account's post that brought users, reworked
 * for this platform (core/niche.ts `bestToRework`), or what the sponsor
 * just shipped, which every account announces on the day the operator picks
 * (core/launch.ts).
 */
export const postBasisValidator = v.union(
  v.object({ kind: v.literal('model'), thread: basisThreadValidator }),
  v.object({ kind: v.literal('roundup'), pillar: v.string(), questions: v.array(basisThreadValidator) }),
  v.object({ kind: v.literal('rework'), post: basisPostValidator }),
  v.object({ kind: v.literal('launch'), what: v.string() })
)
export type PostBasis = Infer<typeof postBasisValidator>

/** Whose words a judge_post job reads: the writer's draft, which a weak first reading sends back, or the operator's edit, which nothing sends back. */
export const judgedWordsValidator = v.union(v.literal('writer'), v.literal('operator'))
export type JudgedWords = Infer<typeof judgedWordsValidator>

const reasonValidator = v.union(v.string(), v.null())

/** The judge's reason for each engagement, null where the post gives none (shared `EngagementReasons`). */
export const engagementReasonsValidator = v.object({
  read: reasonValidator,
  comment: reasonValidator,
  like: reasonValidator,
  follow: reasonValidator,
})

/**
 * The judge's reading of a written post (shared judge.ts): the reason a
 * reader would read on, comment, like and follow, each null where the post
 * gives none, what would give the missing ones, and which judgment of the
 * post it is (the first may send a weak draft back to the writer).
 */
export const judgmentValidator = v.object({
  reasons: engagementReasonsValidator,
  fix: v.string(),
  round: v.number(),
  judgedAt: v.number(),
  mock: v.boolean(),
})
export type Judgment = Infer<typeof judgmentValidator>
export type BasisThread = Infer<typeof basisThreadValidator>

/** A thread the listener heard (shared `HeardThread`), as the listen action hands it to the mutation that keeps it. */
export const heardThreadValidator = v.object({
  ...replyThreadFields,
  postedAt: v.number(),
  author: threadAuthorValidator,
  origin: replyOriginValidator,
  externalId: v.string(),
  pillar: v.union(v.string(), v.null()),
  comments: v.union(v.number(), v.null()),
})

/** A comment or a mention the comment poll heard (core/comments.ts `HeardComment`). */
export const heardCommentValidator = v.object({
  ...replyThreadFields,
  postedAt: v.number(),
  author: threadAuthorValidator,
  origin: v.union(v.literal('comment'), v.literal('mention')),
  externalId: v.string(),
  pillar: v.union(v.string(), v.null()),
  comments: v.union(v.number(), v.null()),
})

/** What the writer made of a heard post (core/replies.ts `WrittenReply`). */
export const writtenReplyValidator = v.union(
  v.object({ kind: v.literal('reply'), text: v.string() }),
  v.object({ kind: v.literal('skip'), reason: v.string() })
)

/** What a platform shows of one posted item (shared `ItemCounts`). */
export const itemCountsValidator = v.union(
  v.object({ platform: v.literal('reddit'), score: v.number(), replies: v.union(v.number(), v.null()) }),
  v.object({ platform: v.literal('hackernews'), score: v.union(v.number(), v.null()), replies: v.number() }),
  v.object({
    platform: v.literal('x'),
    impressions: v.number(),
    likes: v.number(),
    replies: v.number(),
    reposts: v.number(),
    profileVisits: v.number(),
    follows: v.number(),
  }),
  v.object({ platform: v.literal('forum'), reads: v.number(), likes: v.number(), replies: v.number() })
)

/** How a post or a reply went out (shared `Posted`): said with no link, linked, or found by the match. */
export const postedValidator = v.union(
  v.object({ kind: v.literal('said'), at: v.number(), editShare: v.optional(v.number()) }),
  v.object({ kind: v.literal('linked'), at: v.number(), url: v.string(), externalId: v.string(), editShare: v.optional(v.number()) }),
  v.object({
    kind: v.literal('found'),
    at: v.number(),
    url: v.optional(v.string()),
    externalId: v.string(),
    editShare: v.optional(v.number()),
  })
)

/** A post's or a reply's numbers at the last read (shared `ItemRead`). */
export const itemReadValidator = v.object({
  counts: itemCountsValidator,
  readAt: v.number(),
  mock: v.boolean(),
  before: v.optional(itemCountsValidator),
})

/** An account's karma or followers (shared `AccountReach`). */
export const accountReachValidator = v.union(
  v.object({ platform: v.literal('reddit'), linkKarma: v.number(), commentKarma: v.number() }),
  v.object({ platform: v.literal('hackernews'), karma: v.number() }),
  v.object({ platform: v.literal('x'), followers: v.number() }),
  v.object({ platform: v.literal('forum'), likesReceived: v.number() })
)

/** The post or the reply a snapshot of numbers is of. */
export const itemRefValidator = v.union(
  v.object({ kind: v.literal('post'), postId: v.id('posts') }),
  v.object({ kind: v.literal('reply'), replyId: v.id('replies') })
)

/** An account's post cadence and reply budget (shared `XCadence`). Ranges, and each kind and intent once, are checked by core/formats.ts. */
export const xCadenceValidator = v.object({
  postsPerDay: v.number(),
  kinds: v.array(postKindValidator),
  intents: v.array(postIntentValidator),
  repliesPerDay: v.number(),
})

/**
 * The fields of an account's format on its platform (shared `PlatformFormat`),
 * spread into the account and its create and update args. Ranges are
 * checked by core/formats.ts.
 */
export const formatFields = {
  platform: platformValidator,
  publishHour: v.number(),
  cadence: xCadenceValidator,
}

/** The share of each post length (shared `LengthMix`). */
export const lengthMixValidator = v.object({ short: v.number(), medium: v.number(), long: v.number() })

/**
 * An X account's voice (shared `Voice`): the counted part from shared
 * `voiceStats`, the language, summary and traits the analyst wrote and the
 * operator edits (shared `voiceEditProblems` checks them).
 */
export const voiceValidator = v.object({
  language: v.string(),
  summary: v.string(),
  traits: v.array(v.string()),
  lengthMix: lengthMixValidator,
  emoji: habitValidator,
  hashtags: habitValidator,
  sampleSize: v.number(),
  learnedAt: v.number(),
})

/** Imported posts by where they came from (shared ACCOUNT_POST_SOURCES), every source present. */
export const accountSourceCountsValidator = v.object({ archive: v.number(), paste: v.number(), api: v.number(), mock: v.number() })

/** The voice counts over an account's originals (shared `VoiceCounts`): originals of each length, and those with an emoji or a hashtag. */
export const voiceCountsValidator = v.object({
  lengths: v.object({ short: v.number(), medium: v.number(), long: v.number() }),
  withEmoji: v.number(),
  withHashtag: v.number(),
})

/** One post of an account's history as the studio parsed it (shared `ImportedPost`). */
export const importedPostValidator = v.object({
  externalId: v.string(),
  parts: v.array(v.string()),
  postedAt: v.number(),
  likes: v.number(),
  reposts: v.number(),
  replies: v.number(),
  parentId: v.union(v.string(), v.null()),
  url: v.union(v.string(), v.null()),
  community: v.union(v.string(), v.null()),
  lang: v.union(v.string(), v.null()),
})

/** A post's parts as written, what the operator posts on X; shared `postProblems` says whether X takes them. */
export const postPartsValidator = v.array(v.string())

/** One arm of an experiment (shared `CatalogVariant`). */
export const variantValidator = v.object({
  key: v.string(),
  label: v.string(),
  description: v.string(),
  isControl: v.boolean(),
})

/**
 * How an experiment was decided. The winner's and the runner-up's rates at the
 * decision let the strategy review notice when the default stops beating what
 * it beat (shared `contradicts`), and the runner-up's key is what a re-test
 * runs against; an operator's override has none of them. Decisions from before
 * the key was stored have the rates without it.
 */
export const decisionValidator = v.object({
  winnerKey: v.string(),
  lift: v.number(),
  confidence: v.number(),
  note: v.string(),
  decidedAt: v.number(),
  byOperator: v.boolean(),
  winnerRate: v.optional(v.number()),
  runnerUpRate: v.optional(v.number()),
  runnerUpKey: v.optional(v.string()),
})

/** What an account does on one dimension since an experiment decided it (shared `StrategyDefault`). */
export const strategyDefaultValidator = v.object({
  kind: experimentKindValidator,
  key: v.string(),
  label: v.string(),
  description: v.string(),
  experimentId: v.optional(v.id('experiments')),
  since: v.number(),
})

/** A stored pillar weight. Read only through shared `pillarWeights`, which drops removed pillars and normalizes. */
export const pillarWeightValidator = v.object({ pillar: v.string(), weight: v.number() })

/**
 * An account's strategy, kept by the weekly review (core/strategy.ts) and by
 * decided experiments (core/experiments.ts).
 */
export const strategyValidator = v.object({
  pillarWeights: v.array(pillarWeightValidator),
  defaults: v.array(strategyDefaultValidator),
  reviewedAt: v.optional(v.number()),
})

/** One number behind a journal entry; the unit is in the label, so the value is always a plain number. */
export const journalNumberValidator = v.object({ label: v.string(), value: v.number() })

/**
 * What a checklist item's button does: send the operator to the Providers
 * page for a key, link a page the operator reads and acts on by hand (the
 * studio opens it in a new tab), or connect the item's account.
 */
export const checklistActionValidator = v.union(
  v.object({ kind: v.literal('set_provider_key'), key: v.string() }),
  v.object({ kind: v.literal('visit'), url: v.string() }),
  // Connect the item's account to its platform (shared `CONNECTED_PLATFORMS`).
  v.object({ kind: v.literal('connect_account') }),
  // Bring the account's posts in and learn its voice, on its voice page (core/checklist.ts).
  v.object({ kind: v.literal('learn_voice') })
)

/**
 * Where an account's connection stands: waiting for the operator at the
 * platform's consent page (with the state the callback must bring back),
 * connected with the refresh token the reader reads with, or revoked with
 * the reason. Only internal functions read the token.
 */
export const connectionStatusValidator = v.union(
  v.object({ kind: v.literal('pending'), state: v.string(), startedAt: v.number() }),
  v.object({
    kind: v.literal('connected'),
    refreshToken: v.string(),
    scopes: v.array(v.string()),
    username: v.string(),
    connectedAt: v.number(),
  }),
  v.object({ kind: v.literal('revoked'), error: v.string(), at: v.number() })
)

/** A probable conversion the analytics provider found (shared probable.ts): no UTM parameters, and a platform by what the person said or where they first came from. */
export const foundProbableValidator = v.object({
  platform: platformValidator,
  kind: conversionKindValidator,
  distinctId: v.string(),
  at: v.number(),
  basis: probableBasisValidator,
})

/**
 * A conversion the analytics provider found: it carries the tracked link's
 * UTM parameters and is matched to its post by campaign slug (ADR 0003).
 */
export const foundConversionValidator = v.object({
  kind: conversionKindValidator,
  distinctId: v.string(),
  at: v.number(),
  utm: v.object({
    source: v.string(),
    medium: v.optional(v.string()),
    campaign: v.optional(v.string()),
    content: v.optional(v.string()),
  }),
})
