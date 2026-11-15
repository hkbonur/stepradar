/**
 * How every post and reply is written so it reads like a person, not a
 * model. The rules are condensed from the humanizer skill (MIT, Siqi Chen),
 * which draws on Wikipedia's "Signs of AI writing"; the writer reads them
 * with every draft, and `writingTells` sends back a draft that still shows
 * one of the tells a careful writer almost never makes on purpose.
 */
export const WRITING_RULES: readonly string[] = [
  'Write like a person in the thread, not a model. Make the point in the first sentence.',
  'Never claim something happened to you, or a habit, setup, number, client or result of yours ("I got paged", "I always add", "in my setup"), unless your account bible or memory states it. Say what to do ("add a Code node"), not what you do.',
  'Keep most sentences under 25 words and vary their length. Split a sentence that chains three clauses or more, and put a list of more than two items in its own sentence.',
  'No "not X but Y", "not just X, Y" or "it\'s not X, it\'s Y": say what is true directly.',
  'No openers that announce the point ("Here\'s the thing", "Let\'s dive in", "Honestly?", "Real talk") and no closing line that repeats it.',
  'No lists of three unless there are three things. No sayings that sound deep ("at its core", "the real question is").',
  'No em or en dashes: use a comma, a colon, a period or parentheses.',
  'Plain verbs: is, has, uses. Avoid delve, tapestry, testament, pivotal, crucial, robust, seamless, leverage, showcase, underscore, meticulous, vibrant, landscape.',
  'No chatbot phrases: "Great question", "I hope this helps", "Happy to help", "Feel free to", no offer to say more.',
  'No bold, headings or bullet labels unless the platform and the thread use them.',
]

/** A tell, and the problem the writer is sent back with when a draft shows it. */
interface Tell {
  pattern: RegExp
  problem: (found: string) => string
}

/** Words models use far more than people, wherever they appear; a technical "robust" or "landscape" is common enough to be left to the rules. */
const STOCK_WORDS =
  /\b(delv(?:e|es|ed|ing)|tapestry|testament|pivotal|meticulous(?:ly)?|intricacies|vibrant|bolster(?:s|ed|ing)?|garner(?:s|ed|ing)?|seamless(?:ly)?)\b/i

const TELLS: readonly Tell[] = [
  { pattern: /[—–]| -- /, problem: () => 'Use no em or en dashes: a comma, a colon, a period or parentheses.' },
  {
    pattern: /\b(?:great question|i hope this helps|happy to help|feel free to)\b/i,
    problem: (found) => `Cut the chatbot phrase "${found}".`,
  },
  {
    pattern: /(?:^|[.!?\n]\s*)(?:here'?s the thing|let'?s dive in|let'?s break (?:this|it) down|without further ado|real talk|honestly\?)/i,
    problem: (found) => `Cut the opener "${found.replace(/^[.!?\s]+/, '')}" and make the point.`,
  },
  {
    pattern: /\bnot (?:just|only|merely) [^.?!\n]{1,80}?\bbut\b|\bit'?s not [^.?!\n]{1,60}?[,;] it'?s\b/i,
    problem: (found) => `Say what is true directly instead of "${found}".`,
  },
  { pattern: STOCK_WORDS, problem: (found) => `Use a plain word for "${found}".` },
]

/** Code is quoted as written: a flag's dashes are no tell. */
const CODE = /```[\s\S]*?```|`[^`\n]*`/g

/**
 * The tells a draft shows, each as the problem the writer fixes. The
 * `exempt` texts are the operator's own words written into the draft as
 * given (the affiliation line), so they are not read.
 */
export function writingTells(text: string, exempt: readonly string[]): string[] {
  const read = exempt
    .filter((words) => words.trim() !== '')
    .reduce((rest, words) => rest.split(words.trim()).join(' '), text.replace(CODE, ' '))
  return TELLS.flatMap((tell) => {
    const match = tell.pattern.exec(read)
    return match === null ? [] : [tell.problem(match[0].trim())]
  })
}
