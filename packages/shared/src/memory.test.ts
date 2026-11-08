import { describe, expect, it } from 'vitest'
import { MEMORY_TEXT_MAX, isRetirable, memorySentence, memoryTextProblem, sameMemoryText, workspaceGoal } from './memory'

describe('memoryTextProblem', () => {
  it('refuses an empty entry and one over the limit, and takes anything else', () => {
    expect(memoryTextProblem('  ')).toBe('Say what to remember.')
    expect(memoryTextProblem('x'.repeat(MEMORY_TEXT_MAX + 1))).toBe(
      `Keep it to ${MEMORY_TEXT_MAX} characters; this is ${MEMORY_TEXT_MAX + 1}.`
    )
    expect(memoryTextProblem('Viewers hate the word "guys".')).toBeNull()
  })
})

describe('memorySentence', () => {
  it('opens with a capital and ends with an end mark, keeping a closing quote', () => {
    expect(memorySentence("  viewers hate the word 'guys'")).toBe("Viewers hate the word 'guys'")
    expect(memorySentence('always show the URL bar')).toBe('Always show the URL bar.')
    expect(memorySentence('Is n8n free?')).toBe('Is n8n free?')
  })
})

describe('sameMemoryText', () => {
  it('ignores case, spacing and the closing period', () => {
    expect(sameMemoryText('Always show the URL bar.', 'always  show the url bar')).toBe(true)
    expect(sameMemoryText('Always show the URL bar.', 'Never show the URL bar.')).toBe(false)
  })
})

describe('isRetirable', () => {
  it('lets the operator retire facts, rules and problems, never what the analyst or the researcher keeps', () => {
    expect(isRetirable('fact')).toBe(true)
    expect(isRetirable('rule')).toBe(true)
    expect(isRetirable('problem')).toBe(true)
    expect(isRetirable('learning')).toBe(false)
    expect(isRetirable('brief')).toBe(false)
    expect(isRetirable('goal_note')).toBe(false)
  })
})

describe('workspaceGoal', () => {
  it('is paying customers of the sponsor', () => {
    expect(workspaceGoal('Formstep')).toBe('Paying Formstep customers')
  })
})
