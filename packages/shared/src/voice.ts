import type { ImportedPost } from './history'
import { POST_LENGTHS, postLengthOf, type LengthMix, type PostLength } from './post-mix'

/**
 * An X account's voice (docs/plan.md, slice 5): how the account it took over
 * writes. Everything countable is computed here from the imported posts; the
 * analyst's model writes only the language, the summary and the traits, and
 * the operator edits those three in place. Every X post is written in this
 * voice, with the account's example posts in front of the writer.
 */

/** How often a habit (emoji, hashtags) shows up in the account's own posts. */
export const HABITS = ['never', 'rare', 'often'] as const
export type Habit = (typeof HABITS)[number]

export interface VoiceStats {
  /** The originals the stats are computed over: imported posts that are not replies to someone else. */
  sampleSize: number
  lengthMix: LengthMix
  emoji: Habit
  hashtags: Habit
}

export interface Voice extends VoiceStats {
  /** A BCP 47 tag such as `en`, `nb` or `tr`. */
  language: string
  summary: string
  /** One to VOICE_TRAITS_MAX short traits ("opens with the result", "no exclamation marks"). */
  traits: string[]
  learnedAt: number
}

export const VOICE_TRAITS_MAX = 8
export const VOICE_EXAMPLES_MIN = 3
export const VOICE_EXAMPLES_MAX = 8
/** The fewest originals a voice is learned from. */
export const VOICE_SAMPLE_MIN = 10

const EMOJI = /\p{Extended_Pictographic}/u
const HASHTAG = /#\w/

/**
 * What a voice's stats are shares of, as counts over the account's originals.
 * Counts add up as posts arrive and come off as they leave, so the backend
 * keeps them per account and learns a voice without reading every post.
 */
export interface VoiceCounts {
  /** Originals of each length (postLengthOf); together they are the sample size. */
  lengths: Record<PostLength, number>
  /** Originals with at least one emoji. */
  withEmoji: number
  /** Originals with at least one hashtag. */
  withHashtag: number
}

/** A post as the voice counts it: its parts, and whether it answers someone else's post. */
export interface VoicedPost {
  parts: string[]
  isReply: boolean
}

/** An imported post as the voice counts it: a reply when it answers something. */
export function voicedPostOf(post: ImportedPost): VoicedPost {
  return { parts: post.parts, isReply: post.parentId !== null }
}

/**
 * The voice counts of the originals among `posts`. Replies to other people
 * are left out; they are a different kind of writing.
 */
export function countVoice(posts: VoicedPost[]): VoiceCounts {
  const counts: VoiceCounts = { lengths: { short: 0, medium: 0, long: 0 }, withEmoji: 0, withHashtag: 0 }
  for (const post of posts) {
    if (post.isReply) continue
    counts.lengths[postLengthOf(post.parts)] += 1
    if (post.parts.some((part) => EMOJI.test(part))) counts.withEmoji += 1
    if (post.parts.some((part) => HASHTAG.test(part))) counts.withHashtag += 1
  }
  return counts
}

/** How many originals the counts cover: the sample a voice is learned from. */
export function voiceSampleSize(counts: VoiceCounts): number {
  return counts.lengths.short + counts.lengths.medium + counts.lengths.long
}

/**
 * The countable part of a voice: the share of each length, and how often an
 * original carries an emoji or a hashtag. With no original there is nothing
 * to count, which is a bug: the analyst refuses below VOICE_SAMPLE_MIN first.
 */
export function voiceStatsOf(counts: VoiceCounts): VoiceStats {
  const sampleSize = voiceSampleSize(counts)
  if (sampleSize === 0) throw new Error('voice stats need at least one original post')
  const lengthMix: LengthMix = { short: 0, medium: 0, long: 0 }
  for (const length of POST_LENGTHS) lengthMix[length] = counts.lengths[length] / sampleSize
  return {
    sampleSize,
    lengthMix,
    emoji: habitOf(counts.withEmoji / sampleSize),
    hashtags: habitOf(counts.withHashtag / sampleSize),
  }
}

/** The countable part of a voice over `posts`' originals (countVoice, then voiceStatsOf). */
export function voiceStats(posts: VoicedPost[]): VoiceStats {
  return voiceStatsOf(countVoice(posts))
}

/** Under 5 percent of originals is never, under 30 percent rare, the rest often. */
function habitOf(share: number): Habit {
  if (share < 0.05) return 'never'
  if (share < 0.3) return 'rare'
  return 'often'
}

/** The part of a voice the operator edits. */
export type VoiceEdit = Pick<Voice, 'language' | 'summary' | 'traits'>

/** One thing that keeps an edit from being saved, and the field it belongs to, so the form can mark that field. */
export interface VoiceEditProblem {
  field: keyof VoiceEdit
  message: string
}

/**
 * What keeps an edited voice from being saved, in the order the form shows
 * the fields. Empty when it can be saved. The backend refuses with the first
 * problem, and the studio shows them all, each tied to its field.
 */
export function voiceEditProblems(edit: VoiceEdit): VoiceEditProblem[] {
  const problems: VoiceEditProblem[] = []
  const language = edit.language.trim()
  if (language.length === 0) problems.push({ field: 'language', message: 'The language is empty.' })
  if (language.length > 0 && !isLanguageTag(language)) {
    problems.push({ field: 'language', message: `"${language}" is not a language tag such as en, nb or tr.` })
  }
  if (edit.summary.trim().length === 0) problems.push({ field: 'summary', message: 'The summary is empty.' })
  if (edit.traits.length === 0 || edit.traits.length > VOICE_TRAITS_MAX) {
    problems.push({ field: 'traits', message: `A voice has 1 to ${VOICE_TRAITS_MAX} traits.` })
  }
  for (const [index, trait] of edit.traits.entries()) {
    if (trait.trim().length === 0) problems.push({ field: 'traits', message: `Trait ${index + 1} is empty.` })
  }
  return problems
}

/** Intl throws a RangeError for a tag it cannot read; the studio names the language through Intl.DisplayNames, which would too. */
function isLanguageTag(tag: string): boolean {
  try {
    Intl.getCanonicalLocales(tag)
    return true
  } catch {
    return false
  }
}
