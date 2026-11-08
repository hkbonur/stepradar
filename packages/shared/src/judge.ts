/**
 * The judge (CONTEXT.md, "Judge"): before a post waits for the operator, an
 * agent reads it from the reader's side and gives the reasons a person would
 * read on, comment, like and follow. The reasons come from how people read
 * and act, never from why the account should post it or from how other
 * posts did. A post engages when it gives a reason to read on and a reason
 * to comment, the engagement the operator wants first, and a reason to like
 * it or follow the account.
 */

export const ENGAGEMENTS = ['read', 'comment', 'like', 'follow'] as const
export type Engagement = (typeof ENGAGEMENTS)[number]

/** What the judge asks of each engagement, as the studio shows it. */
export const ENGAGEMENT_QUESTIONS: Record<Engagement, string> = {
  read: 'Why would they read on?',
  comment: 'Why would they comment?',
  like: 'Why would they like or save it?',
  follow: 'Why would they follow?',
}

/**
 * How people come to each engagement: what the judge looks for, in the
 * words its prompt uses. Read: a first line that opens a gap they want
 * closed, names a problem they have now, or promises something specific.
 * Comment: room for discussion, an open question, a take to agree or
 * disagree with, an invitation to share their own way, a reply that takes
 * little effort. Like: useful, specific, new to them, true to their own
 * experience, or something that makes them look good to pass on. Follow:
 * proof that more posts from the account would keep helping them, a
 * point of view they want more of, a person they trust in the niche.
 */
export const ENGAGEMENT_DRIVERS: Record<Engagement, string> = {
  read: 'a first line that opens a gap they want closed, names a problem they have now, or promises something specific',
  comment:
    'room for discussion: an open question, a take they can agree or disagree with, an invitation to share how they do it, a reply that takes little effort',
  like: 'something useful, specific or new to them, true to their own experience, or that makes them look good to pass on',
  follow:
    'proof that more posts from this account would keep helping them: lasting value in the niche, a point of view, a person they can trust',
}

/** The judge's reason for each engagement, from the reader's side, or null where the post gives none. */
export type EngagementReasons = Record<Engagement, string | null>

/** Whether a post engages: a reason to read on, a reason to comment, and a reason to like it or follow. */
export function engages(reasons: EngagementReasons): boolean {
  return reasons.read !== null && reasons.comment !== null && (reasons.like !== null || reasons.follow !== null)
}

/** The engagements the post gives no reason for, in ENGAGEMENTS order. */
export function missingReasons(reasons: EngagementReasons): Engagement[] {
  return ENGAGEMENTS.filter((engagement) => reasons[engagement] === null)
}
