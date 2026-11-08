import { describe, expect, it } from 'vitest'
import { parsePastedPosts, parseXArchive } from './history'

/** A tweets.js the way X's "Download your data" writes it, cut down to the fields the import reads. */
const ARCHIVE = `window.YTD.tweets.part0 = [
  {
    "tweet" : {
      "id_str" : "1002",
      "full_text" : "3/ Then the error workflow pings you -&gt; fix it once.",
      "created_at" : "Mon Oct 05 09:02:00 +0000 2026",
      "favorite_count" : "1",
      "retweet_count" : "0",
      "in_reply_to_status_id_str" : "1001",
      "lang" : "en"
    }
  },
  {
    "tweet" : {
      "id_str" : "1000",
      "full_text" : "1/ How I stop n8n &amp; Make from failing quietly:",
      "created_at" : "Mon Oct 05 09:00:00 +0000 2026",
      "favorite_count" : "40",
      "retweet_count" : "5",
      "lang" : "en"
    }
  },
  {
    "tweet" : {
      "id_str" : "1001",
      "full_text" : "2/ Every workflow gets an error workflow &lt;3",
      "created_at" : "Mon Oct 05 09:01:00 +0000 2026",
      "favorite_count" : "2",
      "retweet_count" : "1",
      "in_reply_to_status_id_str" : "1000",
      "lang" : "en"
    }
  },
  {
    "tweet" : {
      "id_str" : "2000",
      "full_text" : "RT @someone: their post, not ours",
      "created_at" : "Tue Oct 06 10:00:00 +0000 2026",
      "favorite_count" : "0",
      "retweet_count" : "12",
      "lang" : "en"
    }
  },
  {
    "tweet" : {
      "id_str" : "3000",
      "full_text" : "@someone 👍",
      "created_at" : "Tue Oct 06 12:00:00 +0000 2026",
      "favorite_count" : "3",
      "retweet_count" : "0",
      "in_reply_to_status_id_str" : "999",
      "lang" : "und"
    }
  },
  {
    "id_str" : "4000",
    "full_text" : "A plain export item, no wrapper and no language.",
    "created_at" : "Wed Oct 07 08:30:00 +0000 2026",
    "favorite_count" : 7,
    "retweet_count" : 2,
    "reply_count" : 4
  }
]`

describe('parseXArchive', () => {
  const posts = parseXArchive(ARCHIVE)

  it('keeps the account’s own posts, newest first, and leaves retweets out', () => {
    expect(posts.map((post) => post.externalId)).toEqual(['4000', '3000', '1000'])
  })

  it('folds a three-deep self-thread into its root, in the order it was posted, with the root’s counts', () => {
    expect(posts.find((post) => post.externalId === '1000')).toEqual({
      externalId: '1000',
      parts: [
        '1/ How I stop n8n & Make from failing quietly:',
        '2/ Every workflow gets an error workflow <3',
        '3/ Then the error workflow pings you -> fix it once.',
      ],
      postedAt: Date.UTC(2026, 9, 5, 9, 0, 0),
      likes: 40,
      reposts: 5,
      replies: 0,
      parentId: null,
      url: null,
      community: null,
      lang: 'en',
    })
  })

  it('marks a reply to a post outside the file as a reply and reads und as no language', () => {
    expect(posts.find((post) => post.externalId === '3000')).toMatchObject({
      parts: ['@someone 👍'],
      parentId: expect.any(String),
      lang: null,
    })
  })

  it('reads a bare item with number counts and a reply count', () => {
    expect(posts.find((post) => post.externalId === '4000')).toMatchObject({
      likes: 7,
      reposts: 2,
      replies: 4,
      parentId: null,
      lang: null,
      postedAt: Date.UTC(2026, 9, 7, 8, 30, 0),
    })
  })

  it('reads a plain JSON array and an archive with a closing semicolon', () => {
    const plain = ARCHIVE.slice(ARCHIVE.indexOf('['))
    expect(parseXArchive(plain)).toEqual(posts)
    expect(parseXArchive(`${ARCHIVE};\n`)).toEqual(posts)
  })

  it('decodes &amp;lt; once, to the literal text', () => {
    const [post] = parseXArchive(JSON.stringify([item('1', 'Type &amp;lt;br&amp;gt; for a line break')]))
    expect(post?.parts).toEqual(['Type &lt;br&gt; for a line break'])
  })

  it('throws on a date it cannot read instead of skipping the post', () => {
    expect(() => parseXArchive(JSON.stringify([item('1', 'Fine'), item('5', 'Broken', 'yesterday')]))).toThrow(
      'Post 5 has a date X archives do not use: yesterday'
    )
  })

  it('throws when nothing in the file is a post', () => {
    for (const text of ['hello', '[]', '{"tweet": {}}', 'window.YTD.tweets.part0 = [ not json', '[{"foo": 1}]']) {
      expect(() => parseXArchive(text)).toThrow('This is not an X archive tweets.js file.')
    }
  })

  it('names an item it cannot read among posts it can', () => {
    expect(() => parseXArchive(JSON.stringify([item('1', 'Fine'), { foo: 1 }]))).toThrow('Item 2 of the file is not an X post')
  })

  it('returns nothing for an archive of retweets only', () => {
    expect(parseXArchive(JSON.stringify([item('1', 'RT @a: theirs')]))).toEqual([])
  })
})

describe('parsePastedPosts', () => {
  const NOW = Date.UTC(2026, 9, 13, 12, 0, 0)

  it('splits on a line of three dashes, trims, and drops empty posts', () => {
    const posts = parsePastedPosts('  First post.\n---\n\nSecond post,\non two lines.\n  ---  \n\n---\nThird post.\r\n---\r\n', NOW)
    expect(posts.map((post) => post.parts)).toEqual([['First post.'], ['Second post,\non two lines.'], ['Third post.']])
  })

  it('keeps dashes inside a line as text', () => {
    expect(parsePastedPosts('Before --- after\n----\nstill one', NOW).map((post) => post.parts)).toEqual([
      ['Before --- after\n----\nstill one'],
    ])
  })

  it('dates the first post newest, one minute apart, with no counts and no language', () => {
    const posts = parsePastedPosts('One\n---\nTwo', NOW)
    expect(posts.map((post) => post.postedAt)).toEqual([NOW, NOW - 60_000])
    expect(posts[0]).toMatchObject({ likes: 0, reposts: 0, replies: 0, parentId: null, lang: null })
  })

  it('ids each post by a stable hash of its text', () => {
    const [first, second] = parsePastedPosts('One\n---\nTwo', NOW)
    expect(first?.externalId).toMatch(/^paste-[0-9a-f]{8}$/)
    expect(first?.externalId).not.toBe(second?.externalId)
    expect(parsePastedPosts('Two\n---\nOne', NOW + 1).map((post) => post.externalId)).toEqual([second?.externalId, first?.externalId])
  })

  it('returns nothing for an empty paste', () => {
    expect(parsePastedPosts('  \n---\n ', NOW)).toEqual([])
  })
})

function item(id: string, text: string, createdAt = 'Mon Oct 05 09:00:00 +0000 2026') {
  return {
    tweet: {
      id_str: id,
      full_text: text,
      created_at: createdAt,
      favorite_count: '0',
      retweet_count: '0',
    },
  }
}
