import { hackerNewsCommunityOfTitle, hackerNewsTitlePrefix } from './communities'
import { PLATFORM_IN_WORDS, type Platform } from './platforms'
import type { PostKind } from './post-kinds'
import { THREAD_PARTS_MAX, THREAD_PARTS_MIN, X_POST_LIMIT, platformLength } from './posts'
import { PLATFORM_DRAFT_SHAPES, pointsProblems } from './replies'

/**
 * What a post must be to go out on its platform (docs/plan.md, ground rule
 * 6): its title where the platform posts one, its parts, each within what
 * the platform takes, and on Hacker News talking points for the operator to
 * write from. The writer and the operator's editor both check through here,
 * so they agree on every limit.
 */

/** The longest title each platform posts; on X and LinkedIn the title only names the post in the studio. */
export const POST_TITLE_MAX: Record<Platform, number | null> = {
  reddit: 300,
  hackernews: 80,
  x: null,
  linkedin: null,
  // Discourse's default; other forum software allows about as much.
  forum: 255,
}

/** The longest one part of a post may be, counted as its platform counts (shared `platformLength`). */
export const POST_PART_MAX: Record<Platform, number> = {
  x: X_POST_LIMIT,
  linkedin: 3_000,
  reddit: 40_000,
  hackernews: 4_000,
  forum: 32_000,
}

/** The kinds of post each platform takes: a thread is X's. */
export const PLATFORM_POST_KINDS: Record<Platform, readonly PostKind[]> = {
  x: ['text', 'thread'],
  linkedin: ['text'],
  reddit: ['text'],
  hackernews: ['text'],
  forum: ['text'],
}

/**
 * Everything that keeps a post from going out on its platform, in the order
 * the operator fixes them: its title where the platform posts one, the
 * number of parts (one, or THREAD_PARTS_MIN to THREAD_PARTS_MAX for a
 * thread on X), then each part within what the platform takes. What the
 * operator saves and says they posted is held to these; a draft is held to
 * its shape too (`postDraftProblems`). Empty when the post is ready.
 */
export function postProblems(
  post: { platform: Platform; kind: PostKind; community: string | null },
  draft: { title: string; parts: readonly string[] }
): string[] {
  const words = PLATFORM_IN_WORDS[post.platform]
  const problems = titleProblems(post, draft.title)
  const count = draft.parts.length
  if (!PLATFORM_POST_KINDS[post.platform].includes(post.kind)) problems.push(`A post on ${words} is one part: no thread.`)
  else if (post.kind === 'text' && count !== 1) problems.push('A text post is one part.')
  else if (post.kind === 'thread' && (count < THREAD_PARTS_MIN || count > THREAD_PARTS_MAX)) {
    problems.push(`A thread is ${THREAD_PARTS_MIN} to ${THREAD_PARTS_MAX} parts.`)
  }
  const max = POST_PART_MAX[post.platform]
  for (const [index, part] of draft.parts.entries()) {
    const n = index + 1
    if (part.trim().length === 0) {
      problems.push(`Part ${n} is empty.`)
      continue
    }
    const length = platformLength(part, post.platform)
    if (length > max) problems.push(`Part ${n} is ${length} characters; ${words} allows ${max}.`)
  }
  return problems
}

/**
 * What the writer's draft must be beyond what its platform takes: on Hacker
 * News talking points for the operator to write from, never the text itself
 * (ground rule 6). The operator's own words, posted, are held to
 * `postProblems` alone.
 */
export function postDraftProblems(
  post: { platform: Platform; kind: PostKind; community: string | null },
  draft: { title: string; parts: readonly string[] }
): string[] {
  const problems = postProblems(post, draft)
  if (PLATFORM_DRAFT_SHAPES[post.platform] !== 'points') return problems
  return [...problems, ...draft.parts.flatMap((part) => (part.trim() === '' ? [] : pointsProblems(part)))]
}

/** A posted title is there and within its platform's limit, and on Hacker News it says where it goes. */
function titleProblems(post: { platform: Platform; community: string | null }, title: string): string[] {
  const max = POST_TITLE_MAX[post.platform]
  if (max === null) return []
  const trimmed = title.trim()
  if (trimmed === '') return [`Write the title ${PLATFORM_IN_WORDS[post.platform]} shows.`]
  const problems: string[] = []
  const length = [...trimmed].length
  if (length > max) problems.push(`A title on ${PLATFORM_IN_WORDS[post.platform]} is at most ${max} characters; this one is ${length}.`)
  if (post.platform === 'hackernews') problems.push(...hackerNewsTitleProblems(post.community, trimmed))
  return problems
}

function hackerNewsTitleProblems(community: string | null, title: string): string[] {
  const prefix = hackerNewsTitlePrefix(community)
  if (prefix !== '') return title.startsWith(prefix) ? [] : [`A post on ${community} has a title that starts "${prefix}".`]
  const stray = hackerNewsCommunityOfTitle(title)
  return stray === 'Hacker News' ? [] : [`Only a post on ${stray} starts its title "${hackerNewsTitlePrefix(stray)}".`]
}
