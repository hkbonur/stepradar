import { describe, expect, it } from 'vitest'
import { discourseItemId, discourseItemOf, forumAddress, forumHost, sameThread } from './forums'

describe('forumAddress', () => {
  it("keeps a forum's https origin from any of its addresses", () => {
    for (const typed of ['community.n8n.io', ' https://community.n8n.io/ ', 'https://community.n8n.io/t/webhook-retries/296315?u=ada'])
      expect(forumAddress(typed)).toEqual({ kind: 'origin', origin: 'https://community.n8n.io' })
    expect(forumHost({ origin: 'https://community.n8n.io' })).toBe('community.n8n.io')
  })

  it('refuses an address that is not read over https by its name', () => {
    expect(forumAddress('http://community.n8n.io')).toEqual({ kind: 'invalid', problem: 'Influstep reads a forum over https only.' })
    for (const typed of [
      '',
      'localhost',
      'https://127.0.0.1',
      'https://community.n8n.io:8443',
      'https://ada:secret@community.n8n.io',
      'n8n',
    ])
      expect(forumAddress(typed).kind).toBe('invalid')
  })
})

describe('discourseItemId', () => {
  it("names a topic by its id, its first post being the topic, and a reply by the topic and the reply's number", () => {
    expect(discourseItemId(296315, 1)).toBe('296315')
    expect(discourseItemId(296315, 4)).toBe('296315/4')
    expect(discourseItemOf('296315')).toEqual({ topicId: 296315, postNumber: 1 })
    expect(discourseItemOf('296315/4')).toEqual({ topicId: 296315, postNumber: 4 })
    expect(discourseItemOf('/how-do-i-3/form-retries-41')).toBeNull()
  })
})

describe('sameThread', () => {
  it('reads a forum topic as one thread, and any other item as itself', () => {
    expect(sameThread('forum', '41/7', '41')).toBe(true)
    expect(sameThread('forum', '41/7', '41/3')).toBe(true)
    expect(sameThread('forum', '41/7', '42')).toBe(false)
    expect(sameThread('forum', '/how-do-i-3/a', '/how-do-i-3/b')).toBe(false)
    expect(sameThread('reddit', 't1_a', 't3_b')).toBe(false)
    expect(sameThread('reddit', 't3_b', 't3_b')).toBe(true)
  })
})
