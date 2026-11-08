import { describe, expect, it } from 'vitest'
import { api } from './_generated/api'
import { insertAccount } from '../test/fixtures'
import { setup } from '../test/setup'

/** The memory page's calls (docs/plan.md, slice 10): add a rule or a fact, list the entries, forget one. */
describe('the memory page', () => {
  it('adds a rule, refuses the same words again and an empty one, and forgets it into Earlier', async () => {
    const t = setup()
    const account = await t.run((ctx) => insertAccount(ctx))

    const memoryId = await t.mutation(api.private.memory.add, { accountId: account._id, kind: 'rule', text: 'never say "guys"' })
    await expect(t.mutation(api.private.memory.add, { accountId: account._id, kind: 'fact', text: 'Never say "guys".' })).rejects.toThrow(
      `${account.name} already remembers that: "Never say "guys""`
    )
    await expect(t.mutation(api.private.memory.add, { accountId: account._id, kind: 'fact', text: ' ' })).rejects.toThrow(
      'Say what to remember.'
    )
    await t.mutation(api.private.memory.retire, { memoryId })

    const view = await t.query(api.private.memory.list, { accountId: account._id })
    expect(view?.entries.map((entry) => [entry.kind, entry.text, entry.actor, entry.status])).toEqual([
      ['rule', 'Never say "guys"', 'operator', 'retired'],
    ])
  })
})
