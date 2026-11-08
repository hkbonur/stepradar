import {
  SHORT_POST_MAX,
  THREAD_PARTS_MAX,
  THREAD_PARTS_MIN,
  X_POST_LIMIT,
  type ChatIntent,
  type ChatTask,
  type PostIntent,
  type PostKind,
  type AccountProposal,
  type PostLength,
  type ReplyOrigin,
  type SignalSource,
  type Voice,
  type VoiceStats,
  type Weekday,
  type Platform,
  type ReplyThread,
  type Engagement,
  type EngagementReasons,
} from '@influstep/shared'
import type { WriterMemory } from '../../core/memory'
import type { Funnel } from '../../core/report'
import type { PostBasis } from '../../lib/validators'

/**
 * What the researcher has for the writer: this morning's brief, null when
 * no sweep wrote one or it expired, and the account's open problems, newest
 * first. Both are the account's own words.
 */
export interface WriterResearch {
  brief: string | null
  problems: string[]
}

/** The account as every brief carries it. */
export interface AccountBrief {
  name: string
  handle: string
  platform: Platform
  /** Where it takes part, as the operator reads it: the platform's name, or a forum's (shared `placeLabel`). */
  placeName: string
  niche: string
  /** Who the account talks to; none on an account created before onboarding asked. */
  audience?: string
  tone: string
  bible: string
  pillars: string[]
}

/** A signal a draft reacts to, as the writer reads it. */
export interface BriefSignal {
  title: string
  summary: string
  url: string
}

/** What a post is drawn from besides its pillar (core/niche.ts), as the post keeps it. */
export type BriefBasis = PostBasis

/**
 * What the operator posted lately (core/history.ts `postedLately`), for the
 * writer to move toward: the last texts in the words that went out, newest
 * first, and how much of its drafts the operator changed on average, where
 * that is kept (X and LinkedIn); null elsewhere or before any.
 */
export interface PostedLately {
  texts: string[]
  editShare: number | null
}

/**
 * What the writer asks of a language model for a post on X. Both adapters
 * return the same shape, so the pipeline never knows which one answered. The
 * limit is X's, weighed the way X weighs it (xLength), and holds for every
 * part: the operator posts the parts as written.
 */
export interface PostBrief {
  account: AccountBrief
  kind: PostKind
  concept: string
  pillar: string
  /** The sponsor the post names, with the link it carries exactly as given (core/links.ts); null when it names none. */
  sponsor: { link: string } | null
  sponsorName: string
  /** What the sponsor does, in the operator's one sentence; the writer says it in its own words. */
  sponsorPitch: string
  memory: WriterMemory
  directives: string[]
  signals: BriefSignal[]
  /** The standout thread the post is modeled on, or the questions it rounds up; null for any other post. */
  basis: BriefBasis | null
  research: WriterResearch
  /** Where it is posted, with that community's rules as the listener read them; null on X and LinkedIn. Its limits are its platform's (shared post-rules.ts). */
  community: { name: string; rules: string | null } | null
  /** Said as written when the post names the sponsor (core/disclosure.ts, rule 1). */
  affiliationLine: string
  /** What the post sets out to do and how long it runs, as the planner chose them. */
  intent: PostIntent
  length: PostLength
  /** How the post opens and how it ends (the hook and call to action dimensions): the variant a post experiment gave it, else the default, else the catalog's control. */
  hook: BriefVariant
  callToAction: BriefVariant
  /** The account's learned voice; null until the analyst learns one, and the post is written in English in the bible's tone. */
  voice: Pick<Voice, 'language' | 'summary' | 'traits' | 'emoji' | 'hashtags'> | null
  /** The account's own example posts, each as its parts, verbatim: style to imitate, never words to copy. */
  examples: string[][]
  /** The posts the operator posted lately. */
  posted: PostedLately
  /** What was wrong with the previous draft, on the one retry; empty on the first try. */
  problems: string[]
  /** The judge's reading of the last draft when it found too few reasons to engage, so this one gives them; null otherwise. */
  judged: { missing: Engagement[]; fix: string } | null
}

/** A written post as the judge reads it (internal/judge.ts): the post itself, its place and who it is for. */
export interface JudgeBrief {
  account: AccountBrief
  intent: PostIntent
  title: string
  parts: string[]
  /** Where it is posted, a subreddit or Hacker News; null on X and LinkedIn. */
  community: string | null
}

/** The judge's reasons, from the reader's side, each null where the post gives none, and what would give the missing ones. */
export interface JudgeDraft {
  reasons: EngagementReasons
  fix: string
}

/** What each length asks of the writer, in the words the prompt and a rejected draft both use. */
export const POST_LENGTH_TARGETS: Record<PostLength, string> = {
  short: `a one-liner: one part of at most ${SHORT_POST_MAX} characters`,
  medium: `a full post: one part of more than ${SHORT_POST_MAX} and at most ${X_POST_LIMIT} characters`,
  long: `a thread of ${THREAD_PARTS_MIN} to ${THREAD_PARTS_MAX} parts`,
}

export interface PostDraft {
  /** A short name for the calendar; X shows no title. */
  title: string
  /** The parts as the operator posts them. */
  parts: string[]
}

/** A variant the writer follows on one dimension, as shared `effectiveVariant` resolves it; the description reads after "From now on I". */
export interface BriefVariant {
  key: string
  label: string
  description: string
}

/**
 * What the writer asks of a language model for a reply: the thread it
 * answers on the account's platform, in the platform's shape, inside the
 * bible, the voice, the directives, the community's rules and the account's
 * memory, whose rules may tell it to pass on the thread.
 */
export interface ReplyBrief {
  account: AccountBrief
  /** Where the reply goes: the draft's shape and length are the platform's (shared `PLATFORM_DRAFT_SHAPES`, `REPLY_LIMITS`). */
  platform: Platform
  origin: ReplyOrigin
  thread: ReplyThread
  /** The pillar a search matched the thread on; null for a mention, a comment or a paste. */
  pillar: string | null
  sponsorName: string
  /** What the sponsor does, in the operator's one sentence; the writer says it in its own words. */
  sponsorPitch: string
  /** Said as written whenever the draft names the sponsor (core/disclosure.ts, rule 1). */
  affiliationLine: string
  /** Whether the draft may name the sponsor at all: its community allows it and the dial has room (core `mayNameSponsor`). */
  mayNameSponsor: boolean
  /** The thread's community, by its name on the platform, and its rules as the listener read them; null where it has none. */
  community: { name: string; rules: string } | null
  /**
   * The operator asked for this reply (Write a reply on a post it passed on):
   * it is written whatever the rules say, and it may answer about the sponsor
   * when the post asks.
   */
  operatorAsked: boolean
  /**
   * How the reply answers (the reply style dimension): the variant a reply
   * style experiment gave it, else the account's default, else the catalog's
   * control, a tip. The description reads after "From now on I".
   */
  style: BriefVariant
  /** How long the reply runs (the reply length dimension), resolved the same way. */
  length: BriefVariant
  memory: WriterMemory
  directives: string[]
  voice: PostBrief['voice']
  /** The replies the operator posted lately. */
  posted: PostedLately
  /** What was wrong with the previous draft, on the one retry; empty on the first try. */
  problems: string[]
}

/** The reply as the operator posts it, or the writer's reason to pass on the post, in the account's words. */
export type ReplyDraft = { kind: 'reply'; text: string } | { kind: 'skip'; reason: string }

/** One of the account's own posts as the analyst reads it. */
export interface AccountPostSample {
  parts: string[]
  /** X's language tag for the post; null when X could not tell. */
  lang: string | null
  likes: number
  reposts: number
}

/**
 * What the analyst asks of a language model to learn an account's voice.
 * Everything countable is counted in code first (`stats`); the model writes
 * only the language, the summary and the traits.
 */
export interface VoiceBrief {
  account: AccountBrief
  stats: VoiceStats
  /** The originals with the most likes plus reposts, best first. */
  top: AccountPostSample[]
  /** The newest originals not already in `top`, newest first. */
  newest: AccountPostSample[]
}

export interface VoiceDraft {
  /** A BCP 47 tag such as `en`, `nb`, `tr`. */
  language: string
  summary: string
  /** One to VOICE_TRAITS_MAX recurring moves, each a short phrase. */
  traits: string[]
}

/** What the writer reads to propose how one of the operator's accounts sounds and what it covers, at onboarding. */
export interface ProposalBrief {
  platform: Platform
  /** Where it takes part: the platform's name, or a forum's (shared `placeLabel`). */
  placeName: string
  /** The account's name, as the operator gave it. */
  name: string
  niche: string
  audience: string
  sponsorName: string
  /** What the sponsor does, in the operator's one sentence; the writer says it in its own words. */
  sponsorPitch: string
  /** The accounts the workspace already runs, so a new one does not repeat their angle. */
  roster: { name: string; handle: string; platform: Platform; niche: string }[]
}

export interface ChatTurn {
  author: 'operator' | 'account'
  text: string
}

/** One post a chat message may change (core `changeablePlan`), as the interpreter reads it. */
export interface PlanRow {
  id: string
  weekday: Weekday
  /** The local day it is planned for, YYYY-MM-DD in the account's timezone. */
  plannedFor: string
  kind: PostKind
  title: string
  pillar: string | null
  /** The status as the operator reads it (POST_STATUS_LABELS). */
  status: string
}

export interface InterpretArgs {
  account: AccountBrief
  /** The chat before the message, oldest first. */
  history: ChatTurn[]
  plan: PlanRow[]
  /** The operator's message to read. */
  text: string
}

/** A signal as a task report reads it; a comment is a signal whose title is the comment's text. */
export interface TaskSignal {
  source: SignalSource
  title: string
  summary: string
  url: string
  topics: string[]
}

/** What each chat task is written from. Code reads and counts it; the model only puts it in words. */
interface TaskData {
  research_brief: { signals: TaskSignal[] }
  /** The most liked comments of the window, most liked first; `total` counts every comment in it. */
  comment_digest: { days: number; total: number; comments: TaskSignal[] }
  /** `reachLabel` names what the account's platform counts as reach: points, a score, impressions. */
  analytics_summary: { days: number; funnel: Funnel; reachLabel: string; currency: string }
}

/** One member per task, so narrowing on `task` narrows `data` with it. */
export type TaskReportArgs = {
  [Task in ChatTask]: { account: AccountBrief; task: Task; topic: string | null; data: TaskData[Task] }
}[ChatTask]

export interface LlmProvider {
  readonly name: string
  writePost(brief: PostBrief): Promise<PostDraft>
  /** Why a reader would read on, comment, like and follow a written post, from how people read and act (shared judge.ts). */
  judgePost(brief: JudgeBrief): Promise<JudgeDraft>
  writeReply(brief: ReplyBrief): Promise<ReplyDraft>
  learnVoice(brief: VoiceBrief): Promise<VoiceDraft>
  /** A new account for a niche and an audience, which the operator edits before it is created. */
  proposeAccount(brief: ProposalBrief): Promise<AccountProposal>
  /** The account's reply in its own chat; `directive` is set when the message was stored as one. */
  reply(args: { account: AccountBrief; history: ChatTurn[]; directive?: string }): Promise<string>
  /** What an operator's chat message asks for; `conversation` when it asks for no change and no task. */
  interpret(args: InterpretArgs): Promise<ChatIntent>
  /** A chat task's answer in the account's voice, from the data alone. */
  taskReport(args: TaskReportArgs): Promise<string>
}
