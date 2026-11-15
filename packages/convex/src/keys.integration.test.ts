import { describe, expect, it } from 'vitest'
import { api, internal } from './_generated/api'
import { setup } from '../test/setup'

describe('provider keys', () => {
  it('stores a key write-only: the Providers page sees its last characters, never the key, and a reset keeps it', async () => {
    const t = setup()
    await t.mutation(api.private.keys.set, { name: 'ANTHROPIC_API_KEY', value: '  sk-ant-first-1234 ' })
    await t.mutation(api.private.keys.set, { name: 'ANTHROPIC_API_KEY', value: 'sk-ant-second-9f2a' })
    const status = await t.query(api.private.providers.status, {})
    expect(status.providerKeys.find((key) => key.name === 'ANTHROPIC_API_KEY')).toMatchObject({ set: true, ending: '9f2a' })
    expect(status.providerKeys.find((key) => key.name === 'REDDIT_CLIENT_ID')).toEqual({ name: 'REDDIT_CLIENT_ID', set: false })
    expect(status.keys).toMatchObject({ ANTHROPIC_API_KEY: true, REDDIT_CLIENT_ID: false })
    expect(JSON.stringify(status)).not.toContain('sk-ant-second')
    // Replacing keeps one row, trimmed; the agents read it whole.
    expect(await t.query(internal.internal.keys.stored, {})).toEqual({ ANTHROPIC_API_KEY: 'sk-ant-second-9f2a' })

    await t.mutation(internal.internal.seed.reset, {})
    expect(await t.query(internal.internal.keys.stored, {})).toEqual({ ANTHROPIC_API_KEY: 'sk-ant-second-9f2a' })

    await t.mutation(api.private.keys.remove, { name: 'ANTHROPIC_API_KEY' })
    expect(await t.query(internal.internal.keys.stored, {})).toEqual({})
  })

  it('refuses a blank key, naming it', async () => {
    const t = setup()
    await expect(t.mutation(api.private.keys.set, { name: 'REDDIT_CLIENT_SECRET', value: '  ' })).rejects.toThrow(
      'Paste the Reddit app secret.'
    )
  })
})
