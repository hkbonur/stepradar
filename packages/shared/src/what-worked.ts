import { PLATFORMS } from './platforms'
import type { SignalSource } from './signals'

/**
 * What worked in the niche (CONTEXT.md, "Standout" and "Round-up"): among the
 * threads the researcher found, the ones people answered far more than the
 * others found with them, which a post can be modeled on, and the questions
 * people keep asking about one pillar, which a round-up post answers
 * together. Both are read from the account's unused signals.
 */

/** Whether a signal is a thread someone posted on a platform, scored by the reach and the comments it drew (core research `signalOf`). */
export function isThreadSource(source: SignalSource): boolean {
  return PLATFORMS.some((platform) => platform === source)
}

/** A thread stands out when it moved at least this many times the median of the others its source found. */
export const STANDOUT_RATIO = 2

/** A thread is compared only with at least this many others of its source: fewer say nothing of what is usual there. */
export const STANDOUT_OTHERS_MIN = 2

/** A thread as the standout rule reads it. Scores are compared within a source only: a Reddit point and a forum read are no common unit. */
export interface ScoredThread {
  source: SignalSource
  score: number
}

/**
 * The threads that stood out (`STANDOUT_RATIO` over the median of the
 * others of their source), the most out of line first, then the most moved.
 * A median of zero counts as one, so a thread anyone answered stands out
 * among threads nobody did.
 */
export function standouts<T extends ScoredThread>(threads: readonly T[]): T[] {
  const ranked: { thread: T; ratio: number }[] = []
  for (const thread of threads) {
    if (!isThreadSource(thread.source)) continue
    const others = threads.filter((other) => other !== thread && other.source === thread.source).map((other) => other.score)
    if (others.length < STANDOUT_OTHERS_MIN) continue
    const ratio = thread.score / Math.max(1, median(others))
    if (ratio >= STANDOUT_RATIO) ranked.push({ thread, ratio })
  }
  return ranked.sort((a, b) => b.ratio - a.ratio || b.thread.score - a.thread.score).map(({ thread }) => thread)
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  const upper = sorted[middle] ?? 0
  if (sorted.length % 2 === 1) return upper
  return ((sorted[middle - 1] ?? upper) + upper) / 2
}

/** Whether a title asks something; the problem log reads comments the same way (core research `logRepeatedQuestions`). */
export function asksSomething(title: string): boolean {
  return title.includes('?')
}

/** A round-up gathers at least this many questions on one pillar, and answers at most this many. */
export const ROUNDUP_QUESTIONS_MIN = 4
export const ROUNDUP_QUESTIONS_MAX = 8

/** A question as the round-up rule reads it: the pillar it is about, and how much it moved. */
export interface PillarQuestion {
  pillar: string
  score: number
}

/**
 * The questions a round-up answers: the pillar with the most of them, at
 * least `ROUNDUP_QUESTIONS_MIN`, the most moved first and at most
 * `ROUNDUP_QUESTIONS_MAX`; a tie goes to the pillar whose questions moved
 * more. Null when no pillar gathered enough.
 */
export function roundupOf<T extends PillarQuestion>(questions: readonly T[]): { pillar: string; questions: T[] } | null {
  const byPillar = new Map<string, T[]>()
  for (const question of questions) byPillar.set(question.pillar, [...(byPillar.get(question.pillar) ?? []), question])
  let best: { pillar: string; questions: T[]; moved: number } | null = null
  for (const [pillar, asked] of byPillar) {
    if (asked.length < ROUNDUP_QUESTIONS_MIN) continue
    const moved = asked.reduce((sum, question) => sum + question.score, 0)
    if (best === null || asked.length > best.questions.length || (asked.length === best.questions.length && moved > best.moved)) {
      best = { pillar, questions: asked, moved }
    }
  }
  if (best === null) return null
  return { pillar: best.pillar, questions: [...best.questions].sort((a, b) => b.score - a.score).slice(0, ROUNDUP_QUESTIONS_MAX) }
}
