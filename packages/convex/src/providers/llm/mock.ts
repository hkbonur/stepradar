import {
  POST_LENGTHS,
  SHORT_POST_MAX,
  namesSponsor,
  parseChatIntent,
  replyRuleCovers,
  xLength,
  type Habit,
  type LengthMix,
  type AccountProposal,
  type PostIntent,
  type PostLength,
  type ReplyOrigin,
  type ReplyThread,
  PLATFORM_DRAFT_SHAPES,
  SPONSOR_LINKS,
  REPLY_LIMITS,
  POST_PART_MAX,
  POST_TITLE_MAX,
  type Platform,
  hackerNewsTitlePrefix,
  missingReasons,
  type EngagementReasons,
} from '@influstep/shared'
import {
  type AccountPostSample,
  type LlmProvider,
  type JudgeBrief,
  type JudgeDraft,
  type PostBrief,
  type PostDraft,
  type ProposalBrief,
  type ReplyBrief,
  type ReplyDraft,
  type TaskReportArgs,
  type TaskSignal,
  type VoiceBrief,
  type VoiceDraft,
} from './types'

/**
 * A template writer. Deterministic from the brief, so a seeded demo and a
 * test read the same post twice. It is honest about being a mock: every post
 * is about the concept. The research (the morning brief and the problem log)
 * is left unread: the templates have no place to weave it in.
 *
 * A post opens with its topic, follows its intent and length, and every
 * part is cut to the limit the brief gives it, so a mock post always passes
 * X's rules. A voice in Norwegian or Turkish puts a short native phrase in
 * front, so a smoke test shows the language reached the writer. A learned
 * voice is the counted stats in words, in the account's tone.
 *
 * A reply passes on a post one of the account's reply rules covers, read
 * word for word (shared `replyRuleCovers`), unless the operator asked for it;
 * otherwise it answers with a tip from the post's pillar, fit to X's limit.
 *
 * The chat reads a message with the shared English parser, and a task report
 * lists what its data holds, saying so plainly when it holds nothing.
 */
export const mockLlm: LlmProvider = {
  name: 'mock',
  async writePost(brief: PostBrief): Promise<PostDraft> {
    const topic = topicOf(brief)
    if (brief.account.platform === 'x') return { title: titleFor(brief.pillar, topic), parts: postPartsFor(brief, topic) }
    return onePartPost(brief, topic)
  },
  async judgePost(brief: JudgeBrief): Promise<JudgeDraft> {
    return judgmentFor(brief)
  },
  async writeReply(brief: ReplyBrief): Promise<ReplyDraft> {
    if (!brief.operatorAsked) {
      const rule = brief.memory.rules.find((candidate) => replyRuleCovers(candidate, brief.thread.text))
      if (rule !== undefined) return { kind: 'skip', reason: `My rule "${rule}" covers this post.` }
    }
    const text = replyTextFor(brief)
    // Hacker News gets talking points for the operator to write from, not a comment.
    return {
      kind: 'reply',
      text: PLATFORM_DRAFT_SHAPES[brief.platform] === 'points' ? `- ${text}` : fit(text, REPLY_LIMITS[brief.platform]),
    }
  },
  async learnVoice(brief: VoiceBrief): Promise<VoiceDraft> {
    const { stats } = brief
    const mostly = LENGTH_WORDS[dominantLength(stats.lengthMix)]
    return {
      language: majorityLanguage([...brief.top, ...brief.newest]),
      summary: `${brief.account.name} mostly writes ${mostly}, in a ${brief.account.tone} tone. Learned from ${stats.sampleSize} of the account's own posts.`,
      traits: [`Mostly ${mostly}`, EMOJI_TRAITS[stats.emoji], HASHTAG_TRAITS[stats.hashtags], `Tone: ${brief.account.tone}`],
    }
  },
  async proposeAccount(brief) {
    return proposalFor(brief)
  },
  async reply(args) {
    const last = args.history.at(-1)
    if (args.directive) return `Noted. From now on: "${args.directive}". The next posts and replies follow it.`
    if (!last) return `Hi, I am ${args.account.name}. Tell me what to focus on, or ask what is planned.`
    // A conversation changes nothing, so the reply says what would: a directive, a plan change or a task.
    return `Nothing changed. Say "focus on ..." or "stop ..." for a directive, ask me to move, drop or replace a post, or ask for a research brief, a comment digest or an analytics summary.`
  },
  async interpret(args) {
    return parseChatIntent(args.text)
  },
  async taskReport(args) {
    return taskReportText(args)
  },
}

/**
 * A mock judgment, deterministic from the words (shared judge.ts): a first
 * line to read on when there is one; a reason to comment only where the post
 * asks something; a reason to like where it gives a number or steps; a reason
 * to follow where it teaches, tells or shows. The fix names what is missing.
 */
function judgmentFor(brief: JudgeBrief): JudgeDraft {
  const text = brief.parts.join('\n')
  const [first = ''] = text.split('\n')
  const reasons: EngagementReasons = {
    read: first.trim() === '' ? null : `The first line, "${first.slice(0, 60)}", says what the post is about.`,
    comment: text.includes('?') ? 'It asks readers something they can answer from their own work.' : null,
    like: /\d/.test(text) || brief.parts.length > 1 ? 'It gives something specific they can use.' : null,
    follow: ['teach', 'inform', 'show'].includes(brief.intent)
      ? `It shows more of ${brief.account.niche} is coming from this account.`
      : null,
  }
  const missing = missingReasons(reasons)
  return {
    reasons,
    fix:
      missing.length === 0
        ? ''
        : `Give readers a reason to ${missing.join(' and ')}: end on a question they can answer from their own work.`,
  }
}

/** How many titles a mock report quotes before it says how many more there are. */
const REPLY_OPENINGS: Record<ReplyOrigin, (author: ReplyThread['author']) => string> = {
  mention: (author) => (author === null ? 'Thanks for the mention!' : `Thanks for the mention, @${author.handle}!`),
  comment: () => 'Good question.',
  search: () => 'Been there.',
  pasted: () => 'Been there.',
}

/** What the mock says in each catalog reply style (shared EXPERIMENT_CATALOG.reply_style), three of each, picked by the post. */
const REPLY_BODIES: Record<string, readonly string[]> = {
  tip: [
    'Cap the retries, log the last one, and alert on it. The first failure is never the one that hurts.',
    'Name every step and write down what you changed before the next change. Most of these bugs are naming bugs.',
    'Decide what happens when the other side never answers. Build that path first; the happy one is easy.',
  ],
  question: [
    'What does your flow do when a step fails halfway: retry, or stop and tell you?',
    'Which step broke first for you, the trigger or the one after it?',
    'Do you know today when the other side never answers, or only when a customer asks?',
  ],
  story: [
    'Same thing hit me last month: a retry ran twice and sent two invoices. Now every step has a name and a cap.',
    'I lost a weekend to this once. The fix was boring: one log line per step, and an alert on the last retry.',
    'My first client flow broke on a Monday too. A missing answer, not a bug; I build that path first now.',
  ],
}

/**
 * A reply in the account's voice: an opening for where the post came from,
 * then one line in the reply's style, picked by the post, and a second line
 * when it runs long. A style the catalog does not list (an operator's own
 * variant) gets the control's tip: only a real model reads the description.
 */
function replyTextFor(brief: ReplyBrief): string {
  if (brief.mayNameSponsor && brief.operatorAsked && namesSponsor(brief.thread.text, brief.sponsorName))
    return `${REPLY_OPENINGS[brief.origin](brief.thread.author)} ${brief.affiliationLine} ${brief.sponsorName} does that. ${brief.sponsorPitch}`
  const bodies = REPLY_BODIES[brief.style.key] ?? REPLY_BODIES.tip
  if (bodies === undefined) throw new Error('the mock writer has no tips')
  const body = bodies[brief.thread.text.length % bodies.length]
  if (body === undefined) throw new Error(`the mock writer has no "${brief.style.key}" lines`)
  const more = brief.length.key === 'long' ? ` ${LONG_REPLY_LINE}` : ''
  return `${REPLY_OPENINGS[brief.origin](brief.thread.author)} ${body}${more}`
}

/** What a long mock reply adds: the detail that helps. */
const LONG_REPLY_LINE = 'The detail that saved me: log the event id before the first step runs, so a retry can tell it already happened.'

const REPORT_TITLES = 3

function taskReportText(args: TaskReportArgs): string {
  if (args.task === 'research_brief') {
    const on = args.topic === null ? '' : ` on ${args.topic}`
    if (args.data.signals.length === 0) return `No new signals${on}.`
    return `${counted(args.data.signals.length, 'new signal')}${on}: ${quotedTitles(args.data.signals, args.data.signals.length)}.`
  }
  if (args.task === 'comment_digest') {
    const window = `in the last ${args.data.days} days`
    if (args.data.total === 0) return `No comments ${window}.`
    return `${counted(args.data.total, 'comment')} ${window}. Most liked: ${quotedTitles(args.data.comments, args.data.total)}.`
  }
  const { funnel, days, reachLabel, currency } = args.data
  if (funnel.items === 0 && (funnel.clicks ?? 0) === 0 && funnel.signups === 0 && funnel.paid === 0)
    return `Nothing posted, clicked or converted in the last ${days} days.`
  const mock = funnel.mock ? ' Some of it is mock data.' : ''
  const reach = funnel.reach === null ? `no ${reachLabel.toLowerCase()} read` : `${reachLabel.toLowerCase()} ${funnel.reach}`
  const comments = funnel.replies === null ? 'no comments read' : counted(funnel.replies, 'comment')
  const clicks = funnel.clicks === null ? 'no clicks counted' : counted(funnel.clicks, 'click')
  return `Last ${days} days: ${counted(funnel.items, 'item')} posted, ${reach}, ${comments}, ${clicks}, ${counted(funnel.signups, 'signup')}, ${funnel.paid} paid (${funnel.value} ${currency}).${mock}`
}

function counted(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

/** The first titles, quoted, and how many of `total` are left unquoted. */
function quotedTitles(signals: TaskSignal[], total: number): string {
  const quoted = signals
    .slice(0, REPORT_TITLES)
    .map((signal) => `"${signal.title}"`)
    .join('; ')
  const more = total - Math.min(signals.length, REPORT_TITLES)
  return more > 0 ? `${quoted}; and ${more} more` : quoted
}

/** A short phrase in the voice's language, so the language visibly took effect; English and the rest get none. */
const LANGUAGE_PREFIXES: Partial<Record<string, string>> = { nb: 'Kort fortalt:', tr: 'Kısaca:' }

interface PostText {
  subject: string
  sponsor: string | null
}

/** A one-liner per intent. It has no room for the affiliation line, so it leaves the sponsor out (ground rule 1). Every ask is a question. */
const SHORT_LINES: Record<PostIntent, (text: PostText) => string> = {
  ask: (text) => `What breaks first in your ${text.subject}?`,
  inform: (text) => `Worth knowing: most ${text.subject} failures start at the first step.`,
  share: (text) => `Found a ${text.subject} habit worth keeping: name every step.`,
  teach: (text) => `Tip: test the failure path of your ${text.subject} first.`,
  show: (text) => `I built a small tool for ${text.subject}. What would you want it to do next?`,
}

/** A full post per intent: the hook after the topic, then the body. Every ask hook is a question. */
const MEDIUM_LINES: Record<PostIntent, { hook: string; body: (text: PostText) => string }> = {
  ask: {
    hook: 'what is your take?',
    body: (text) =>
      `What is the one step in your ${text.subject} that still breaks, and how do you catch it before a customer does? I read every reply.`,
  },
  inform: {
    hook: 'what changed and why it matters.',
    body: () =>
      'The default moved, and flows built on the old one fail quietly. It matters because nobody gets an alert. Check yours this week.',
  },
  share: {
    hook: 'something I found.',
    body: () =>
      "A plain log view that shows each step's input and output. It cut my debugging time in half. Worth ten minutes of your week.",
  },
  teach: {
    hook: 'how to fix it today.',
    body: () => 'Run it once and watch where it stops. Read the log before you touch the config. Then fix the one step that stops.',
  },
  show: {
    hook: 'something I built.',
    body: (text) =>
      `${text.sponsor ?? 'It'} sends a form to one customer and brings the answers back into the flow. I built it because my ${text.subject} kept stalling on a missing answer. What would you want it to do next?`,
  },
}

/** A thread per intent: the opener after the topic, then numbered parts. */
const THREAD_LINES: Record<PostIntent, (text: PostText) => string[]> = {
  ask: (text) => [
    'what would you do? Three questions, answer any one.',
    `1. Where does your ${text.subject} stop most often?`,
    '2. What do you check first when it does?',
    '3. What would you automate next if it never broke?',
  ],
  inform: () => [
    'what changed and why it matters.',
    '1. What changed: the default moved, and old flows fail quietly.',
    '2. Why it matters: nobody gets an alert, so customers find it first.',
    '3. What to do: run each flow once this week and read the log.',
  ],
  share: () => [
    'three things I found this week.',
    "1. A log view that shows every step's input and output.",
    '2. A habit: write down what you changed before the next change.',
    '3. A rule: one flow, one owner, one alert.',
  ],
  teach: () => [
    'the short version.\nThree steps, in order.',
    '1. Run it once and watch where it stops. Read the log before you touch the config.',
    '2. Fix it the plain way, no plugins. Then test the failure path, not just the one that works.',
    '3. Keep the fix small enough to undo.',
  ],
  show: (text) => [
    'something I built, and why.',
    `1. What it does: ${text.sponsor ?? 'it'} sends a form to one customer and brings the answers back into the flow.`,
    `2. Why: my ${text.subject} kept stalling on a missing answer.`,
    '3. What I want to hear: what would you want it to do next?',
  ],
}

/** What a post is about, with the sponsor when its slot carries one. */
function aboutOf(brief: PostBrief): PostText {
  return { subject: brief.pillar.toLowerCase(), sponsor: brief.sponsor === null ? null : brief.sponsorName }
}

/**
 * The sentence that names the sponsor, with the affiliation line as written
 * (ground rule 1) and the post's link, which Hacker News takes as the
 * submission's URL instead; empty when the slot carries none.
 */
function sponsorLineOf(brief: PostBrief): string {
  if (brief.sponsor === null) return ''
  const line = `${brief.affiliationLine} I collect what a flow needs from a customer with ${brief.sponsorName}`
  if (SPONSOR_LINKS[brief.account.platform].placement === 'submission') return `${line}.`
  return `${line}: ${brief.sponsor.link}`
}

/**
 * A post on a platform that takes one part: LinkedIn's ready to post, Reddit's
 * and a forum's a title and the body the operator rewrites, Hacker News's a
 * title for where it goes and talking points the operator writes from
 * (shared post-rules.ts).
 */
function onePartPost(brief: PostBrief, topic: string): PostDraft {
  const platform = brief.account.platform
  const lines = MEDIUM_LINES[brief.intent]
  const body = [sponsorLineOf(brief), lines.body(aboutOf(brief))].filter(Boolean).join(' ')
  if (platform === 'hackernews') {
    const prefix = hackerNewsTitlePrefix(brief.community?.name ?? null)
    const points = [`- ${lines.hook}`, `- ${body}`, `Fact: ${brief.signals[0]?.url ?? 'what you measured yourself'}`]
    return { title: postedTitle(platform, `${prefix}${topic}`), parts: [points.join('\n')] }
  }
  if (PLATFORM_DRAFT_SHAPES[platform] === 'rewrite') return { title: postedTitle(platform, `${topic}: ${lines.hook}`), parts: [body] }
  return { title: titleFor(brief.pillar, topic), parts: [`${topic}: ${lines.hook}\n\n${body}`.slice(0, POST_PART_MAX[platform])] }
}

/** A title cut to what its platform posts. */
function postedTitle(platform: Platform, title: string): string {
  const max = POST_TITLE_MAX[platform]
  if (max === null) throw new Error(`${platform} posts no title`)
  return title.slice(0, max)
}

function postPartsFor(brief: PostBrief, topic: string): string[] {
  const prefix = brief.voice ? LANGUAGE_PREFIXES[brief.voice.language.toLowerCase().split('-')[0] ?? ''] : undefined
  const lead = (line: string) => (prefix ? `${prefix} ${line}` : line)
  const text = aboutOf(brief)
  const sponsorLine = sponsorLineOf(brief)
  const limit = POST_PART_MAX.x
  // A one-liner leaves the sponsor out (SHORT_LINES); the planner never gives one the sponsor.
  if (brief.length === 'short') return [fit(lead(SHORT_LINES[brief.intent](text)), Math.min(SHORT_POST_MAX, limit))]
  if (brief.length === 'medium') {
    const lines = MEDIUM_LINES[brief.intent]
    // The sponsor goes before the body, so cutting to the limit never cuts the mention.
    const part = fit([lead(`${topic}: ${lines.hook}`), sponsorLine, lines.body(text)].filter(Boolean).join('\n'), limit)
    if (xLength(part) <= SHORT_POST_MAX) throw new Error(`the mock writer's full post came out as a one-liner: ${part}`)
    return [part]
  }
  const [opener, ...rest] = THREAD_LINES[brief.intent](text)
  const last = rest.pop()
  if (opener === undefined || last === undefined) throw new Error('a mock thread needs an opener and a last part')
  // Nothing is appended on X: the last part ends on its own point, with the sponsor mention when the slot carries one.
  return [lead(`${topic}: ${opener}`), ...rest, [last, sponsorLine].filter(Boolean).join(' ')].map((part) => fit(part, limit))
}

const LENGTH_WORDS: Record<PostLength, string> = { short: 'one-liners', medium: 'full posts', long: 'threads' }

const EMOJI_TRAITS: Record<Habit, string> = {
  never: 'No emoji',
  rare: 'An emoji now and then, never more than one',
  often: 'Emoji in most posts',
}

const HASHTAG_TRAITS: Record<Habit, string> = {
  never: 'No hashtags',
  rare: 'A hashtag now and then, at the end',
  often: 'Hashtags on most posts',
}

/** The length with the largest share; a tie goes to the shorter one. */
function dominantLength(mix: LengthMix): PostLength {
  let best: PostLength = 'short'
  for (const length of POST_LENGTHS) if (mix[length] > mix[best]) best = length
  return best
}

/** The language most of the posts carry; English when X named none. A tie goes to the language seen first. */
function majorityLanguage(posts: AccountPostSample[]): string {
  const counts = new Map<string, number>()
  for (const post of posts) {
    if (post.lang === null) continue
    counts.set(post.lang, (counts.get(post.lang) ?? 0) + 1)
  }
  let best: { lang: string; count: number } | null = null
  for (const [lang, count] of counts) if (!best || count > best.count) best = { lang, count }
  return best?.lang ?? 'en'
}

/**
 * What a mock post is about: a model's pillar, never its words, since the
 * writer refuses a copy; a round-up's count of questions; a reworked post's
 * title; a launch's news; else the post's first signal, else its concept.
 */
function topicOf(brief: PostBrief): string {
  const basis = brief.basis
  if (basis === null) return brief.signals[0]?.title ?? brief.concept
  switch (basis.kind) {
    case 'model':
      return `What people answered most about ${brief.pillar}`
    case 'roundup':
      return `${basis.questions.length} questions people asked about ${basis.pillar}`
    case 'rework':
      return `What worked on ${basis.post.placeName}: ${basis.post.title}`
    case 'launch':
      return `New in ${brief.sponsorName}: ${basis.what}`
  }
}

function titleFor(pillar: string, topic: string): string {
  return `${topic} (${pillar})`.slice(0, 90)
}

/** Drops whole words from the end until the text weighs at most `limit` on X, and marks the cut with an ellipsis. */
function fit(text: string, limit: number): string {
  if (xLength(text) <= limit) return text
  const words = text.split(' ')
  while (words.length > 1 && xLength(`${words.join(' ')}…`) > limit) words.pop()
  return `${words.join(' ')}…`
}

const SMALL_WORDS = new Set(['a', 'an', 'and', 'the', 'for', 'of', 'in', 'on', 'to', 'with', 'how', 'your', 'small'])

function titleCase(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1)
}

/**
 * A mock proposal, deterministic from the niche: the niche's first real word
 * is the topic, and the pillars, bio and bible are templates around the
 * topic, the audience and the account's name.
 */
function proposalFor(brief: ProposalBrief): AccountProposal {
  const words = brief.niche.split(/[^A-Za-z0-9]+/).filter((word) => word.length > 0)
  const topicWord = words.find((word) => !SMALL_WORDS.has(word.toLowerCase())) ?? words[0] ?? 'Craft'
  const topic = titleCase(topicWord)
  return {
    tone: 'plain, friendly, specific',
    pillars: [`${topic} how-tos`, `${topic} mistakes and fixes`, `${topic} questions answered`],
    bio: `${topic} for ${brief.audience}, one short post at a time.`,
    affiliationLine: `I'm building ${brief.sponsorName}, so take this with salt.`,
    bible: [
      `${brief.name} talks to ${brief.audience} as "you" and shows the fix before explaining it.`,
      'Short sentences. One idea per post. Admits when a tool is the wrong choice.',
      `Never says "game changer" or "insane". Mentions ${brief.sponsorName} only in its own words, never as an ad read.`,
    ].join(' '),
  }
}
