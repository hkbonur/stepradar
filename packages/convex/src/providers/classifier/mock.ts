import { namesSponsor, type HeardFit, type HeardIntent } from '@influstep/shared'
import type { ClassifierProvider, ClassifyBrief } from './types'

/** Words too common to say what a post is about. */
const COMMON_WORDS = new Set(['and', 'are', 'for', 'from', 'how', 'into', 'that', 'the', 'this', 'what', 'with', 'you', 'your'])

/** The words a post shares with the account's pillars and niche, three letters or more and not common, in any case. */
function sharedWords(text: string, brief: ClassifyBrief): string[] {
  const topic = new Set(
    [...brief.pillars, brief.niche]
      .flatMap((phrase) => phrase.toLowerCase().split(/[^a-z0-9]+/))
      .filter((word) => word.length >= 3 && !COMMON_WORDS.has(word))
  )
  return [...new Set(text.toLowerCase().split(/[^a-z0-9]+/))].filter((word) => topic.has(word))
}

function intentOf(text: string): HeardIntent {
  if (/anyone (tried|recommend)|looking for|recommend/i.test(text)) return 'recommendation'
  if (/broke|breaks|fails|failing|hate|why does/i.test(text)) return 'complaint'
  if (text.includes('?')) return 'question'
  return 'discussion'
}

/**
 * A deterministic read: a mention or a reply under the account's post is
 * always on topic, since its author spoke to the account; a found post is on
 * topic when it shares a word with the pillars or the niche, or names the
 * sponsor. The score grows with the words shared.
 */
function fitOf(post: ClassifyBrief['posts'][number], brief: ClassifyBrief): HeardFit {
  const shared = sharedWords(post.text, brief)
  const spokenTo = post.origin !== 'search'
  const relevant = spokenTo || shared.length > 0 || namesSponsor(post.text, brief.sponsorName)
  if (!relevant) return { relevant, intent: 'other', replyWorthy: false, score: 0, confidence: 0.8, reason: 'nothing about the niche' }
  return {
    relevant,
    intent: intentOf(post.text),
    replyWorthy: true,
    score: Math.min(0.95, 0.5 + shared.length * 0.15 + (spokenTo ? 0.2 : 0)),
    confidence: 0.7,
    reason: spokenTo ? 'spoken to the account' : `about ${shared.join(', ') || brief.sponsorName}`,
  }
}

/** A rule that forbids it ("no self-promotion", "don't advertise"), one that allows it, or neither. */
const FORBIDS = /\b(no|not|don't|do not|never)\b[^.\n]*\b(self[- ]?promotion|advertis\w*|promot\w*)/i
const ALLOWS = /\bself[- ]?promotion\b[^.\n]*\b(allowed|welcome|ok|okay)\b/i

export const mockClassifier: ClassifierProvider = {
  name: 'mock',
  async classify(brief) {
    return brief.posts.map((post) => fitOf(post, brief))
  },
  async communityRules(args) {
    if (FORBIDS.test(args.rules)) return { selfPromotion: 'forbidden', reason: 'a rule forbids promotion' }
    if (ALLOWS.test(args.rules)) return { selfPromotion: 'allowed', reason: 'a rule allows self-promotion' }
    return { selfPromotion: 'unknown', reason: 'no rule speaks of promotion' }
  },
}
