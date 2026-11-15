import { describe, expect, it } from 'vitest'
import { keyEnding, providerKeyProblem } from './provider-keys'

describe('providerKeyProblem', () => {
  it('takes a whole key, trimmed, and names the key it refuses', () => {
    expect(providerKeyProblem('ANTHROPIC_API_KEY', '  sk-ant-api03-abcdef  ')).toBeNull()
    expect(providerKeyProblem('ANTHROPIC_API_KEY', ' ')).toBe('Paste the Anthropic API key.')
    expect(providerKeyProblem('REDDIT_CLIENT_ID', 'abc123')).toBe('That is too short to be the Reddit app ID: paste the whole key.')
  })

  it('shows only the last four characters', () => {
    expect(keyEnding('sk-ant-api03-abcdef9f2a')).toBe('9f2a')
  })
})
