import { postedAnchor } from '@influstep/shared'
import { describe, expect, it } from 'vitest'
import type { Doc, Id } from '../_generated/dataModel'
import { commentPayloadOf } from './notifications'

const ACCOUNT = { _id: 'a1' as Id<'accounts'>, platform: 'reddit', handle: 'nora' } as Doc<'accounts'>

function comment(externalId: string, inReplyTo: string | undefined): Doc<'comments'> {
  return { externalId, inReplyTo, author: { handle: 'dana', name: 'Dana' }, text: 'Which queue?' } as Doc<'comments'>
}

describe('a comment notification', () => {
  it('opens the Posted page at the item a comment is under, and the replies page for a mention', () => {
    expect(commentPayloadOf(ACCOUNT, [comment('t1_c', 't3_post')]).url).toBe(`/accounts/a1/posted#${postedAnchor('t3_post')}`)
    expect(commentPayloadOf(ACCOUNT, [comment('t1_m', undefined)]).url).toBe('/accounts/a1/replies')
    expect(commentPayloadOf(ACCOUNT, [comment('t1_c', 't3_post'), comment('t1_d', 't3_other')]).url).toBe('/accounts/a1/posted')
    expect(commentPayloadOf(ACCOUNT, [comment('t1_m', undefined), comment('t1_n', undefined)]).url).toBe('/accounts/a1/replies')
  })
})
