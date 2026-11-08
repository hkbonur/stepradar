import { describe, expect, it } from 'vitest'
import { platformOfHeardAbout, platformOfReferrer, probableBasisText } from './probable'

/** The workspace's forums, by their hosts. */
const FORUM_HOSTS = ['community.n8n.io']

describe('probable conversions', () => {
  it('names the platform a first referring domain belongs to, subdomains too, and no other site', () => {
    expect(
      ['www.reddit.com', 'old.reddit.com', 'news.ycombinator.com', 't.co', 'www.linkedin.com', 'lnkd.in', 'community.n8n.io'].map(
        (domain) => platformOfReferrer(domain, FORUM_HOSTS)
      )
    ).toEqual(['reddit', 'reddit', 'hackernews', 'x', 'linkedin', 'linkedin', 'forum'])
    expect(
      ['$direct', 'www.google.com', 'notreddit.com', 'ycombinator.com', 'n8n.io'].map((domain) => platformOfReferrer(domain, FORUM_HOSTS))
    ).toEqual([null, null, null, null, null])
  })

  it('reads the one platform an answer names, and none from an answer that names another place or two', () => {
    expect(
      ['Reddit', 'a thread in r/n8n', 'Hacker News', 'saw it on HN', 'Twitter', 'X', 'LinkedIn post'].map(platformOfHeardAbout)
    ).toEqual(['reddit', 'reddit', 'hackernews', 'hackernews', 'x', 'x', 'linkedin'])
    expect(['a friend', 'Google', 'Reddit and Twitter', ''].map(platformOfHeardAbout)).toEqual([null, null, null, null])
  })

  it('reads a forum only as written, since a form is one letter off it', () => {
    expect(['a forum', 'the n8n forums', 'a form on your site'].map(platformOfHeardAbout)).toEqual(['forum', 'forum', null])
  })

  it("reads a platform's name misspelled by one letter, but never a short name or a word two letters off", () => {
    expect(['redit', 'Reddti', 'hacker newz', 'hackrnews', 'twiter', 'linkedn', 'Linkd in'].map(platformOfHeardAbout)).toEqual([
      'reddit',
      'reddit',
      'hackernews',
      'hackernews',
      'x',
      'linkedin',
      'linkedin',
    ])
    expect(['credit card ad', 'hackernoon', 'an edit', 'xs', 'hm', 'redt'].map(platformOfHeardAbout)).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
    ])
  })

  it('says what a probable conversion rests on', () => {
    expect(probableBasisText('reddit', 'heard_about_us')).toBe('said they heard of it on Reddit')
    expect(probableBasisText('x', 'referrer')).toBe('first came from t.co or x.com or twitter.com')
    expect(probableBasisText('forum', 'referrer')).toBe('first came from the site of one of your forums')
  })
})
