import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import {
  POST_INTENT_BRIEFS,
  POST_INTENT_LABELS,
  POST_KIND_LABELS,
  PILLARS_MAX,
  PILLARS_MIN,
  THREAD_PARTS_MAX,
  THREAD_PARTS_MIN,
  VOICE_TRAITS_MAX,
  SIGNAL_SOURCE_LABELS,
  WEEKDAYS,
  chatIntentSchema,
  type ChatIntent,
  type Habit,
  type AccountProposal,
  type ReplyOrigin,
  TALKING_POINTS_MAX,
  handleOf,
  type DraftShape,
  PLATFORM_DRAFT_SHAPES,
  SPONSOR_LINKS,
  REPLY_LIMITS,
  communityLabel,
  POST_PART_MAX,
  POST_TITLE_MAX,
  hackerNewsTitlePrefix,
  ENGAGEMENTS,
  ENGAGEMENT_DRIVERS,
  ENGAGEMENT_QUESTIONS,
} from '@influstep/shared'
import type { WriterMemory } from '../../core/memory'
import { requireEnv } from '../../lib/env'
import {
  POST_LENGTH_TARGETS,
  type AccountPostSample,
  type ChatTurn,
  type InterpretArgs,
  type LlmProvider,
  type PlanRow,
  type JudgeBrief,
  type JudgeDraft,
  type PostBrief,
  type PostDraft,
  type PostedLately,
  type ProposalBrief,
  type ReplyBrief,
  type ReplyDraft,
  type AccountBrief,
  type TaskReportArgs,
  type TaskSignal,
  type VoiceBrief,
  type VoiceDraft,
  type WriterResearch,
} from './types'

const MODEL = 'claude-opus-5-5'

const postDraftSchema = z.object({
  title: z.string(),
  parts: z.array(z.string()),
})

// Structured outputs take no null in a field's place reliably, so an engagement the post gives no reason for is an empty string.
const judgeDraftSchema = z.object({
  read: z.string(),
  comment: z.string(),
  like: z.string(),
  follow: z.string(),
  fix: z.string(),
})

// One flat shape: structured outputs take no union. A skip has a reason and an empty text, a reply the reverse.
const replyDraftSchema = z.object({
  skip: z.boolean(),
  reason: z.string(),
  text: z.string(),
})

// Structured outputs drop array bounds from the schema they send, so the trait count is said in the prompt and checked after parsing.
const voiceDraftSchema = z.object({
  language: z.string(),
  summary: z.string(),
  traits: z.array(z.string()),
})

// Structured outputs drop array bounds, so the pillar count is said in the prompt; the operator edits the proposal anyway.
const accountProposalSchema = z.object({
  affiliationLine: z.string(),
  tone: z.string(),
  pillars: z.array(z.string()),
  bio: z.string(),
  bible: z.string(),
})

/** The Anthropic client every Claude adapter calls through: the llm here and the classifier. */
export function anthropicClient(): Anthropic {
  return new Anthropic({ apiKey: requireEnv('ANTHROPIC_API_KEY') })
}

/**
 * The judge's standing instructions (shared judge.ts): reasons from the
 * reader's side, from how people read and act, never from why the account
 * should post or how other posts did.
 */
const JUDGE_SYSTEM = [
  'You are the judge. Before a post goes out, you read it as one of the people it is for would, scrolling past many others, and decide whether they have reasons to engage with it.',
  "Answer four questions from the reader's side, each in one plain sentence, or with an empty string when the post gives no such reason:",
  ...ENGAGEMENTS.map(
    (engagement) => `- ${engagement}: ${ENGAGEMENT_QUESTIONS[engagement]} People do when there is ${ENGAGEMENT_DRIVERS[engagement]}.`
  ),
  'Judge from how people read and act, not from how other posts did, and never give a reason the account has for posting it: "it promotes the product" or "it keeps the cadence" are no reasons for a reader.',
  'A vague reason is no reason. Name what in the post gives it: the question it asks, the tip it gives, the line that opens the gap.',
  'Then fix: one or two sentences on what would give the reasons that are missing, said to the writer, or an empty string when nothing is missing.',
].join('\n')

function accountSystem(account: AccountBrief): string {
  return [
    `You are ${account.name} (${handleOf(account)}), who posts and replies on ${account.placeName} in the niche "${account.niche}".`,
    account.audience ? `You talk to: ${account.audience}.` : '',
    `Tone: ${account.tone}.`,
    `Content pillars: ${account.pillars.join('; ')}.`,
    `Account bible:\n${account.bible}`,
  ].join('\n')
}

export const anthropicLlm: LlmProvider = {
  name: 'anthropic',
  async writePost(brief: PostBrief): Promise<PostDraft> {
    const response = await anthropicClient().messages.parse({
      model: MODEL,
      max_tokens: 8000,
      output_config: { effort: 'medium', format: zodOutputFormat(postDraftSchema) },
      system: [{ type: 'text', text: postSystem(brief.account), cache_control: { type: 'ephemeral' } }],
      messages: [
        {
          role: 'user',
          content: [
            `Intent: ${POST_INTENT_LABELS[brief.intent]}. ${POST_INTENT_BRIEFS[brief.intent]}`,
            `Hook: ${brief.hook.description}`,
            `Ending: ${brief.callToAction.description}`,
            postShapeInstruction(brief),
            brief.community?.rules
              ? `The rules of ${communityLabel(brief.account.platform, brief.community.name)}, which win over anything else here:\n${brief.community.rules}`
              : '',
            voiceInstruction(brief),
            examplesInstruction(brief.examples),
            postedInstruction(brief.posted, 'posts'),
            `Account bible:\n${brief.account.bible}`,
            memoryInstruction(brief.memory),
            brief.directives.length > 0 ? `Standing directives from the operator:\n- ${brief.directives.join('\n- ')}` : '',
            `Concept: ${brief.concept}`,
            `Pillar: ${brief.pillar}`,
            postSponsorInstruction(brief),
            basisInstruction(brief),
            brief.signals.length > 0
              ? `What the audience is talking about:\n${brief.signals.map((signal) => `- ${signalLine(signal)}`).join('\n')}`
              : '',
            movedInstruction(brief.research),
            problemsInstruction(brief.research),
            brief.problems.length > 0 ? `Your last draft broke these rules. Fix every one:\n- ${brief.problems.join('\n- ')}` : '',
            judgedInstruction(brief),
            POST_TITLE_MAX[brief.account.platform] === null
              ? "Return a short title for the operator's list, in English, which is never posted, and the parts in order."
              : `Return the title as ${brief.account.placeName} shows it, and the parts in order.`,
          ]
            .filter(Boolean)
            .join('\n\n'),
        },
      ],
    })
    if (response.stop_reason === 'refusal') throw new Error('The model declined to write this post')
    if (!response.parsed_output) throw new Error('The model returned no parseable post')
    const { title, parts } = response.parsed_output
    return { title, parts }
  },
  async judgePost(brief: JudgeBrief): Promise<JudgeDraft> {
    const response = await anthropicClient().messages.parse({
      model: MODEL,
      max_tokens: 2000,
      output_config: { effort: 'medium', format: zodOutputFormat(judgeDraftSchema) },
      system: [{ type: 'text', text: JUDGE_SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [
        {
          role: 'user',
          content: [
            `The post goes out on ${brief.account.placeName}${brief.community === null ? '' : ` in ${communityLabel(brief.account.platform, brief.community)}`}, from an account in the niche "${brief.account.niche}"${brief.account.audience ? ` that talks to ${brief.account.audience}` : ''}. What it sets out to do: ${POST_INTENT_LABELS[brief.intent].toLowerCase()}.`,
            `<post>\n${brief.title}\n\n${brief.parts.join('\n\n')}\n</post>`,
          ].join('\n\n'),
        },
      ],
    })
    if (response.stop_reason === 'refusal') throw new Error('The model declined to judge this post')
    if (!response.parsed_output) throw new Error('The model returned no parseable judgment')
    const { fix, ...answers } = response.parsed_output
    const reason = (text: string) => (text.trim() === '' ? null : text.trim())
    return {
      reasons: { read: reason(answers.read), comment: reason(answers.comment), like: reason(answers.like), follow: reason(answers.follow) },
      fix: fix.trim(),
    }
  },
  async writeReply(brief: ReplyBrief): Promise<ReplyDraft> {
    const response = await anthropicClient().messages.parse({
      model: MODEL,
      max_tokens: 4000,
      output_config: { effort: 'low', format: zodOutputFormat(replyDraftSchema) },
      system: [{ type: 'text', text: postSystem(brief.account), cache_control: { type: 'ephemeral' } }],
      messages: [
        {
          role: 'user',
          content: [
            `Write a reply on ${brief.account.placeName} to this thread${threadPlace(brief)}. ${ORIGIN_CONTEXT[brief.origin]}${brief.pillar === null ? '' : ` Your pillar it touches: ${brief.pillar}.`}`,
            `<thread>\n${brief.thread.title === null ? '' : `${brief.thread.title}\n\n`}${brief.thread.text}\n</thread>`,
            brief.community === null
              ? ''
              : `The rules of ${communityLabel(brief.platform, brief.community.name)}, which win over anything else here:\n${brief.community.rules}`,
            voiceInstruction(brief),
            `Account bible:\n${brief.account.bible}`,
            postedInstruction(brief.posted, 'replies'),
            memoryInstruction(brief.memory),
            brief.directives.length > 0 ? `Standing directives from the operator:\n- ${brief.directives.join('\n- ')}` : '',
            replySponsorInstruction(brief),
            'Speak only as the account: never as a customer, a reviewer or someone who happened to find a product.',
            brief.operatorAsked
              ? 'Your operator asked you to answer this thread, so answer it: skip is false.'
              : 'Pass on the thread (skip true, with a one-sentence reason in your own words) when one of your rules says not to answer it, or when you have nothing worth adding. Otherwise skip is false and the reason is empty.',
            `Reply style: ${brief.style.description}`,
            `Reply length: ${brief.length.description}`,
            SHAPE_INSTRUCTIONS[PLATFORM_DRAFT_SHAPES[brief.platform]](brief),
            brief.problems.length > 0 ? `Your last draft broke these rules. Fix every one:\n- ${brief.problems.join('\n- ')}` : '',
          ]
            .filter(Boolean)
            .join('\n\n'),
        },
      ],
    })
    if (response.stop_reason === 'refusal') throw new Error('The model declined to write this reply')
    if (!response.parsed_output) throw new Error('The model returned no parseable reply')
    const { skip, reason, text } = response.parsed_output
    if (skip && !brief.operatorAsked) {
      if (reason.trim() === '') throw new Error('The model passed on the post without a reason')
      return { kind: 'skip', reason: reason.trim() }
    }
    return { kind: 'reply', text: text.trim() }
  },
  async learnVoice(brief: VoiceBrief): Promise<VoiceDraft> {
    const { stats } = brief
    const response = await anthropicClient().messages.parse({
      model: MODEL,
      max_tokens: 8000,
      output_config: { effort: 'medium', format: zodOutputFormat(voiceDraftSchema) },
      system: [
        {
          type: 'text',
          text: [
            `You are the analyst for ${brief.account.name} (@${brief.account.handle}), an account on X in the niche "${brief.account.niche}".`,
            "Read the account's own posts and describe how it writes, so a writer can post in the same voice. Describe the style, not the topics.",
          ].join('\n'),
        },
      ],
      messages: [
        {
          role: 'user',
          content: [
            `Counted from ${stats.sampleSize} original posts (replies to others left out): ${Math.round(stats.lengthMix.short * 100)}% one-liners, ${Math.round(stats.lengthMix.medium * 100)}% full posts, ${Math.round(stats.lengthMix.long * 100)}% threads; emoji ${stats.emoji}; hashtags ${stats.hashtags}. These are facts; do not restate them as traits.`,
            `The posts with the most likes and reposts:\n${samplesBlock(brief.top)}`,
            brief.newest.length > 0 ? `The newest posts:\n${samplesBlock(brief.newest)}` : '',
            [
              'Return:',
              '- language: the BCP 47 tag of the language the account posts in (en, nb, tr, ...), the one most of its posts are written in.',
              '- summary: two or three sentences on how the account sounds, written for the writer who will imitate it.',
              `- traits: 1 to ${VOICE_TRAITS_MAX} recurring moves, each a short phrase (how it opens, line breaks, lists, punctuation, questions, how it closes).`,
            ].join('\n'),
          ]
            .filter(Boolean)
            .join('\n\n'),
        },
      ],
    })
    if (response.stop_reason === 'refusal') throw new Error('The model declined to describe this voice')
    if (!response.parsed_output) throw new Error('The model returned no parseable voice')
    const { language, summary } = response.parsed_output
    const traits = response.parsed_output.traits.map((trait) => trait.trim()).filter((trait) => trait.length > 0)
    if (language.trim().length === 0) throw new Error('The model returned a voice without a language')
    if (summary.trim().length === 0) throw new Error('The model returned a voice without a summary')
    if (traits.length === 0 || traits.length > VOICE_TRAITS_MAX)
      throw new Error(`The model returned ${traits.length} traits; a voice has 1 to ${VOICE_TRAITS_MAX}`)
    return { language: language.trim(), summary: summary.trim(), traits }
  },
  async proposeAccount(brief: ProposalBrief): Promise<AccountProposal> {
    const roster = brief.roster.map((account) => `- ${account.name} (${handleOf(account)}): ${account.niche}`).join('\n')
    const response = await anthropicClient().messages.parse({
      model: MODEL,
      max_tokens: 4000,
      output_config: { effort: 'medium', format: zodOutputFormat(accountProposalSchema) },
      system: [
        {
          type: 'text',
          text: [
            'You help the operator of Influstep set up one of their own accounts. Influstep drafts posts and replies for it, which the operator posts by hand, so the people there discover the sponsor.',
            `The sponsor is ${brief.sponsorName}: ${brief.sponsorPitch} The account helps people first: the sponsor comes up only sometimes, in its own words.`,
          ].join('\n'),
        },
      ],
      messages: [
        {
          role: 'user',
          content: [
            `Propose how ${brief.name} sounds and what it covers on ${brief.placeName}. Niche: ${brief.niche}. Audience: ${brief.audience}.`,
            roster ? `The workspace already runs these; do not repeat their angle:\n${roster}` : '',
            [
              'Return:',
              '- tone: three to six words on how it sounds.',
              `- pillars: ${PILLARS_MIN} to ${PILLARS_MAX} content pillars, each two to five words, the recurring topics it covers.`,
              '- bio: one sentence for its profile.',
              '- bible: three to five sentences on how it speaks, what it shows, and what it never says.',
              `- affiliationLine: one short sentence, in its voice, that says the operator builds ${brief.sponsorName} and names it ("I'm building ${brief.sponsorName}, so take this with salt"). Every draft that names the sponsor says it.`,
            ].join('\n'),
          ]
            .filter(Boolean)
            .join('\n\n'),
        },
      ],
    })
    if (response.stop_reason === 'refusal') throw new Error('The model declined to propose an account')
    if (!response.parsed_output) throw new Error('The model returned no parseable account')
    const proposal = response.parsed_output
    return {
      tone: proposal.tone.trim(),
      pillars: proposal.pillars.map((pillar) => pillar.trim()).filter((pillar) => pillar.length > 0),
      bio: proposal.bio.trim(),
      bible: proposal.bible.trim(),
      affiliationLine: proposal.affiliationLine.trim(),
    }
  },
  async reply(args) {
    const response = await anthropicClient().messages.create({
      model: MODEL,
      max_tokens: 2000,
      output_config: { effort: 'low' },
      system: [
        { type: 'text', text: accountSystem(args.account), cache_control: { type: 'ephemeral' } },
        {
          type: 'text',
          text: `You are chatting with your operator inside Influstep. Answer in two or three sentences. ${args.directive ? `The operator's last message was stored as a standing directive: "${args.directive}". Confirm it and say how the next posts and replies change.` : ''}`,
        },
      ],
      messages: args.history.map((turn) => ({ role: turn.author === 'operator' ? 'user' : 'assistant', content: turn.text })),
    })
    const text = response.content.find((block) => block.type === 'text')
    if (!text) throw new Error('The model returned no text')
    return text.text
  },
  async interpret(args) {
    let response
    try {
      response = await anthropicClient().messages.parse({
        model: MODEL,
        max_tokens: 8000,
        output_config: { effort: 'low', format: zodOutputFormat(chatIntentSchema) },
        system: [{ type: 'text', text: INTERPRET_SYSTEM, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: interpretRequest(args) }],
      })
    } catch (error) {
      // The SDK checks the answer against the schema itself and throws a plain AnthropicError when it does not fit
      // (a code with a dash, say). A reading that does not fit changes nothing, so it is conversation; a failed
      // request (an APIError) stays an error, and the chat says it could not read the message.
      if (error instanceof Anthropic.APIError || !(error instanceof Anthropic.AnthropicError)) throw error
      console.warn(`The interpreter's answer did not fit the chat intent schema; it is read as conversation. ${error.message}`)
      return CONVERSATION
    }
    if (response.stop_reason === 'refusal') throw new Error('The model declined to read this message')
    if (!response.parsed_output) throw new Error('The model returned no parseable reading of the message')
    return response.parsed_output
  },
  async taskReport(args) {
    const response = await anthropicClient().messages.create({
      model: MODEL,
      max_tokens: 8000,
      output_config: { effort: 'low' },
      system: [
        { type: 'text', text: accountSystem(args.account), cache_control: { type: 'ephemeral' } },
        { type: 'text', text: TASK_REPORT_INSTRUCTION },
      ],
      messages: [{ role: 'user', content: taskRequest(args) }],
    })
    if (response.stop_reason === 'refusal') throw new Error('The model declined to write this report')
    const text = response.content.find((block) => block.type === 'text')
    if (!text) throw new Error('The model returned no text')
    return text.text
  },
}

const CONVERSATION: ChatIntent = { kind: 'conversation' }

/** What the interpreter does, for every message alike, so it caches; the account, the plan and the message follow. */
const INTERPRET_SYSTEM = [
  "You read a message the operator sends to one of their X accounts in Influstep, which drafts that account's posts and replies, and say what the message asks for. You never answer the message.",
  'Kinds:',
  '- conversation: a question, a remark, thanks, or anything you are unsure about. When in doubt, it is conversation.',
  '- directive: a standing rule for the next posts and replies ("focus on beginners", "stop saying guys"). text is the rule in the operator\'s words.',
  "- replace: replace one planned post with a new one. concept is the new post's idea in a short phrase.",
  '- move: move one planned post to another day of its week. to is that weekday.',
  '- drop: drop one planned post.',
  '- task: a report one agent writes. research_brief is research on a subject; comment_digest is what people say in the comments; analytics_summary is how the account is doing in numbers. topic only when the message names a subject.',
  '- remember: something the operator wants the account to keep knowing ("remember that readers hate the word guys", "keep in mind most readers self-host"). memory is rule when it says what to always or never do, else fact; text is what to remember in the operator\'s words, without "remember that". A standing instruction for the next posts without "remember" is a directive. A rule about whom or what the account replies to on X ("never reply to politics", "only reply to people building agents") is remember with memory rule even without "remember"; text is the rule as written.',
  `Targets: when the message names a post of the plan, set target.postId to that row's id and nothing else. "The next post" is next: true. When nothing in the plan fits, give the weekday and a keyword as the message says them, so the account can say it found no such post. Weekdays are ${WEEKDAYS.join(', ')}.`,
  'Read the earlier chat for what a short follow-up refers to ("the second one", "yes, that one").',
].join('\n')

function interpretRequest(args: InterpretArgs): string {
  return [
    `Account: ${args.account.name} (@${args.account.handle}), niche "${args.account.niche}", pillars: ${args.account.pillars.join('; ')}.`,
    args.plan.length > 0
      ? `The plan, the only posts a message can change:\n${args.plan.map(planLine).join('\n')}`
      : 'The plan is empty: no post can be changed now.',
    args.history.length > 0 ? `The chat so far:\n${args.history.map((turn) => turnLine(args.account.name, turn)).join('\n')}` : '',
    `The message to read:\n<message>\n${args.text}\n</message>`,
  ]
    .filter(Boolean)
    .join('\n\n')
}

function planLine(row: PlanRow): string {
  const pillar = row.pillar === null ? '' : `, pillar "${row.pillar}"`
  return `- id ${row.id}: ${row.weekday} ${row.plannedFor}, ${POST_KIND_LABELS[row.kind]}, "${row.title}"${pillar}, ${row.status}`
}

function turnLine(accountName: string, turn: ChatTurn): string {
  return `${turn.author === 'operator' ? 'Operator' : accountName}: ${turn.text}`
}

const TASK_REPORT_INSTRUCTION = [
  'You are answering your operator in the Influstep chat with a report one of your agents put together.',
  'Write plain text in your own voice, under 120 words, with no headings.',
  'Use only numbers that appear in the data; never estimate, total or invent one. When the data is empty, say so plainly.',
].join(' ')

function taskRequest(args: TaskReportArgs): string {
  if (args.task === 'research_brief') {
    const on = args.topic === null ? '' : ` on "${args.topic}"`
    if (args.data.signals.length === 0) return `The operator asked for a research brief${on}. There are no new signals${on}.`
    return `The operator asked for a research brief${on}. Say what people are asking about and which of it would make a good post. The ${args.data.signals.length} freshest unused signals:\n${signalsBlock(args.data.signals)}`
  }
  if (args.task === 'comment_digest') {
    const window = `in the last ${args.data.days} days`
    if (args.data.total === 0) return `The operator asked what people say in the comments. There are no comments ${window}.`
    return `The operator asked what people say in the comments. Say what they praise, ask and complain about. ${args.data.total} comments ${window}; the ${args.data.comments.length} most liked:\n${signalsBlock(args.data.comments)}`
  }
  const { funnel, days, reachLabel, currency } = args.data
  return [
    `The operator asked how the last ${days} days went. Say what stands out.`,
    `Posts and replies posted ${funnel.items}, of them read ${funnel.counted}; ${reachLabel.toLowerCase()} ${funnel.reach ?? 'not read'}, comments under them ${funnel.replies ?? 'not read'}, link clicks ${funnel.clicks ?? 'not counted, since the posts link to the sponsor directly'}, demos started ${funnel.demos}, signups ${funnel.signups}, trials ${funnel.trials}, paid ${funnel.paid}, value ${funnel.value} ${currency}.`,
    `The ${reachLabel.toLowerCase()} and the comments are the latest counts read from the platform for what was posted in the window; "not read" means the platform's reader read none, which is no zero. Conversions are first-touch and undercount; say so if you mention them.`,
    funnel.mock ? 'Some of these numbers are mock data; say so.' : '',
  ]
    .filter(Boolean)
    .join('\n')
}

function signalsBlock(signals: TaskSignal[]): string {
  return signals.map((signal) => `- [${SIGNAL_SOURCE_LABELS[signal.source]}] ${signalLine(signal)}`).join('\n')
}

/**
 * A signal as the model reads it: its title, its summary, and its link in
 * brackets. A problem from the problem log links nowhere, so it gets no
 * brackets: an empty pair would read as a source with no destination.
 */
function signalLine(signal: { title: string; summary: string; url: string }): string {
  if (signal.url === '') return `${signal.title}: ${signal.summary}`
  return `${signal.title}: ${signal.summary} (${signal.url})`
}

/**
 * The researcher's morning brief, in its own words: background for the
 * concept, never a reason to change it. Nothing before the first sweep or
 * once the brief expired.
 */
function movedInstruction(research: WriterResearch): string {
  if (research.brief === null) return ''
  return `What moved since yesterday (this morning's research brief; background for the concept, never a reason to swap it):\n${research.brief}`
}

/** The account's open problems, newest first: questions readers keep asking. Nothing while the log is empty. */
function problemsInstruction(research: WriterResearch): string {
  if (research.problems.length === 0) return ''
  return `Problems I met (your own problem log, newest first; answer one only where it fits the concept):\n- ${research.problems.join('\n- ')}`
}

/**
 * The account's memory (core/memory.ts `writerMemory`): the goal and where it
 * stands, the operator's rules, which the draft never breaks, the facts it
 * knows, and what its own experiments and reviews showed. Each part is left
 * out while it is empty.
 */
function memoryInstruction(memory: WriterMemory): string {
  return [
    `The goal you work toward: ${memory.goal}.${memory.standing === null ? '' : ` Where you stand: ${memory.standing}`}`,
    memory.rules.length > 0 ? `Rules you keep, from your memory; never break one:\n- ${memory.rules.join('\n- ')}` : '',
    memory.facts.length > 0 ? `What you know about your audience and your niche:\n- ${memory.facts.join('\n- ')}` : '',
    memory.learnings.length > 0
      ? `What you have learned from your own experiments and reviews, newest first:\n- ${memory.learnings.join('\n- ')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** The operator's pitch inside a parenthesis of the prompt: its closing full stop would end the sentence around it. */
function pitchWords(pitch: string): string {
  return pitch.trim().replace(/[.!]+$/, '')
}

/** Who writes a post. The bible, the voice and the examples follow in the request, in that order of weight. */
function postSystem(account: PostBrief['account']): string {
  return [
    `You are ${account.name} (${handleOf(account)}), who posts on ${account.placeName} in the niche "${account.niche}".`,
    `Content pillars: ${account.pillars.join('; ')}.`,
  ].join('\n')
}

/** What the post is on its platform (docs/plan.md, ground rule 6), and the limits it is written within (shared post-rules.ts). */
function postShapeInstruction(brief: PostBrief): string {
  const platform = brief.account.platform
  const community = brief.community === null ? null : communityLabel(platform, brief.community.name)
  const titleMax = POST_TITLE_MAX[platform]
  // Reddit and forums: a title and a body the operator rewrites.
  if (PLATFORM_DRAFT_SHAPES[platform] === 'rewrite' && titleMax !== null) {
    return `Write a post for ${community ?? brief.account.placeName}: a title of at most ${titleMax} characters that says plainly what it is about, and the body in one part, in plain words with no formatting. Your operator rewrites it in their own words before posting, since many communities remove machine-written text.`
  }
  if (platform === 'hackernews') {
    const start = hackerNewsTitlePrefix(brief.community?.name ?? null)
    const prefix = start === '' ? ', with no "Ask HN" or "Show HN" in front' : `, starting "${start}"`
    return `Write a post for ${community ?? 'Hacker News'}: a title of at most ${POST_TITLE_MAX.hackernews} characters${prefix}. Do not write the post's text: your operator writes it. In one part, give at most ${TALKING_POINTS_MAX} talking points, one per line beginning "- ", then the facts or links worth citing, one per line beginning "Fact: ".`
  }
  if (platform === 'linkedin') {
    return `Write one LinkedIn post: a single part of at most ${POST_PART_MAX.linkedin} characters, in short paragraphs. The first line is the hook: put the point there. End on the post's own last point: no call to follow, at most two hashtags.`
  }
  const shape =
    brief.kind === 'text'
      ? `Write one text post for X: a single part, no media. Length: ${POST_LENGTH_TARGETS[brief.length]}.`
      : `Write a thread for X of ${THREAD_PARTS_MIN} to ${THREAD_PARTS_MAX} parts. Each part reads on its own, and the first one makes the reader open the thread.`
  return [
    shape,
    'The first line of the first part is the hook: put the point there.',
    `Every part is at most ${POST_PART_MAX.x} characters, and X counts every link as 23. The operator posts the parts as you write them; nothing is added. End on the post's own last point: no sign-off, no call to follow, no link.`,
  ].join('\n')
}

/** With a learned voice, the account's language and style; without one, English in the account's tone, as before a takeover. */
function voiceInstruction(brief: Pick<PostBrief, 'voice' | 'account'>): string {
  const voice = brief.voice
  if (!voice) return `Write in English. Tone: ${brief.account.tone}.`
  return [
    `Write in the language with the BCP 47 tag "${voice.language}", in this account's voice: ${voice.summary}`,
    `Its recurring moves:\n- ${voice.traits.join('\n- ')}`,
    `Emoji: ${HABIT_WORDS[voice.emoji]}. Hashtags: ${HABIT_WORDS[voice.hashtags]}.`,
  ].join('\n')
}

const HABIT_WORDS: Record<Habit, string> = {
  never: 'never',
  rare: 'rarely, at most one',
  often: 'often',
}

function examplesInstruction(examples: string[][]): string {
  if (examples.length === 0) return ''
  const posts = examples.map((parts) => `<post>\n${parts.join('\n---\n')}\n</post>`).join('\n')
  return `Posts this account wrote itself. Imitate their style (rhythm, line breaks, length, punctuation); never copy their words or claims. A thread's parts are separated by ---.\n${posts}`
}

/** The account's posts verbatim, with their engagement, a thread's parts separated by ---. */
function samplesBlock(samples: AccountPostSample[]): string {
  return samples
    .map((sample) => `<post likes="${sample.likes}" reposts="${sample.reposts}">\n${sample.parts.join('\n---\n')}\n</post>`)
    .join('\n')
}

/**
 * What the operator posted lately, for the writer to move toward; and, where
 * it is kept, how much of the drafts they changed before posting.
 */
function postedInstruction(posted: PostedLately, what: 'posts' | 'replies'): string {
  if (posted.texts.length === 0) return ''
  const share =
    posted.editShare === null
      ? ''
      : `\nYour operator changed ${Math.round(posted.editShare * 100)}% of your drafts on average before posting them: write closer to what they post.`
  return `The ${what} your operator posted lately, newest first, in the words that went out:\n<posted>\n${posted.texts.join('\n---\n')}\n</posted>${share}`
}

/** Who wrote a thread and where, as far as the brief knows: " by Dana (@dana), in r/n8n". */
function threadPlace(brief: ReplyBrief): string {
  const author = brief.thread.author
  const by = author === null ? '' : ` by ${author.name} (${handleOf({ platform: brief.platform, handle: author.handle })})`
  return `${by}${brief.community === null ? '' : `, in ${communityLabel(brief.platform, brief.community.name)}`}`
}

/** Where the post came from, as the writer reads it: whether its author knows the account. */
const ORIGIN_CONTEXT: Record<ReplyOrigin, string> = {
  mention: 'It mentions you.',
  comment: 'It answers one of your posts.',
  search: 'You found it searching your pillars; its author does not know you yet.',
  pasted: 'Your operator found it and wants you to answer it.',
}

/** A reply leaves the sponsor out unless the operator asked for it; then it may answer what the post asks about it. */
function replySponsorInstruction(brief: ReplyBrief): string {
  if (!brief.mayNameSponsor) return `Leave ${brief.sponsorName} out of the reply.`
  const when = brief.operatorAsked ? 'Where the thread asks about it' : `Only where the thread asks for what ${brief.sponsorName} does`
  return `${when}, name ${brief.sponsorName} in your own words (${pitchWords(brief.sponsorPitch)}) and say "${brief.affiliationLine}" as written. No link. Most replies help without it.`
}

/** What the draft is on its platform (shared `PLATFORM_DRAFT_SHAPES`). */
const SHAPE_INSTRUCTIONS: Record<DraftShape, (brief: ReplyBrief) => string> = {
  text: (brief) =>
    `The reply adds something of your own, in that style, ready to post as it is: at most ${REPLY_LIMITS[brief.platform]} characters${brief.platform === 'x' ? ', and X counts a link as 23, but put no link in it' : ''}. No hashtags, no call to follow.`,
  rewrite: (brief) =>
    `Write the full reply, at most ${REPLY_LIMITS[brief.platform]} characters, in plain words with no formatting. Your operator rewrites it in their own words before posting, since many communities remove machine-written text.`,
  points: () =>
    `Do not write the comment: your operator writes it. Give at most ${TALKING_POINTS_MAX} talking points, one per line beginning "- ", then the facts or links worth citing, one per line beginning "Fact: ".`,
}

/** The judge's reading of the last draft, when it found too few reasons for readers to engage. */
function judgedInstruction(brief: PostBrief): string {
  if (brief.judged === null) return ''
  const missing = brief.judged.missing.map((engagement) => ENGAGEMENT_QUESTIONS[engagement].toLowerCase()).join(' ')
  return `The judge read your last draft from the reader's side and found no answer to: ${missing} ${brief.judged.fix} Write this one so readers have those reasons.`
}

/**
 * What a post is drawn from besides its pillar: a standout it takes the
 * topic of, in its own intent and never in the standout's words; the
 * questions a round-up answers together, naming no one who asked; one of the
 * operator's own posts that brought users elsewhere, reworked for this
 * platform; or what the sponsor just shipped.
 */
function basisInstruction(brief: PostBrief): string {
  const basis = brief.basis
  if (basis === null) return ''
  switch (basis.kind) {
    case 'model':
      return [
        'This post is modeled on a thread in your niche that people answered far more than the others found with it:',
        `<thread>\n${signalLine(basis.thread)}\n</thread>`,
        "Take its topic and what made people answer it, and write your own post on it, in this post's intent and from your own work. Never copy a sentence of it, never speak as its author, and never mention the thread.",
      ].join('\n')
    case 'roundup':
      return [
        `This post is a round-up of what people asked lately about ${basis.pillar}:`,
        basis.questions.map((question) => `- ${signalLine(question)}`).join('\n'),
        'Gather them in one post: each question in a line, in your own words, answered in a line or two from your own work. Name no one who asked, and link none of the threads. End by asking readers which question you missed.',
      ].join('\n')
    case 'rework':
      return [
        `This post reworks one of your own posts on ${basis.post.placeName} that brought users:`,
        `<post>\n${basis.post.title}\n\n${basis.post.text}\n</post>`,
        `Keep its point and make it a post for ${brief.account.placeName}: this platform's shape, length and readers, in this post's intent. Write it anew rather than pasting it, and do not say it was posted elsewhere. Name ${brief.sponsorName} only as the sponsor instruction says.`,
      ].join('\n')
    case 'launch':
      return `This post announces what ${brief.sponsorName} just shipped: ${basis.what}. Show it plainly: what it does, who it is for, why it was built, and what you want to hear back. It is a launch, so it names ${brief.sponsorName}, as the sponsor instruction says.`
  }
}

/** A sponsored post names the sponsor in one sentence and carries its link as given, or leaves it to the submission (shared SPONSOR_LINKS). */
function postSponsorInstruction(brief: PostBrief): string {
  if (brief.sponsor === null) return `Leave ${brief.sponsorName} out of the post, and put no link to it.`
  const mention = `Mention ${brief.sponsorName} in one sentence, in your own words (${pitchWords(brief.sponsorPitch)}), and say "${brief.affiliationLine}" as written.`
  if (SPONSOR_LINKS[brief.account.platform].placement === 'submission')
    return `${mention} Your operator submits the post with the link ${brief.sponsor.link}; leave it out of the talking points.`
  return `${mention} Put this link in the post once, exactly as written: ${brief.sponsor.link}`
}
