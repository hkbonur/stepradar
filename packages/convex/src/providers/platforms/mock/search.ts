import type { FoundThread, SearchQuery } from '../types'

const HOUR_MS = 3_600_000

type Story = { title: string; summary: string; topics: string[] }

/**
 * How many answered each story, by its place in the list: the first drew a
 * crowd, so a source with three stories has one that stands out (shared
 * `standouts`), and the order the stories move in stays their order.
 */
const COMMENTS = [140, 30, 9]

/** The platforms whose mock reader searches: the ones whose real reader does. */
type SearchedPlatform = 'hackernews' | 'reddit' | 'forum'

/** Where a mock forum's threads are, when the search is not kept to the account's categories. */
const FORUM_CATEGORIES = ['Questions', 'Help me Build my Workflow', 'Tips & Tricks']

const STORIES: Record<SearchedPlatform, Story[]> = {
  hackernews: [
    {
      title: 'Show HN: I replaced my Zapier bill with n8n on a $5 VPS',
      summary: 'Self-hosting n8n, what broke, and the webhook retry trick that fixed it.',
      topics: ['n8n', 'automation', 'self-hosting'],
    },
    {
      title: 'Ask HN: How do you get customer sign-off inside an automated pipeline?',
      summary: 'Thread about pausing workflows until a client approves a quote.',
      topics: ['workflows', 'approvals', 'customers'],
    },
    {
      title: 'Claude Code and MCP: the agent that files its own tickets',
      summary: 'MCP servers that let an agent act on real tools, with a long comment thread on safety.',
      topics: ['ai agents', 'mcp', 'claude'],
    },
  ],
  reddit: [
    {
      title: 'n8n webhook fails silently when the client sends a form, how do I debug?',
      summary: 'r/n8n thread, 140 comments, most answers are about error workflows.',
      topics: ['n8n', 'webhooks', 'debugging'],
    },
    {
      title: 'What is everyone using to collect documents from clients?',
      summary: 'r/smallbusiness, people complain about chasing emails for PDFs.',
      topics: ['documents', 'customers', 'forms'],
    },
  ],
  forum: [
    {
      title: 'Form submissions reach the webhook twice when the client double-clicks',
      summary: 'My n8n form webhook runs twice when the client double-clicks submit. How do you dedupe it before the workflow runs?',
      topics: ['webhooks', 'forms', 'debugging'],
    },
    {
      title: 'How do you collect files from clients before a workflow runs?',
      summary: 'Building an onboarding workflow in n8n: what do you use to get documents and forms back from clients?',
      topics: ['documents', 'customers', 'workflows'],
    },
  ],
}

/**
 * Fixed, plausible stories so demos and tests see the same signals. Their
 * post times sit a fixed number of hours before the poll, a day apart, so a
 * source's stories spread over the last three days. A re-find stamps the
 * post time again (storeSignals), so a mock story never goes cold.
 */
export function mockSearch(source: SearchedPlatform): (query: SearchQuery) => Promise<FoundThread[]> {
  return async (query) => {
    const now = Date.now()
    // The fixed stories are about automation and agents; an account in another niche hears stories about its own terms.
    const fixed = STORIES[source]
    const stories = fixed.some((story) => termBonus(query.terms, story.topics) > 0) ? fixed : nicheStories(source, query.terms)
    // A Reddit or forum search kept to communities finds its stories there, as other threads than the ones found everywhere.
    const kept = source !== 'hackernews' && query.communities !== null && query.communities.length > 0 ? query.communities : null
    return stories.slice(0, query.limit).map((story, index) => ({
      externalId: kept === null ? `mock-${source}-${index}` : `mock-${source}-kept-${index}`,
      url: `https://example.com/${source}/${index}`,
      title: story.title,
      text: story.summary,
      postedAt: now - (6 + index * 24) * HOUR_MS,
      author: { handle: 'mock_author', name: 'mock_author' },
      reach: 100 - index * 17 + termBonus(query.terms, story.topics),
      community: communityOf(source, kept, index, story),
      comments: COMMENTS[index] ?? 0,
      topics: story.topics,
    }))
  }
}

/** Where a mock story was said: Hacker News, a subreddit named for its topic, a forum's category, or one the search was kept to. */
function communityOf(source: SearchedPlatform, kept: string[] | null, index: number, story: Story): string | null {
  if (source === 'hackernews') return 'Hacker News'
  const keptTo = kept?.[index % kept.length]
  if (keptTo !== undefined) return keptTo
  return source === 'reddit' ? (story.topics[0] ?? null) : (FORUM_CATEGORIES[index % FORUM_CATEGORIES.length] ?? null)
}

/** Stories shaped like the source's, about the account's first two terms; none without a term. */
function nicheStories(source: SearchedPlatform, terms: string[]): Story[] {
  const [first, second = first] = terms.map((term) => term.toLowerCase())
  if (first === undefined || second === undefined) return []
  const topics = (term: string) => term.split(/\s+/).filter((word) => word !== '')
  const by: Record<SearchedPlatform, Story[]> = {
    hackernews: [
      {
        title: `Ask HN: What does your ${first} setup look like?`,
        summary: `A long thread of people comparing how they do ${first}.`,
        topics: topics(first),
      },
      {
        title: `Show HN: I automated the boring part of ${second}`,
        summary: `What it saved, and what still needs a human.`,
        topics: topics(second),
      },
    ],
    reddit: [
      {
        title: `What do you wish you knew before starting with ${first}?`,
        summary: `Beginners' regrets, 90 comments.`,
        topics: topics(first),
      },
      {
        title: `${second} keeps going wrong, what am I missing?`,
        summary: `Most answers point at the same setting.`,
        topics: topics(second),
      },
    ],
    forum: [
      {
        title: `Best way to handle ${first} for a client project?`,
        summary: `A Questions thread with a screenshot of the setup.`,
        topics: topics(first),
      },
      {
        title: `${second}: it works locally but not in production`,
        summary: `Two replies so far, neither solved it.`,
        topics: topics(second),
      },
    ],
  }
  return by[source]
}

function termBonus(terms: string[], topics: string[]): number {
  const lower = terms.map((term) => term.toLowerCase())
  return topics.filter((topic) => lower.some((term) => term.includes(topic) || topic.includes(term))).length * 10
}
