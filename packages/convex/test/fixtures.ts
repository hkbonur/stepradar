import {
  DEFAULT_FORMATS,
  JOB_KINDS,
  type PostStatus,
  type JobKind,
  type JobStatus,
  type PostKind,
  type ReplyOrigin,
  type SignalSource,
  type SignalStatus,
  type SponsorSegment,
  type Platform,
  type HeardFit,
  type ItemCounts,
  type Forum,
} from '@influstep/shared'
import type { Doc, Id } from '../src/_generated/dataModel'
import type { MutationCtx } from '../src/_generated/server'
import { instantAt } from '../src/core/dates'

/**
 * Rows for tests of the core rules that need a database but not the whole
 * seed: one workspace, one account, and posts and jobs at exactly the
 * status a test names. Every row is inserted as it is, so no
 * rule runs and nothing is scheduled.
 */

export const TIMEZONE = 'Europe/Oslo'

/** How the classifier read a fixture reply's post: on topic and worth an answer. */
export const HEARD_FIT: HeardFit = {
  relevant: true,
  intent: 'question',
  replyWorthy: true,
  score: 0.8,
  confidence: 0.7,
  reason: 'about the niche',
}

/** The n8n Community as the setup finds it: a Discourse forum, read by the forum reader. */
export const N8N_FORUM: Forum = { origin: 'https://community.n8n.io', name: 'n8n Community', software: 'discourse' }

/** The local hour every fixture post is due at (X's default). */
export const POST_HOUR = DEFAULT_FORMATS.x.publishHour

export async function insertAccount(
  ctx: MutationCtx,
  fields: { name?: string; handle?: string; platform?: Platform; forum?: Forum } = {}
): Promise<Doc<'accounts'>> {
  const workspaceId = await ctx.db.insert('workspaces', {
    name: 'Formstep',
    sponsorName: 'Formstep',
    sponsorUrl: 'https://formstep.io',
    sponsorPitch: 'Forms that workflows and AI agents send to one customer; the answers come back into the flow.',
    appUrl: 'http://localhost:3300',
    valuePerPaid: 29,
    currency: 'EUR',
  })
  const accountId = await ctx.db.insert('accounts', {
    workspaceId,
    name: fields.name ?? 'Ada Automates',
    handle: fields.handle ?? 'ada_automates',
    niche: 'n8n',
    tone: 'calm',
    bio: '',
    bible: '',
    affiliationLine: "I'm building Formstep, so take this with salt.",
    pillars: ['n8n tutorials'],
    ...DEFAULT_FORMATS[fields.platform ?? 'x'],
    ...(fields.forum === undefined ? {} : { forum: fields.forum }),
    sponsorDial: 0.4,
    sponsorRampPosts: 10,
    paused: false,
    timezone: TIMEZONE,
    createdAt: Date.now(),
  })
  const account = await ctx.db.get(accountId)
  if (!account) throw new Error('account vanished')
  return account
}

export async function insertPost(
  ctx: MutationCtx,
  account: Doc<'accounts'>,
  fields: { status: PostStatus; plannedFor: string; kind?: PostKind; concept?: string; pillar?: string }
): Promise<Doc<'posts'>> {
  const concept = fields.concept ?? `Post on ${fields.plannedFor}`
  const kind = fields.kind ?? 'text'
  const postId = await ctx.db.insert('posts', {
    accountId: account._id,
    slug: `${fields.plannedFor}-${concept.length}-${Math.random().toString(36).slice(2, 6)}`,
    kind,
    intent: 'inform',
    length: kind === 'thread' ? 'long' : 'short',
    status: fields.status,
    concept,
    title: concept,
    hook: '',
    sponsorSegment: 'none',
    plannedFor: fields.plannedFor,
    scheduledAt: instantAt(fields.plannedFor, POST_HOUR, TIMEZONE),
    signalIds: [],
    pillar: fields.pillar,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  })
  const post = await ctx.db.get(postId)
  if (!post) throw new Error('post vanished')
  return post
}

/** A job row at the status given, for the post; nothing runs it. */
export async function insertJob(ctx: MutationCtx, post: Doc<'posts'>, fields: { kind: JobKind; status: JobStatus }): Promise<Doc<'jobs'>> {
  const now = Date.now()
  const finished = fields.status === 'done' || fields.status === 'failed'
  const jobId = await ctx.db.insert('jobs', {
    kind: fields.kind,
    role: JOB_KINDS[fields.kind].role,
    status: fields.status,
    accountId: post.accountId,
    postId: post._id,
    attempts: fields.status === 'queued' ? 0 : 1,
    createdAt: now,
    startedAt: fields.status === 'queued' ? undefined : now,
    finishedAt: finished ? now : undefined,
  })
  const job = await ctx.db.get(jobId)
  if (!job) throw new Error('job vanished')
  return job
}

/**
 * A post the operator posted and the analyst measured: its tracked link with
 * `clicks`, and one read of its X `impressions` and `follows` three days after it
 * went out.
 */
export async function insertMeasuredPost(
  ctx: MutationCtx,
  account: Doc<'accounts'>,
  fields: {
    postedAt: number
    impressions: number
    clicks: number
    follows?: number
    pillar?: string
    sponsorSegment?: SponsorSegment
    status?: 'measured' | 'posted'
  }
): Promise<Doc<'posts'>> {
  const plannedFor = new Date(fields.postedAt).toISOString().slice(0, 10)
  const externalId = String(Math.floor(Math.random() * 1e12))
  const postId = await ctx.db.insert('posts', {
    accountId: account._id,
    slug: `${plannedFor}-${Math.random().toString(36).slice(2, 8)}`,
    kind: 'text',
    intent: 'inform',
    length: 'medium',
    status: fields.status ?? 'measured',
    concept: `Post of ${plannedFor}`,
    title: `Post of ${plannedFor}`,
    hook: '',
    sponsorSegment: fields.sponsorSegment ?? 'none',
    plannedFor,
    scheduledAt: fields.postedAt,
    signalIds: [],
    pillar: fields.pillar,
    posted: { kind: 'linked', at: fields.postedAt, url: `https://x.com/${account.handle}/status/${externalId}`, externalId },
    createdAt: fields.postedAt,
    updatedAt: fields.postedAt,
  })
  const linkId = await ctx.db.insert('links', {
    kind: 'post',
    slug: Math.random().toString(36).slice(2, 9),
    accountId: account._id,
    postId,
    target: 'https://formstep.io',
    clicks: fields.clicks,
    createdAt: fields.postedAt,
  })
  // Each click within the post's first day, so its measurement window counts them all.
  for (let click = 0; click < fields.clicks; click += 1) {
    await ctx.db.insert('linkClicks', { linkId, accountId: account._id, postId, at: fields.postedAt + 3_600_000 })
  }
  const counts = xCounts(fields.impressions, fields.follows ?? 0)
  await ctx.db.insert('metricSnapshots', {
    accountId: account._id,
    item: { kind: 'post', postId },
    takenAt: fields.postedAt + 72 * 3_600_000,
    counts,
    mock: true,
  })
  await ctx.db.patch(postId, { numbers: { counts, readAt: fields.postedAt + 72 * 3_600_000, mock: true } })
  const post = await ctx.db.get(postId)
  if (!post) throw new Error('post vanished')
  return post
}

/**
 * A signal the researcher found `foundAt`, posted `publishedAt` when the
 * source says so. Score 70 and status new unless the test names them.
 */
export async function insertSignal(
  ctx: MutationCtx,
  account: Doc<'accounts'>,
  fields: {
    title: string
    foundAt: number
    publishedAt?: number
    source?: SignalSource
    score?: number
    status?: SignalStatus
    summary?: string
  }
): Promise<Doc<'signals'>> {
  const signalId = await ctx.db.insert('signals', {
    accountId: account._id,
    source: fields.source ?? 'reddit',
    externalId: Math.random().toString(36).slice(2, 10),
    title: fields.title,
    url: 'https://example.com',
    summary: fields.summary ?? '',
    score: fields.score ?? 70,
    topics: [],
    status: fields.status ?? 'new',
    foundAt: fields.foundAt,
    ...(fields.publishedAt === undefined ? {} : { publishedAt: fields.publishedAt }),
    mock: true,
  })
  const signal = await ctx.db.get(signalId)
  if (!signal) throw new Error('signal vanished')
  return signal
}

/** A reply the operator posted on X, with what the analyst read of it. */
export async function insertPostedReply(
  ctx: MutationCtx,
  account: Doc<'accounts'>,
  fields: {
    heardAt: number
    impressions: number
    follows: number
    origin?: ReplyOrigin
    experimentId?: Id<'experiments'>
    variantKey?: string
    /** Measured once its window closed, the only replies an experiment counts; posted by default. */
    status?: 'posted' | 'measured'
  }
): Promise<Id<'replies'>> {
  const externalId = String(Math.floor(Math.random() * 1e12))
  return ctx.db.insert('replies', {
    accountId: account._id,
    origin: fields.origin ?? 'search',
    inReplyTo: externalId,
    thread: {
      url: `https://x.com/dana/status/${externalId}`,
      title: null,
      text: 'A post',
      postedAt: fields.heardAt,
      author: { handle: 'dana', name: 'Dana' },
      reach: 3_000,
      community: null,
    },
    fit: HEARD_FIT,
    ...(fields.experimentId === undefined ? {} : { experimentId: fields.experimentId, variantKey: fields.variantKey }),
    status: fields.status ?? 'posted',
    text: 'A reply.',
    operatorAsked: false,
    heardAt: fields.heardAt,
    writtenAt: fields.heardAt,
    posted: { kind: 'linked', at: fields.heardAt, url: `https://x.com/ada/status/9${externalId}`, externalId: `9${externalId}` },
    numbers: { counts: xCounts(fields.impressions, fields.follows), readAt: fields.heardAt, mock: true },
    mock: true,
  })
}

/** What X counts of an item with these impressions and follows, and nothing else. */
function xCounts(impressions: number, follows: number): ItemCounts {
  return { platform: 'x', impressions, likes: 0, replies: 0, reposts: 0, profileVisits: 0, follows }
}
