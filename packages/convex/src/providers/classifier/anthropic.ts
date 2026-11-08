import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { HEARD_INTENTS, SELF_PROMOTION, communityLabel, type HeardFit } from '@influstep/shared'
import { z } from 'zod'
import { anthropicClient } from '../llm/anthropic'
import type { ClassifierProvider, ClassifyBrief } from './types'

/** The fastest, cheapest model: the classifier reads every post the listener hears. */
const MODEL = 'claude-haiku-5-5'

/** How many posts one request reads. */
const BATCH = 10

// Structured outputs drop numeric bounds from the schema they send, so the 0 to 1 range is said in the prompt and checked after parsing.
const fitsSchema = z.object({
  posts: z.array(
    z.object({
      id: z.string(),
      relevant: z.boolean(),
      intent: z.enum(HEARD_INTENTS),
      replyWorthy: z.boolean(),
      score: z.number(),
      confidence: z.number(),
      reason: z.string(),
    })
  ),
})

function system(brief: ClassifyBrief): string {
  return [
    `You sort posts on ${brief.placeName} that one account might answer. Its operator answers by hand, as themselves; you only sort.`,
    `The account's niche: ${brief.niche}.${brief.audience ? ` It talks to ${brief.audience}.` : ''}`,
    `Its pillars: ${brief.pillars.join('; ')}.`,
    `It is built by the people behind ${brief.sponsorName}: ${brief.sponsorPitch}`,
    'For each post return, under its id:',
    "- relevant: whether it is about the niche, a pillar or the sponsor's problem at all.",
    `- intent: what its author wants, one of ${HEARD_INTENTS.join(', ')}.`,
    '- replyWorthy: whether an answer from this account would add something, not only agree or advertise.',
    '- score: from 0 to 1, how good a fit it is for this account to answer.',
    '- confidence: from 0 to 1, how sure you are of the above.',
    '- reason: a few words on why.',
  ].join('\n')
}

async function classifyBatch(brief: ClassifyBrief, posts: ClassifyBrief['posts']): Promise<HeardFit[]> {
  const response = await anthropicClient().messages.parse({
    model: MODEL,
    max_tokens: 4000,
    output_config: { effort: 'low', format: zodOutputFormat(fitsSchema) },
    system: [{ type: 'text', text: system(brief), cache_control: { type: 'ephemeral' } }],
    messages: [
      {
        role: 'user',
        content: posts.map((post, index) => `<post id="${index}" origin="${post.origin}">\n${post.text}\n</post>`).join('\n\n'),
      },
    ],
  })
  if (response.stop_reason === 'refusal') throw new Error('The classifier declined these posts')
  if (!response.parsed_output) throw new Error('The classifier returned no parseable answer')
  const byId = new Map(response.parsed_output.posts.map((fit) => [fit.id, fit]))
  return posts.map((_, index) => {
    const fit = byId.get(String(index))
    if (!fit) throw new Error(`The classifier left out post ${index}`)
    if (!inUnit(fit.score) || !inUnit(fit.confidence)) throw new Error(`The classifier scored post ${index} outside 0 to 1`)
    const { id: _id, ...read } = fit
    return read
  })
}

function inUnit(value: number): boolean {
  return value >= 0 && value <= 1
}

const rulesReadSchema = z.object({ selfPromotion: z.enum(SELF_PROMOTION), reason: z.string() })

export const anthropicClassifier: ClassifierProvider = {
  name: 'anthropic',
  async communityRules(args) {
    const response = await anthropicClient().messages.parse({
      model: MODEL,
      max_tokens: 1000,
      output_config: { effort: 'low', format: zodOutputFormat(rulesReadSchema) },
      messages: [
        {
          role: 'user',
          content: [
            `These are the rules of ${communityLabel(args.platform, args.community)} on ${args.placeName}.`,
            `<rules>\n${args.rules}\n</rules>`,
            'May someone who builds a product name it in a helpful answer there, saying they build it? selfPromotion is allowed when the rules permit it, forbidden when they forbid self-promotion or advertising, unknown when they say nothing about it. The reason is a few words.',
          ].join('\n\n'),
        },
      ],
    })
    if (response.stop_reason === 'refusal') throw new Error('The classifier declined these rules')
    if (!response.parsed_output) throw new Error('The classifier returned no parseable read of the rules')
    return response.parsed_output
  },
  async classify(brief) {
    const fits: HeardFit[] = []
    for (let start = 0; start < brief.posts.length; start += BATCH) {
      fits.push(...(await classifyBatch(brief, brief.posts.slice(start, start + BATCH))))
    }
    return fits
  },
}
