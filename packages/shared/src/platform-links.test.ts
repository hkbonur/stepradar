import { describe, expect, it } from 'vitest'
import type { Forum } from './forums'
import { parsePostedLink, parseThreadLink, profileEditLink } from './platform-links'

const N8N: Forum = { origin: 'https://community.n8n.io', name: 'n8n Community', software: 'discourse' }
const ZAPIER: Forum = { origin: 'https://community.zapier.com', name: 'Zapier Community', software: 'other' }

describe('parseThreadLink', () => {
  it("reads the id a reply answers from each platform's link, and who or where it names", () => {
    expect(parseThreadLink({ platform: 'x' }, 'https://x.com/dana_automates/status/1840 ')).toEqual({
      kind: 'link',
      url: 'https://x.com/dana_automates/status/1840',
      externalId: '1840',
      author: 'dana_automates',
      community: null,
    })
    expect(
      parseThreadLink({ platform: 'linkedin' }, 'https://www.linkedin.com/posts/dana-ruiz_retries-activity-7123456789-abcd')
    ).toMatchObject({
      externalId: 'urn:li:activity:7123456789',
      author: 'dana-ruiz',
    })
    expect(parseThreadLink({ platform: 'linkedin' }, 'https://www.linkedin.com/feed/update/urn:li:activity:7123456789/')).toMatchObject({
      externalId: 'urn:li:activity:7123456789',
    })
    expect(parseThreadLink({ platform: 'reddit' }, 'https://www.reddit.com/r/n8n/comments/abc123/webhook_retries/')).toMatchObject({
      externalId: 't3_abc123',
      community: 'n8n',
    })
    // A link to a comment answers the comment, not the post above it.
    expect(
      parseThreadLink({ platform: 'reddit' }, 'https://www.reddit.com/r/n8n/comments/abc123/webhook_retries/def456/?context=3')
    ).toMatchObject({
      externalId: 't1_def456',
      community: 'n8n',
    })
    expect(parseThreadLink({ platform: 'reddit' }, 'https://www.reddit.com/r/n8n/comments/abc123/comment/def456/')).toMatchObject({
      externalId: 't1_def456',
    })
    expect(parseThreadLink({ platform: 'hackernews' }, 'https://news.ycombinator.com/item?id=41')).toMatchObject({
      externalId: '41',
      community: 'Hacker News',
    })
  })

  it("reads a Discourse topic or a post in it on the account's forum, the topic's first post as the topic, and any page of other software", () => {
    const forum = { platform: 'forum', forum: N8N } as const
    expect(parseThreadLink(forum, 'https://community.n8n.io/t/webhook-retries/296315')).toMatchObject({ externalId: '296315' })
    expect(parseThreadLink(forum, 'https://community.n8n.io/t/webhook-retries/296315/1')).toMatchObject({ externalId: '296315' })
    expect(parseThreadLink(forum, 'https://community.n8n.io/t/webhook-retries/296315/4?u=ada')).toMatchObject({ externalId: '296315/4' })
    expect(parseThreadLink(forum, 'https://community.n8n.io/t/296315')).toMatchObject({ externalId: '296315' })
    expect(parseThreadLink(forum, 'https://community.n8n.io/t/296315/4')).toMatchObject({ externalId: '296315/4' })
    expect(parseThreadLink({ platform: 'forum', forum: ZAPIER }, 'https://community.zapier.com/how-do-i-3/form-retries-41/')).toMatchObject(
      {
        externalId: '/how-do-i-3/form-retries-41',
      }
    )
    for (const other of ['https://forum.example.com/t/webhook-retries/296315', 'https://community.n8n.io/latest', 'community.n8n.io/t/a/1'])
      expect(parseThreadLink(forum, other)).toEqual({ kind: 'invalid', problem: 'That is no link to a thread on n8n Community.' })
  })

  it("refuses a link that names no thread on the account's platform", () => {
    expect(parseThreadLink({ platform: 'linkedin' }, 'https://x.com/dana/status/1840')).toEqual({
      kind: 'invalid',
      problem: 'That is no link to a thread on LinkedIn.',
    })
  })
})

describe('parsePostedLink', () => {
  it("reads the id of the operator's own post or reply on each platform, a Reddit comment by its fullname", () => {
    expect(parsePostedLink({ platform: 'x' }, 'https://x.com/ada/status/42')).toEqual({
      kind: 'link',
      url: 'https://x.com/ada/status/42',
      externalId: '42',
    })
    expect(parsePostedLink({ platform: 'reddit' }, 'https://www.reddit.com/r/n8n/comments/abc123/webhook_retries/def456/')).toMatchObject({
      externalId: 't1_def456',
    })
    expect(parsePostedLink({ platform: 'reddit' }, 'https://www.reddit.com/r/n8n/comments/abc123/webhook_retries/')).toMatchObject({
      externalId: 't3_abc123',
    })
    expect(parsePostedLink({ platform: 'hackernews' }, 'https://news.ycombinator.com/item?id=41')).toMatchObject({ externalId: '41' })
    expect(parsePostedLink({ platform: 'x' }, ' https://twitter.com/ada/status/42?s=20 ')).toMatchObject({ externalId: '42' })
    expect(parsePostedLink({ platform: 'x' }, 'https://www.x.com/ada/status/42/')).toMatchObject({ externalId: '42' })
    expect(parsePostedLink({ platform: 'x' }, '  ')).toEqual({ kind: 'none' })
    for (const other of [
      'https://x.com/ada_automates',
      'https://example.com/ada/status/42',
      'x.com/ada/status/42',
      'https://x.com/ada/status/42abc',
    ])
      expect(parsePostedLink({ platform: 'x' }, other).kind).toBe('invalid')
    expect(parsePostedLink({ platform: 'hackernews' }, 'https://x.com/ada/status/42')).toEqual({
      kind: 'invalid',
      problem: 'That is no link to your post or reply on Hacker News.',
    })
  })
})

describe('profileEditLink', () => {
  it("opens where the operator edits the account's profile, and knows none on a forum Influstep cannot read", () => {
    expect(profileEditLink({ platform: 'x' }, 'ada')).toBe('https://x.com/settings/profile')
    expect(profileEditLink({ platform: 'hackernews' }, 'ada')).toBe('https://news.ycombinator.com/user?id=ada')
    expect(profileEditLink({ platform: 'forum', forum: N8N }, 'Ada Lovelace')).toBe(
      'https://community.n8n.io/u/Ada%20Lovelace/preferences/profile'
    )
    expect(profileEditLink({ platform: 'forum', forum: ZAPIER }, 'ada')).toBeNull()
  })
})
