/**
 * The research rules of docs/plan.md, v0.2 item 9, that need no database:
 * when a post is written, and which reader questions are the same
 * question.
 */

import { jaccard } from './similarity'

/**
 * The day a post is written: the calendar day before it goes
 * out, so the writer reads that morning's research. Date arithmetic on the
 * YYYY-MM-DD string itself, in UTC, since the string already is the account's
 * local day and no timezone applies to it.
 */
export function writeDayOf(plannedFor: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(plannedFor)
  if (!match) throw new Error(`"${plannedFor}" is not a YYYY-MM-DD day`)
  const [, year, month, day] = match
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day) - 1))
  return date.toISOString().slice(0, 10)
}

/**
 * Words that say nothing about what a question asks, so two questions that
 * share only these are not the same question.
 */
const STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'you',
  'your',
  'are',
  'was',
  'what',
  'how',
  'why',
  'who',
  'when',
  'where',
  'which',
  'does',
  'did',
  'can',
  'could',
  'would',
  'should',
  'with',
  'this',
  'that',
  'there',
  'from',
  'have',
  'has',
  'any',
  'not',
  'but',
  'about',
  'into',
  'just',
  'also',
  'use',
  'get',
  'way',
  'they',
  'them',
  'its',
  'all',
  'one',
])

/** Two questions are the same when the Jaccard overlap of their tokens is at least this. */
const SAME_QUESTION_OVERLAP = 0.5

/** A question's words that carry meaning: lowercase letters and digits, three or more long, no stopwords. */
export function questionTokens(text: string): string[] {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu)
  if (!words) return []
  const out = new Set<string>()
  for (const word of words) {
    if ([...word].length < 3) continue
    if (STOPWORDS.has(word)) continue
    out.add(word)
  }
  return [...out]
}

export interface QuestionGroup {
  ids: string[]
  /** The group's first question, as asked. */
  text: string
  /**
   * The tokens every question of the group shares, sorted; the first
   * question's own tokens when the members share none.
   */
  tokens: string[]
}

/**
 * Viewer questions grouped by what they ask, greedily in input order: each
 * question joins the first group whose first question it overlaps by at least
 * half (Jaccard over their tokens), else starts its own. A question with no
 * meaningful word stays alone.
 */
export function groupQuestions(items: { id: string; text: string }[]): QuestionGroup[] {
  const groups: { ids: string[]; text: string; first: Set<string>; members: Set<string>[] }[] = []
  for (const item of items) {
    const tokens = new Set(questionTokens(item.text))
    const home = groups.find((group) => jaccard(group.first, tokens) >= SAME_QUESTION_OVERLAP)
    if (home) {
      home.ids.push(item.id)
      home.members.push(tokens)
      continue
    }
    groups.push({ ids: [item.id], text: item.text, first: tokens, members: [tokens] })
  }
  return groups.map((group) => ({ ids: group.ids, text: group.text, tokens: groupTokens(group.first, group.members) }))
}

/**
 * The words that name a group. Each member overlaps the first question by
 * half, yet all of them together can share no word: {retry, webhook},
 * {retry} and {webhook}. The tokens key the group's problem, so an empty set
 * would give every such group the same key; the first question, which every
 * member matched, names the group then.
 */
function groupTokens(first: ReadonlySet<string>, members: readonly ReadonlySet<string>[]): string[] {
  const shared = [...first].filter((token) => members.every((member) => member.has(token)))
  if (shared.length === 0) return [...first].sort()
  return shared.sort()
}
