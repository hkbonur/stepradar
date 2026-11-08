import { describe, expect, it } from 'vitest'
import { EXPERIMENT_CATALOG } from './experiments'
import { effectiveVariant, type StrategyDefault } from './strategy'

const question = EXPERIMENT_CATALOG.reply_style[1]
const peers = EXPERIMENT_CATALOG.reply_target[1]

const defaults: StrategyDefault[] = [
  { kind: 'reply_style', key: question.key, label: question.label, description: question.description, experimentId: 'e1', since: 1 },
]

describe('effectiveVariant', () => {
  it('is the catalog control without a variant or a default', () => {
    expect(effectiveVariant('reply_style', {}, undefined)).toEqual({
      kind: 'reply_style',
      key: 'tip',
      label: 'Tip',
      description: EXPERIMENT_CATALOG.reply_style[0].description,
      isControl: true,
    })
    expect(effectiveVariant('reply_target', {}, [])).toMatchObject({ key: 'reach', isControl: true })
  })

  it('is the account’s default when the reply’s experiment varies another dimension', () => {
    const reply = { variant: { kind: 'reply_target' as const, ...peers } }
    expect(effectiveVariant('reply_style', reply, defaults)).toMatchObject({ key: 'question', isControl: false })
  })

  it('is the reply’s own variant on the dimension its experiment varies, even over a default', () => {
    const tip = EXPERIMENT_CATALOG.reply_style[0]
    expect(effectiveVariant('reply_style', { variant: { kind: 'reply_style', ...tip } }, defaults)).toMatchObject({
      key: 'tip',
      isControl: true,
    })
  })
})
