import type { FoundThread, HeardMention, MentionsQuery, SearchQuery } from '../types'

/**
 * The mock listener: plausible posts from the account's pillars until X
 * search access exists. Each three-hour window hears a fresh set, seeded by
 * the handle and the window, so a second sweep in the same window hears the
 * same posts (and answers none of them twice), and the next window hears new
 * ones. The set always holds a mention, a reply under the account's post,
 * found posts with large and small reach, one too old to answer, and, in
 * turn, a post naming the sponsor and a post about politics, so every filter
 * and a rule like "never reply to politics" has something to act on.
 */

const WINDOW_MS = 3 * 3_600_000
const HOUR_MS = 3_600_000

interface Author {
  handle: string
  name: string
  followers: number
}

const AUTHORS: Author[] = [
  { handle: 'dana_automates', name: 'Dana Ruiz', followers: 12_400 },
  { handle: 'opsjoe', name: 'Joe Park', followers: 3_100 },
  { handle: 'buildwithkai', name: 'Kai Lund', followers: 25_800 },
  { handle: 'mira_ships', name: 'Mira Chen', followers: 5_400 },
  { handle: 'nocode_nina', name: 'Nina Vos', followers: 860 },
  { handle: 'tomtries', name: 'Tom Ek', followers: 410 },
]

const FOUND: ((pillar: string) => string)[] = [
  (pillar) => `Spent all day on ${inSentence(pillar)}. Why does nobody talk about what happens when a step fails halfway?`,
  (pillar) => `What's your go-to setup for ${inSentence(pillar)}? Mine keeps breaking on Mondays.`,
  (pillar) => `Unpopular opinion: most ${inSentence(pillar)} tutorials skip the only hard part, the error path.`,
  (pillar) => `Is ${inSentence(pillar)} still worth learning, or is it all agents now?`,
  (pillar) => `Three weeks into ${inSentence(pillar)} and I finally get why people name every step.`,
]

const MENTIONS: ((handle: string) => string)[] = [
  (handle) => `@${handle} what do you check first when a workflow breaks overnight?`,
  (handle) => `@${handle} your last thread saved my Monday. Do you cap retries or alert on every failure?`,
]

/** One item of a list by a seeded index; the lists are constants, so an empty one is a bug. */
function pick<T>(items: readonly T[], index: number): T {
  const item = items[index % items.length]
  if (item === undefined) throw new Error('the mock listener picked from an empty list')
  return item
}

/** A pillar inside a sentence: "Automation fails" reads "automation fails", while "AI agents" and "n8n" keep their case. */
function inSentence(pillar: string): string {
  return /^[A-Z][a-z]/.test(pillar) ? pillar.charAt(0).toLowerCase() + pillar.slice(1) : pillar
}

/** The three-hour window an instant falls in: each window hears a fresh set. */
function windowOf(now: number): number {
  return Math.floor(now / WINDOW_MS)
}

/** A mock post on X by the author, `hoursAgo` before now, its id unique in its window's set. */
function xPost(seed: number, index: number, text: string, at: { hoursAgo: number; author: Author }) {
  const externalId = `${1_840_000_000_000 + (seed % 1_000_000) * 100 + index}`
  return {
    externalId,
    title: null,
    text,
    url: `https://x.com/${at.author.handle}/status/${externalId}`,
    postedAt: Date.now() - at.hoursAgo * HOUR_MS,
    author: { handle: at.author.handle, name: at.author.name },
    reach: at.author.followers,
    community: null,
  }
}

/** The window's mention of the account, seeded by the handle; the comments under its posts come from the comment reader. */
export async function mockMentions(query: MentionsQuery): Promise<HeardMention[]> {
  const seed = hash(`${query.handle}:${windowOf(Date.now())}`)
  return [
    {
      ...xPost(seed, 0, pick(MENTIONS, seed)(query.handle), { hoursAgo: 1, author: pick(AUTHORS, seed + 5) }),
      origin: 'mention',
      pillar: null,
      comments: null,
    },
  ]
}

/**
 * The window's posts in the terms, seeded by them: found posts with large and
 * small reach, one too old to answer, and a post naming the sponsor on even
 * windows and a post about politics on odd ones.
 */
export async function mockXSearch(query: SearchQuery): Promise<FoundThread[]> {
  const window = windowOf(Date.now())
  const seed = hash(`${query.terms.join('|')}:${window}`)
  const termAt = (index: number) => pick(query.terms, seed + index)
  const found = (index: number, text: string, at: { hoursAgo: number; author: Author; term: string }): FoundThread => ({
    ...xPost(seed, index, text, at),
    comments: 0,
    topics: [at.term],
  })
  const posts: FoundThread[] = []
  for (let index = 0; index < 4; index += 1) {
    const term = termAt(index)
    // The fourth found post is too old to answer.
    const hoursAgo = index === 3 ? 20 : 1 + index * 2
    posts.push(found(2 + index, pick(FOUND, seed + index)(term), { hoursAgo, author: pick(AUTHORS, seed + index), term }))
  }
  const big = pick(AUTHORS, 2)
  posts.push(
    window % 2 === 0
      ? found(6, `Has anyone here tried ${query.sponsorName}? Looking for something like it.`, {
          hoursAgo: 3,
          author: big,
          term: termAt(1),
        })
      : found(6, `Politics aside, the new AI bill could change ${inSentence(termAt(2))} for small shops overnight.`, {
          hoursAgo: 2,
          author: big,
          term: termAt(2),
        })
  )
  return posts.sort((a, b) => b.postedAt - a.postedAt)
}

function hash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return Math.abs(h >>> 0)
}
