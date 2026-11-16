import { describe, expect, it } from 'vitest'
import { writingTells } from './writing'

describe('writing tells', () => {
  it('finds none in plain writing, code or the affiliation line', () => {
    const affiliation = "Heads up: I'm building Formstep — weigh it accordingly."
    const text = `Insert the message ID into a column with a unique constraint first. Run \`n8n start --tunnel\` to test it. ${affiliation}`
    expect(writingTells(text, [affiliation])).toEqual([])
  })

  it('names each tell once, with what to do instead', () => {
    const text = [
      "Here's the thing: retries — the silent kind — are not just annoying, but costly.",
      'Great question! We delve into the tapestry of webhooks.',
    ].join(' ')
    expect(writingTells(text, [])).toEqual([
      'Use no em or en dashes: a comma, a colon, a period or parentheses.',
      'Cut the chatbot phrase "Great question".',
      `Cut the opener "Here's the thing" and make the point.`,
      'Say what is true directly instead of "not just annoying, but".',
      'Use a plain word for "delve".',
    ])
  })

  it('sends back a post that announces itself, and a wall of text', () => {
    const sentence = 'Use ?? instead of || so a budget of 0 stays 0 in the expression. '
    expect(writingTells(`This post gives two checks. ${sentence.repeat(10)}`, [])).toEqual([
      'Cut the opener "This post gives" and make the point.',
      'Break the text into paragraphs of two to four sentences, with a blank line between them.',
    ])
    expect(writingTells(`${sentence.repeat(4)}\n\n${sentence.repeat(4)}`, [])).toEqual([])
  })

  it("reads an it's-not contrast and a staged opener after a sentence", () => {
    expect(writingTells("The fix is small. Honestly? It's not the node, it's the trigger.", [])).toEqual([
      'Cut the opener "Honestly?" and make the point.',
      `Say what is true directly instead of "It's not the node, it's".`,
    ])
  })
})
