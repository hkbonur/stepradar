import { engages, missingReasons, type Engagement } from '@influstep/shared'
import type { Doc } from '../_generated/dataModel'
import type { QueryCtx } from '../_generated/server'
import { accountRefOf, type AccountRef } from './accounts'
import { postBeingWritten } from './posts'

export interface CalendarPost {
  _id: Doc<'posts'>['_id']
  /** A text post or a thread; the card draws its kind icon and first line. */
  kind: Doc<'posts'>['kind']
  /** What the planner asked of the post. */
  intent: Doc<'posts'>['intent']
  length: Doc<'posts'>['length']
  title: string
  /** The post's first line, empty until it is written. */
  hook: string
  status: Doc<'posts'>['status']
  sponsorSegment: Doc<'posts'>['sponsorSegment']
  scheduledAt: number
  plannedFor: string
  /** Where it is posted: a subreddit, or Hacker News's Ask, Show or front page. */
  community?: string
  error?: string
  /** An idea the writer is on now (core `postBeingWritten`); false for every other status. */
  writing: boolean
  /** On a draft the judge found too few reasons to engage with, what it gives readers no reason to do (shared judge.ts); empty otherwise. */
  missingReasons: Engagement[]
  account: AccountRef
}

/** A post as a card or a day of the week strip shows it: Today's posts and the week read it from here. */
export async function calendarPostOf(ctx: { db: QueryCtx['db'] }, post: Doc<'posts'>, account: Doc<'accounts'>): Promise<CalendarPost> {
  return {
    _id: post._id,
    kind: post.kind,
    intent: post.intent,
    length: post.length,
    title: post.title,
    hook: post.hook,
    status: post.status,
    sponsorSegment: post.sponsorSegment,
    scheduledAt: post.scheduledAt,
    plannedFor: post.plannedFor,
    community: post.community,
    error: post.error,
    writing: post.status === 'idea' && (await postBeingWritten(ctx, post._id)),
    missingReasons:
      post.status === 'draft' && post.judgment !== undefined && !engages(post.judgment.reasons)
        ? missingReasons(post.judgment.reasons)
        : [],
    account: accountRefOf(account),
  }
}
