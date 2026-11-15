import { describe, expect, it, vi } from 'vitest'
import { draftChecked } from './drafting'

const check = {
  problemsOf: (draft: string) => (draft.length > 20 ? ['Too long.'] : []),
  tellsOf: (draft: string) => (draft.includes('—') ? ['No dashes.'] : []),
}

describe("the writers' retry", () => {
  it('sends a draft with a tell back once, naming it, and keeps the second draft whatever its wording', async () => {
    const write = vi.fn(async (brief: { problems: string[] }) => (brief.problems.length === 0 ? 'Short — dashed' : 'Still — dashed'))
    expect(await draftChecked(write, { problems: [] }, check)).toEqual({ draft: 'Still — dashed', problems: [] })
    expect(write.mock.calls.map(([brief]) => brief.problems)).toEqual([[], ['No dashes.']])
  })

  it("returns the second draft's broken rules for the caller to act on", async () => {
    const write = vi.fn(async (_brief: { problems: string[] }) => 'A draft far too long — and dashed')
    expect(await draftChecked(write, { problems: [] }, check)).toEqual({
      draft: 'A draft far too long — and dashed',
      problems: ['Too long.'],
    })
    expect(write.mock.calls.map(([brief]) => brief.problems)).toEqual([[], ['Too long.', 'No dashes.']])
  })
})
