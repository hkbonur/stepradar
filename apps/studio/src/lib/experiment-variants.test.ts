import { EXPERIMENT_CATALOG, type StrategyDefault } from '@influstep/shared'
import { describe, expect, it } from 'vitest'
import { knownVariants, parseVariants, variantsText } from './experiment-variants'

describe('knownVariants', () => {
  it('fills in the catalog, control first, when the account has no default', () => {
    expect(knownVariants('reply_style', undefined).map((variant) => variant.key)).toEqual(
      EXPERIMENT_CATALOG.reply_style.map((variant) => variant.key)
    )
  })
  it('puts the default in force first, as the control, and lists it once', () => {
    const question = EXPERIMENT_CATALOG.reply_style.find((variant) => variant.key === 'question')
    if (question === undefined) throw new Error('the catalog has no question back')
    const defaults: StrategyDefault[] = [
      { kind: 'reply_style', key: question.key, label: question.label, description: question.description, since: 0 },
    ]
    expect(knownVariants('reply_style', defaults).map((variant) => variant.key)).toEqual(['question', 'tip', 'story'])
  })
})

describe('parseVariants', () => {
  it('reads the filled-in text back as the same variants, the first the control', () => {
    const known = knownVariants('reply_target', undefined)
    const parsed = parseVariants(variantsText(known), known)
    expect(parsed.map((variant) => variant.key)).toEqual(['reach', 'standout'])
    expect(parsed.map((variant) => variant.isControl)).toEqual([true, false])
  })
  it('keeps a known key when the label differs only in case and the description was edited', () => {
    const known = knownVariants('reply_style', undefined)
    const tip = known[0]
    if (tip === undefined) throw new Error('the reply style catalog is empty')
    const [parsed] = parseVariants(`${tip.label.toUpperCase()}: one tip, no link`, known)
    expect(parsed).toEqual({ key: tip.key, label: tip.label.toUpperCase(), description: 'one tip, no link', isControl: true })
  })
  it('keys a new label by its words and skips blank lines', () => {
    const parsed = parseVariants('\n  Cold open: start mid-thought \n\nNo colon here', [])
    expect(parsed).toEqual([
      { key: 'cold-open', label: 'Cold open', description: 'start mid-thought', isControl: true },
      { key: 'no-colon-here', label: 'No colon here', description: '', isControl: false },
    ])
  })
  it('splits on the first colon only, so a description may hold one', () => {
    const [parsed] = parseVariants('Number: open with a count: "3 things"', [])
    expect(parsed?.description).toBe('open with a count: "3 things"')
  })
})
