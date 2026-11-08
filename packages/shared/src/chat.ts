import { z } from 'zod'
import { readsAsDirective } from './checklist'
import type { JobKind } from './jobs'
import { OPERATOR_MEMORY_KINDS } from './memory'
import { REPLY_RULE } from './replies'

/**
 * What an operator's chat message asks for (docs/plan.md, slices 7 and 10).
 * Every message is read once into one intent: a change to the plan, a task
 * for an agent, something to remember, a directive, or plain conversation. The mock reads it with `parseChatIntent`; the real
 * provider returns the same shape through `chatIntentSchema`.
 */

export const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const
export type Weekday = (typeof WEEKDAYS)[number]

export const WEEKDAY_LABELS: Record<Weekday, string> = {
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday',
  saturday: 'Saturday',
  sunday: 'Sunday',
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

/** The parts of a calendar day (YYYY-MM-DD). A malformed day is a bug upstream, so it throws. */
function dayParts(day: string): { year: number; month: number; date: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  if (!match) throw new Error(`"${day}" is not a calendar day (YYYY-MM-DD)`)
  return { year: Number(match[1]), month: Number(match[2]), date: Number(match[3]) }
}

/** The weekday of a calendar day. A day is already local to the account, so it is read in UTC and never shifts. */
export function weekdayOf(day: string): Weekday {
  const { year, month, date } = dayParts(day)
  const weekday = WEEKDAYS[(new Date(Date.UTC(year, month - 1, date)).getUTCDay() + 6) % 7]
  if (!weekday) throw new Error(`no weekday for ${day}`)
  return weekday
}

/** A day as the account names it in chat: "Tue 13 Oct". */
export function shortDayLabel(day: string): string {
  const { month, date } = dayParts(day)
  return `${WEEKDAY_LABELS[weekdayOf(day)].slice(0, 3)} ${date} ${MONTH_LABELS[month - 1]}`
}

/**
 * The tasks a chat message can give an agent. Each is a job kind, so its
 * role and label are read from JOB_KINDS and JOB_KIND_LABELS.
 */
export const CHAT_TASKS = ['research_brief', 'comment_digest', 'analytics_summary'] as const satisfies readonly JobKind[]
export type ChatTask = (typeof CHAT_TASKS)[number]

export function isChatTask(kind: JobKind): kind is ChatTask {
  return CHAT_TASKS.some((task) => task === kind)
}

/**
 * Which post a message names. `postId` wins when present; `next` is
 * the earliest post of the plan ("the next post"); otherwise the weekday
 * and the keyword both have to hold when both are given (`matchPosts`).
 */
export const postTargetSchema = z.object({
  postId: z.string().optional(),
  weekday: z.enum(WEEKDAYS).optional(),
  keyword: z.string().optional(),
  next: z.boolean().optional(),
})
export type PostTarget = z.infer<typeof postTargetSchema>

export const CHAT_INTENT_KINDS = ['conversation', 'directive', 'replace', 'move', 'drop', 'task', 'remember'] as const
export type ChatIntentKind = (typeof CHAT_INTENT_KINDS)[number]

/**
 * One schema for every intent. Flat objects with optional target fields, so
 * the real provider can use it as its structured output as it is.
 */
export const chatIntentSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('conversation') }),
  z.object({ kind: z.literal('directive'), text: z.string() }),
  z.object({ kind: z.literal('replace'), target: postTargetSchema, concept: z.string() }),
  z.object({ kind: z.literal('move'), target: postTargetSchema, to: z.enum(WEEKDAYS) }),
  z.object({ kind: z.literal('drop'), target: postTargetSchema }),
  z.object({ kind: z.literal('task'), task: z.enum(CHAT_TASKS), topic: z.string().optional() }),
  z.object({ kind: z.literal('remember'), memory: z.enum(OPERATOR_MEMORY_KINDS), text: z.string() }),
])
export type ChatIntent = z.infer<typeof chatIntentSchema>

// ---------------------------------------------------------------------------
// The deterministic English reader the mock provider uses.
// ---------------------------------------------------------------------------

const WEEKDAY = `(${WEEKDAYS.join('|')})`
const POSSESSIVE = `(?:'s|’s)?`
const NOUN = `(?:post|one|post|video)`

/** Words a request often opens with before its verb ("ok, can you please move ..."). */
const POLITE_OPENING =
  /^(?:(?:ok|okay|so|and|also|now|hey|hi)[,\s]+)*(?:(?:please|pls)\s+)?(?:(?:can|could|would|will)\s+you\s+)?(?:please\s+)?/i

/** Words a request often closes with ("drop Friday, please"); left on, they would read as part of the target. */
const POLITE_ENDING = /[\s,]+(?:please|pls|thanks|thank you|thx)$/i

/** "the webhook one", "Tuesday's n8n post", "that Friday one", "the n8n post on Tuesday", "the one about pricing". */
const TARGET = new RegExp(
  `^(?:(?:the|my|our|this|that)\\s+)?(?:${WEEKDAY}${POSSESSIVE}\\s*)?(.*?)\\s*(${NOUN})?(?:\\s+(?:on|from)\\s+${WEEKDAY})?$`,
  'i'
)

/** "the next post": the earliest post of the plan, as a change's whole target. */
const NEXT_POST = `(?:the\\s+)?next\\s+${NOUN}`
const NEXT_TARGET = new RegExp(`^${NEXT_POST}$`, 'i')

/**
 * Words that point at a post without naming it ("that one", "move it").
 * As a keyword they would match any concept or title that holds them ("it"
 * in "without"), so a chat change could hit a post nobody named, and a
 * kill cannot be undone.
 */
const POINTING_WORDS: ReadonlySet<string> = new Set(['it', 'this', 'that', 'these', 'those', 'them', 'one'])

/** A shorter keyword is part of too many words ("ai" in "wait", "email") to name a post. */
const KEYWORD_MIN_LENGTH = 3

const ABOUT = new RegExp(`^${NOUN}\\s+(?:about|on)\\s+(.+)$`, 'i')

const REPLACE = new RegExp(`^(?:replace|swap)\\s+(.+?)\\s+(?:with|for)\\s+(?:one|an?\\s+(?:new\\s+)?${NOUN})\\s+(?:about|on)\\s+(.+)$`, 'i')
const MOVE = new RegExp(`^(?:move|shift|push)\\s+(.+?)\\s+(?:(?:back|forward|over)\\s+)?to\\s+${WEEKDAY}$`, 'i')
const DROP = /^(?:drop|cancel|skip|kill)\s+(.+)$/i
/** "remember that readers hate the word 'guys'", "keep in mind: ...", "note that ...", "remember to always ...". */
const REMEMBER = /^(?:remember|keep in mind|note|don't forget|do not forget)(?:\s*[:,-]\s*|\s+)(?:that\s+)?(.+)$/i
/** "remember to ...": what follows is something to do, so a rule. */
const REMEMBER_TO = /^to\s+(.+)$/i
/** A remembered sentence that tells the account what to do or not to do is a rule; anything else is a fact. */
const RULE_OPENING = /^(?:always|never|don't|do not|dont|avoid|only|stop|keep|use|say|show|open|end|mention)\b/i

const RESEARCH_BRIEF = /\bresearch brief\b(?:\s+(?:on|about|for)\s+(.+))?/i
const RESEARCH_ON = /^(?:do\s+(?:some\s+)?|give me\s+(?:some\s+)?)?research\s+(?:on|about)\s+(.+)$/i
const COMMENT_DIGEST =
  /\bcomment digest\b|\bdigest of (?:the |my )?comments\b|\bwhat (?:are|were) (?:people|viewers|followers|they|folks) saying\b/i
// "How did ... go" ends the message, so "how did you go about it" stays conversation.
const ANALYTICS_SUMMARY = /\banalytics summary\b|\bhow (?:are|am) (?:we|i|you|things) doing\b|\bhow did\b.*\bgo$/i
const COMMENTS_WORD = /\bcomments\b/i
const ANALYTICS_WORD = /\banalytics\b|\bsummary\b/i

/** Quotes and end punctuation around a phrase the operator typed. */
function clean(phrase: string): string {
  return phrase
    .trim()
    .replace(/[.!?]+$/, '')
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .trim()
}

function asWeekday(word: string | undefined): Weekday | undefined {
  if (word === undefined) return undefined
  const lower = word.toLowerCase()
  return WEEKDAYS.find((weekday) => weekday === lower)
}

/**
 * Reads a post reference. "The next post" is the earliest post, as the
 * real interpreter reads it too. A keyword alone needs a noun after it ("the
 * webhook one") when `keywordNeedsNoun` is set, so "skip the intro" is not a
 * drop. A pointing word ("that one", "move it") is no keyword. Null when the
 * phrase names no post.
 */
function parseTarget(phrase: string, options: { keywordNeedsNoun: boolean }): PostTarget | null {
  const reference = clean(phrase)
  if (NEXT_TARGET.test(reference)) return { next: true }
  const match = TARGET.exec(reference)
  if (!match) return null
  const weekday = asWeekday(match[1]) ?? asWeekday(match[4])
  const rest = (match[2] ?? '').trim()
  const noun = match[3]
  const about = ABOUT.exec(rest)
  const said = clean(about?.[1] ?? rest)
  const keyword = POINTING_WORDS.has(said.toLowerCase()) ? '' : said
  if (weekday === undefined && keyword === '') return null
  if (weekday === undefined && noun === undefined && about === null && options.keywordNeedsNoun) return null
  const target: PostTarget = {}
  if (weekday !== undefined) target.weekday = weekday
  if (keyword !== '') target.keyword = keyword
  return target
}

/**
 * "Remember that readers hate the word 'guys'": a fact. "Remember to always
 * name the n8n version", "remember: never open with a question": a rule. The
 * words are kept as the operator wrote them, without the "remember that"
 * and a closing period, quotes and all: `clean` would cut the closing quote
 * of "hate the word 'guys'".
 */
function parseRemember(text: string): ChatIntent | null {
  const match = REMEMBER.exec(text.replace(POLITE_OPENING, '').replace(POLITE_ENDING, ''))
  if (!match?.[1]) return null
  const rest = match[1].trim().replace(/\.+$/, '').trim()
  const todo = REMEMBER_TO.exec(rest)
  if (todo?.[1]) return { kind: 'remember', memory: 'rule', text: todo[1] }
  if (rest === '') return null
  return { kind: 'remember', memory: RULE_OPENING.test(rest) ? 'rule' : 'fact', text: rest }
}

/**
 * "Never reply to politics", "only reply to people building agents": a rule
 * about whom the account answers (shared `REPLY_RULE`) is remembered as
 * a rule without "remember", since the writer reads it before every reply,
 * where a directive only reaches posts.
 */
function parseReplyRule(text: string): ChatIntent | null {
  const rule = text
    .replace(POLITE_OPENING, '')
    .replace(/[.!]+$/, '')
    .replace(POLITE_ENDING, '')
    .replace(/[.!]+$/, '')
    .trim()
  if (!REPLY_RULE.test(rule)) return null
  return { kind: 'remember', memory: 'rule', text: rule }
}

function parseTask(text: string): ChatIntent | null {
  const brief = RESEARCH_BRIEF.exec(text) ?? RESEARCH_ON.exec(text)
  if (brief) {
    const topic = brief[1] === undefined ? '' : clean(brief[1])
    return topic === '' ? { kind: 'task', task: 'research_brief' } : { kind: 'task', task: 'research_brief', topic }
  }
  if (COMMENT_DIGEST.test(text)) return { kind: 'task', task: 'comment_digest' }
  if (ANALYTICS_SUMMARY.test(text)) return { kind: 'task', task: 'analytics_summary' }
  return null
}

function parsePlanChange(text: string): ChatIntent | null {
  const replace = REPLACE.exec(text)
  if (replace?.[1] && replace[2]) {
    const target = parseTarget(replace[1], { keywordNeedsNoun: false })
    const concept = clean(replace[2])
    if (target && concept !== '') return { kind: 'replace', target, concept }
  }
  const move = MOVE.exec(text)
  const to = asWeekday(move?.[2])
  if (move?.[1] && to) {
    const target = parseTarget(move[1], { keywordNeedsNoun: false })
    if (target) return { kind: 'move', target, to }
  }
  const drop = DROP.exec(text)
  if (drop?.[1]) {
    const target = parseTarget(drop[1], { keywordNeedsNoun: true })
    if (target) return { kind: 'drop', target }
  }
  return null
}

/**
 * Reads a message the way the mock provider does. The rules, first match
 * wins: something to remember, a rule about whom to reply to, a task named
 * in so many words, a change to the plan, a directive (shared
 * `readsAsDirective`), then a task named by a bare word ("comments",
 * "analytics", "summary"), which comes after directives so "stop saying
 * guys in the comments" stays a directive. Everything else is conversation. Weekdays are named, never "today" or "tomorrow". Politeness
 * at either end ("can you", "please") is read past.
 */
export function parseChatIntent(text: string): ChatIntent {
  const original = text.trim().replace(/\s+/g, ' ')
  const request = clean(clean(original.replace(POLITE_OPENING, '')).replace(POLITE_ENDING, ''))
  const matched = parseRemember(original) ?? parseReplyRule(original) ?? parseTask(request) ?? parsePlanChange(request)
  if (matched) return matched
  if (readsAsDirective(original)) return { kind: 'directive', text: original }
  if (COMMENTS_WORD.test(request)) return { kind: 'task', task: 'comment_digest' }
  if (ANALYTICS_WORD.test(request)) return { kind: 'task', task: 'analytics_summary' }
  return { kind: 'conversation' }
}

// ---------------------------------------------------------------------------
// Which posts a target names.
// ---------------------------------------------------------------------------

/** What `matchPosts` reads of a post; a stored post has all of it. */
export interface MatchablePost {
  _id: string
  /** The local calendar day, YYYY-MM-DD in the account's timezone. */
  plannedFor: string
  scheduledAt: number
  concept: string
  title: string
  pillar?: string
}

/**
 * Whether the post's concept, title or pillar holds the keyword. A pointing
 * word or a keyword shorter than three letters holds nowhere: either is part
 * of too many words to name a post, whichever interpreter returned it.
 */
function holdsKeyword(post: MatchablePost, keyword: string): boolean {
  const needle = keyword.toLowerCase()
  if (needle.length < KEYWORD_MIN_LENGTH || POINTING_WORDS.has(needle)) return false
  if (post.concept.toLowerCase().includes(needle)) return true
  if (post.title.toLowerCase().includes(needle)) return true
  return post.pillar !== undefined && post.pillar.toLowerCase().includes(needle)
}

/**
 * The posts of `plan` the target names. An id wins; `next` is the
 * earliest post; otherwise the weekday and the keyword (case-insensitive,
 * in the concept, title or pillar) both have to hold when both are given. A
 * target that names nothing matches nothing, so an empty reference never
 * changes the one post a short plan holds, and neither does a keyword
 * that names no post ("it", "that", a two-letter word).
 */
export function matchPosts<E extends MatchablePost>(plan: readonly E[], target: PostTarget): E[] {
  if (target.postId !== undefined) return plan.filter((post) => post._id === target.postId)
  if (target.next === true) {
    return [...plan].sort((a, b) => a.scheduledAt - b.scheduledAt).slice(0, 1)
  }
  const weekday = target.weekday
  const keyword = target.keyword?.trim() ?? ''
  if (weekday === undefined && keyword === '') return []
  return plan.filter((post) => {
    if (weekday !== undefined && weekdayOf(post.plannedFor) !== weekday) return false
    if (keyword === '') return true
    return holdsKeyword(post, keyword)
  })
}
