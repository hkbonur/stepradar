import { describe, expect, it } from 'vitest'
import { countVoice, voiceEditProblems, voiceSampleSize, voiceStats, voiceStatsOf, VOICE_TRAITS_MAX } from './voice'

const short = (text: string) => ({ parts: [text], isReply: false })
const medium = (text: string) => ({ parts: [`${text} ${'and more words to fill the post. '.repeat(4)}`], isReply: false })
const thread = (text: string) => ({ parts: [text, 'Part two.'], isReply: false })
const reply = (text: string) => ({ parts: [text], isReply: true })

describe('voiceStats', () => {
  it('counts the length mix over originals only', () => {
    const stats = voiceStats([
      short('One.'),
      short('Two.'),
      medium('Three.'),
      thread('Four.'),
      // Replies are someone else's conversation: never counted, whatever they hold.
      reply('#hashtag 🚀'),
      reply('A reply.'),
    ])
    expect(stats.sampleSize).toBe(4)
    expect(stats.lengthMix).toEqual({ short: 0.5, medium: 0.25, long: 0.25 })
    expect(stats.emoji).toBe('never')
    expect(stats.hashtags).toBe('never')
  })

  it('calls a habit never under 5 percent, rare under 30, often from 30', () => {
    const plain = Array.from({ length: 20 }, (_, index) => short(`Post ${index}.`))
    const withEmoji = (count: number) => [...Array.from({ length: count }, () => short('Shipped 🚀')), ...plain.slice(count)]
    expect(voiceStats(withEmoji(0)).emoji).toBe('never')
    // 1 of 20 is 5 percent: rare.
    expect(voiceStats(withEmoji(1)).emoji).toBe('rare')
    // 5 of 20 is 25 percent: rare.
    expect(voiceStats(withEmoji(5)).emoji).toBe('rare')
    // 6 of 20 is 30 percent: often.
    expect(voiceStats(withEmoji(6)).emoji).toBe('often')
    // Under 5 percent: 1 of 21.
    expect(voiceStats([...plain, short('One ✅')]).emoji).toBe('never')
  })

  it('finds an emoji or a hashtag in any part of a thread, and needs a word after the #', () => {
    const stats = voiceStats([
      { parts: ['Plain start.', 'Then #n8n'], isReply: false },
      { parts: ['Plain.', 'Then ❤️'], isReply: false },
      short('Number # 1 is not a hashtag'),
    ])
    expect(stats.hashtags).toBe('often')
    expect(stats.emoji).toBe('often')
    expect(voiceStats([short('Number # 1 is not a hashtag'), short('Nor is a lone #')]).hashtags).toBe('never')
  })

  it('throws with no original to count', () => {
    expect(() => voiceStats([])).toThrow('at least one original')
    expect(() => voiceStats([reply('Only replies.')])).toThrow('at least one original')
  })
})

describe('countVoice', () => {
  it('counts originals only, and the counts of two batches add up to the counts of both', () => {
    const first = [short('One 🚀'), medium('Two #n8n'), reply('A reply 🚀 #n8n')]
    const second = [thread('Three.'), short('Four.')]
    expect(countVoice(first)).toEqual({ lengths: { short: 1, medium: 1, long: 0 }, withEmoji: 1, withHashtag: 1 })
    const both = countVoice([...first, ...second])
    expect(both).toEqual({ lengths: { short: 2, medium: 1, long: 1 }, withEmoji: 1, withHashtag: 1 })
    expect(voiceSampleSize(both)).toBe(4)
    // The stats of the counts are the stats of the posts, so a voice learned from kept counts matches one counted afresh.
    expect(voiceStatsOf(both)).toEqual(voiceStats([...first, ...second]))
  })
})

describe('voiceEditProblems', () => {
  const edit = { language: 'nb', summary: 'Dry, short, practical.', traits: ['Opens with the result', 'No exclamation marks'] }

  it('accepts a voice with a language tag, a summary and one to eight traits', () => {
    expect(voiceEditProblems(edit)).toEqual([])
    expect(voiceEditProblems({ ...edit, language: 'en-GB' })).toEqual([])
    expect(voiceEditProblems({ ...edit, traits: Array.from({ length: VOICE_TRAITS_MAX }, (_, index) => `Trait ${index}`) })).toEqual([])
  })

  it('names every problem in form order, each with the field it belongs to', () => {
    expect(voiceEditProblems({ language: ' ', summary: '', traits: [] })).toEqual([
      { field: 'language', message: 'The language is empty.' },
      { field: 'summary', message: 'The summary is empty.' },
      { field: 'traits', message: 'A voice has 1 to 8 traits.' },
    ])
    expect(voiceEditProblems({ ...edit, language: 'not a tag' })).toEqual([
      { field: 'language', message: '"not a tag" is not a language tag such as en, nb or tr.' },
    ])
    expect(voiceEditProblems({ ...edit, traits: ['Fine', '  '] })).toEqual([{ field: 'traits', message: 'Trait 2 is empty.' }])
    expect(voiceEditProblems({ ...edit, traits: Array.from({ length: VOICE_TRAITS_MAX + 1 }, () => 'Trait') })).toEqual([
      { field: 'traits', message: 'A voice has 1 to 8 traits.' },
    ])
  })
})
