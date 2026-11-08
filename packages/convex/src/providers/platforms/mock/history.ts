import type { ImportedPost } from '@influstep/shared'
import type { ActivityQuery } from '../types'

/**
 * The shape of the mock account: mostly full posts, a good share of
 * one-liners, some threads, and a few replies to other people, in this many
 * of each. Shuffled per handle, so two accounts read differently.
 */
const BAG: Record<'short' | 'medium' | 'thread' | 'reply', number> = { short: 11, medium: 17, thread: 7, reply: 5 }

/** How many posts the mock timeline serves: 40. */
export const MOCK_HISTORY_SIZE = Object.values(BAG).reduce((sum, count) => sum + count, 0)

const SHORT: ((topic: Topic) => string)[] = [
  () => 'Rename every step. Future you will thank you.',
  (topic) => `Most ${topic.subject} problems are naming problems.`,
  (topic) => `What do you check first when your ${topic.subject} breaks?`,
  () => 'Logs first, opinions later.',
  () => 'Shipped a fix today. Took four minutes. Finding it took forty.',
  () => 'Test the failure path, not the happy one.',
  (topic) => `Hot take: the best ${topic.subject} is the one you can delete.`,
  () => 'Small flows, loud errors.',
  (topic) => `Is anyone still doing ${topic.subject} by hand on Mondays?`,
  () => 'Wrote it down before I changed it. Saved my afternoon.',
]

const MEDIUM: ((topic: Topic) => string)[] = [
  (topic) =>
    `Spent the morning on ${topic.subject}. The fix was one setting; the hunt was two hours.\n\nLesson: write down what you changed before you change the next thing.`,
  (topic) =>
    `People ask where to start with ${topic.niche}. Start with the one task you do by hand every Monday. Automate it badly, then make it good. Most people try it the other way round.`,
  (topic) =>
    `Three things I check before I call a ${topic.subject} setup done:\n- it fails loudly\n- it can run twice without harm\n- someone else can read it`,
  (topic) =>
    `Unpopular opinion: you do not need another tool for ${topic.subject}. You need to read the log you already have, slowly, top to bottom.`,
  (topic) =>
    `Every ${topic.subject} setup I build now starts with the error path. What happens when the customer never answers? Decide that first and the rest gets easier.`,
  (topic) =>
    `Rebuilt an old ${topic.subject} setup from last year. Half of it was workarounds for bugs that are fixed now. Worth revisiting yours once a year ✅`,
  (topic) =>
    `A question I get a lot: how long should a ${topic.subject} flow be? Short enough that you can explain it in one sentence. If you cannot, split it.`,
  () =>
    'Today I learned the hard way that retries without a limit are just a slower outage. Cap them, log them, and alert on the last one.',
]

const THREADS: ((topic: Topic) => string[])[] = [
  (topic) => [
    `How I set up ${topic.subject} from scratch, in four steps. 🧵`,
    '1. Write down the one outcome you want. Not the tools, the outcome.',
    '2. Build the smallest flow that gets there, even if it is ugly.',
    '3. Make it fail loudly.\n4. Then make it pretty, never before.',
  ],
  (topic) => [
    `Five mistakes I made with ${topic.subject} so you do not have to 🧵`,
    '1. No error path.\n2. Retries with no limit.',
    '3. Steps named "Step 3".\n4. Secrets pasted into nodes.',
    '5. No owner. If nobody gets the alert, there is no alert.',
  ],
  (topic) => [
    `What ${topic.niche} looks like in a small team, one week in. 🧵`,
    'Monday: list every task you repeat. Tuesday: pick the dullest one.',
    'Wednesday to Friday: automate it, break it, fix it. Then do the next one.',
  ],
  (topic) => [
    `The ${topic.subject} checklist I use before anything goes live:`,
    '- It runs twice without doing the work twice.\n- It tells someone when it fails.\n- It has a name a stranger understands.',
  ],
]

const REPLIES = [
  'Same here. The fix for me was a retry with a limit.',
  'This is the way. Logs first.',
  'Good question. I would start with the error path.',
  'Agree, but only once it runs twice without harm.',
  'Ha, been there. Rename the steps and it gets better.',
]

interface Topic {
  subject: string
  niche: string
}

/**
 * Plausible history for an account's account, deterministic per handle: the
 * same handle always gets the same posts with the same ids and counts, so a
 * second import adds nothing and the learned examples stay the same. Dates
 * count back from `now`. English, likes from 0 to 400, a few emoji, a
 * hashtag on two posts. The seed does not use it: Ada's demo history is
 * written by hand with ids of its own, so importing in mock mode adds
 * this generated set next to it.
 */
export function mockXHistory(query: ActivityQuery): ImportedPost[] {
  if (query.pillars.length === 0) throw new Error('mock X history needs at least one content pillar')
  const random = seededRandom(query.handle)
  const tag = hashtagOf(query.pillars)
  const shapes = shuffle(
    (Object.keys(BAG) as (keyof typeof BAG)[]).flatMap((shape) => Array.from({ length: BAG[shape] }, () => shape)),
    random
  )
  let postedAt = query.now
  let hashtags = 0
  return shapes.map((shape, index): ImportedPost => {
    postedAt -= Math.round((14 + random() * 16) * 3_600_000)
    const pillar = pick(query.pillars, random)
    const topic: Topic = { subject: pillar.toLowerCase(), niche: query.niche }
    const externalId = `mock-${query.handle}-${String(index + 1).padStart(2, '0')}`
    if (shape === 'reply') {
      const likes = Math.floor(random() * 20)
      return {
        externalId,
        parts: [pick(REPLIES, random)],
        postedAt,
        likes,
        reposts: 0,
        replies: Math.floor(random() * 3),
        parentId: `mock-someone-${index + 1}`,
        url: null,
        community: null,
        // A short reply is often too short for X to name its language.
        lang: index % 2 === 0 ? 'en' : null,
      }
    }
    const likes = Math.floor(random() ** 2 * (shape === 'thread' ? 400 : 300))
    const counts = { likes, reposts: Math.floor(likes * random() * 0.2), replies: Math.floor(likes * random() * 0.1) }
    const original = { externalId, postedAt, ...counts, parentId: null, url: null, community: null, lang: 'en' }
    if (shape === 'thread') return { ...original, parts: pick(THREADS, random)(topic) }
    const text = pick(shape === 'short' ? SHORT : MEDIUM, random)(topic)
    // Two of the full posts carry a hashtag: rare, the way most accounts in a niche use them.
    const tagged = shape === 'medium' && hashtags < 2
    if (tagged) hashtags += 1
    return { ...original, parts: [tagged ? `${text} #${tag}` : text] }
  })
}

/** The first word of the first pillar that makes a hashtag, so "n8n tutorials" tags #n8n. */
function hashtagOf(pillars: string[]): string {
  for (const pillar of pillars) {
    const word = (pillar.split(/\s+/)[0] ?? '').replace(/[^\p{L}\p{N}_]/gu, '')
    if (word.length > 0) return word
  }
  throw new Error('no content pillar makes a hashtag')
}

/** mulberry32 seeded by an FNV-1a hash of the text: small, fast, and the same sequence for the same text everywhere. */
function seededRandom(text: string): () => number {
  let seed = 0x811c9dc5
  for (const char of text) seed = Math.imul(seed ^ (char.codePointAt(0) ?? 0), 0x01000193)
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

function pick<T>(items: T[], random: () => number): T {
  const item = items[Math.floor(random() * items.length)]
  if (item === undefined) throw new Error('pick() needs a non-empty list')
  return item
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    const a = out[i]
    const b = out[j]
    if (a === undefined || b === undefined) throw new Error('shuffle() index out of range')
    out[i] = b
    out[j] = a
  }
  return out
}
