import { describe, expect, it } from 'vitest'
import type { Doc, Id } from '../_generated/dataModel'
import type { ItemCounts, Platform } from '@stepradar/shared'
import { buildFunnel, buildReachLine, buildTrend, rankGroups, sumFunnels, type PostOutcome } from './report'

const X = (impressions: number, replies: number): ItemCounts => ({
  platform: 'x',
  impressions,
  likes: 0,
  replies,
  reposts: 0,
  profileVisits: 0,
  follows: 0,
})

/** The analyst's last read of an item. */
const read = (counts: ItemCounts, mock = false) => ({ numbers: { counts, readAt: 0, mock } })

describe('buildFunnel', () => {
  it('sums the reach and the comments of the items read, and leaves out what a platform does not count', () => {
    const funnel = buildFunnel({
      items: [
        read({ platform: 'hackernews', score: 40, replies: 12 }),
        // A comment on Hacker News shows no score.
        read({ platform: 'hackernews', score: null, replies: 3 }),
        // Not read yet.
        {},
      ],
      clicks: 3,
    })
    expect(funnel).toMatchObject({ items: 3, counted: 2, reach: 40, reached: 1, replies: 15, clicks: 3, mock: false })
  })

  it('says nothing read rather than zero, and counts no comments where the platform shows none', () => {
    const none = buildFunnel({ items: [{}], clicks: 0 })
    expect(none).toMatchObject({ items: 1, counted: 0, reach: null, reached: 0, replies: null })
    // A Reddit comment shows its points but no comments under it.
    const comment = buildFunnel({
      items: [read({ platform: 'reddit', score: 5, replies: null })],
      clicks: 0,
    })
    expect(comment).toMatchObject({ reach: 5, replies: null })
  })
})

describe('sumFunnels', () => {
  it('adds the accounts up, but not their reach, which each platform counts its own way', () => {
    const ada = buildFunnel({ items: [read(X(1_000, 4))], clicks: 5 })
    // A Reddit post links to the sponsor directly, so Nora's clicks are not counted, which adds nothing rather than a zero.
    const nora = buildFunnel({ items: [read({ platform: 'reddit', score: 30, replies: 2 }, true)], clicks: null })
    const total = sumFunnels([ada, nora])
    expect(total).toMatchObject({ items: 2, replies: 6, clicks: 5, mock: true })
    expect(total).not.toHaveProperty('reach')
    expect(sumFunnels([nora]).clicks).toBeNull()
  })
})

const SNAPSHOT_BASE = { _creationTime: 0, accountId: 'p' as Id<'accounts'>, mock: false }

function snapshot(postId: string, takenAt: number, counts: ItemCounts): Doc<'metricSnapshots'> {
  return {
    ...SNAPSHOT_BASE,
    _id: `s-${postId}-${takenAt}` as Id<'metricSnapshots'>,
    item: { kind: 'post', postId: postId as Id<'posts'> },
    takenAt,
    counts,
  }
}

describe('buildTrend', () => {
  it("counts each day what each item of the window's reach grew by since its last read", () => {
    const trend = buildTrend({
      days: ['d1', 'd2'],
      snapshots: [snapshot('a', 1, X(100, 0)), snapshot('a', 2, X(250, 0)), snapshot('b', 2, X(40, 0)), snapshot('old', 2, X(900, 0))],
      // An item posted before the window is not the funnel's, so its reach is not the trend's either.
      items: new Set(['a', 'b']),
      clicks: [{ day: 'd2' }],
      snapshotDay: (read) => (read.takenAt === 1 ? 'd1' : 'd2'),
    })
    expect(trend).toEqual([
      { day: 'd1', reach: 100, clicks: 0 },
      { day: 'd2', reach: 190, clicks: 1 },
    ])
  })
})

describe('buildReachLine', () => {
  const karmaRead = (takenAt: number, karma: number): Doc<'accountSnapshots'> => ({
    ...SNAPSHOT_BASE,
    _id: `a-${takenAt}` as Id<'accountSnapshots'>,
    takenAt,
    reach: { platform: 'reddit', linkKarma: karma, commentKarma: 10 },
  })

  it("keeps the day's last read and says how far the karma moved over the window", () => {
    const line = buildReachLine([karmaRead(3, 130), karmaRead(1, 100), karmaRead(2, 120)], (at) => (at === 1 ? 'd1' : 'd2'))
    expect(line).toEqual({
      points: [
        { day: 'd1', value: 110 },
        { day: 'd2', value: 140 },
      ],
      latest: 140,
      change: 30,
      mock: false,
    })
    expect(buildReachLine([], () => 'd1')).toBeNull()
  })
})

function outcome(
  id: string,
  post: Partial<Doc<'posts'>>,
  numbers: { reach: number | null; clicks: number | null },
  platform: Platform = 'x'
): PostOutcome {
  return { post: { _id: id as Id<'posts'>, ...post } as Doc<'posts'>, platform, ...numbers }
}

describe('rankGroups', () => {
  const byPillar = (post: Doc<'posts'>) => (post.pillar === undefined ? null : { key: post.pillar, label: post.pillar })

  it('ranks by clicks per reach, so a group is not ahead for having more posts, and leaves out a post in no group', () => {
    const groups = rankGroups(
      [
        outcome('1', { pillar: 'n8n' }, { reach: 1000, clicks: 10 }),
        outcome('2', { pillar: 'n8n' }, { reach: 1000, clicks: 10 }),
        outcome('3', { pillar: 'n8n' }, { reach: 1000, clicks: 10 }),
        outcome('4', { pillar: 'agents' }, { reach: 1000, clicks: 20 }),
        outcome('5', {}, { reach: 1000, clicks: 90 }),
      ],
      byPillar
    )
    expect(groups.map((group) => [group.key, group.posts, group.clicks, group.clicksPerReach])).toEqual([
      ['agents', 1, 20, 0.02],
      ['n8n', 3, 30, 0.01],
    ])
    expect(groups[1]?.postIds).toEqual(['1', '2', '3'])
  })

  it('counts clicks per reach only over the posts whose clicks are counted and whose reach was read, then ranks by reach per post', () => {
    const groups = rankGroups(
      [
        // Its reach was never read, so its clicks are no share of any reach.
        outcome('1', { pillar: 'n8n' }, { reach: null, clicks: 40 }),
        outcome('2', { pillar: 'n8n' }, { reach: 1000, clicks: 10 }),
        outcome('3', { pillar: 'agents' }, { reach: 1000, clicks: 50 }),
        // A Reddit post links to the sponsor directly: no click counted.
        outcome('4', { pillar: 'reddit only' }, { reach: 1000, clicks: null }, 'reddit'),
        outcome('5', { pillar: 'reddit wide' }, { reach: 3000, clicks: null }, 'reddit'),
      ],
      byPillar
    )
    expect(groups.map((group) => [group.key, group.reachPerPost, group.clicks, group.clicksPerReach])).toEqual([
      ['agents', 1000, 50, 0.05],
      ['n8n', 1000, 50, 0.01],
      ['reddit wide', 3000, null, null],
      ['reddit only', 1000, null, null],
    ])
  })

  it('says no reach per post for a group whose posts are on more than one platform, which each count reach their own way', () => {
    const [group] = rankGroups(
      [
        outcome('1', { pillar: 'n8n' }, { reach: 1000, clicks: 10 }),
        outcome('2', { pillar: 'n8n' }, { reach: 40, clicks: null }, 'hackernews'),
      ],
      byPillar
    )
    expect(group).toMatchObject({ reachPerPost: null, clicks: 10, clicksPerReach: 0.01 })
  })
})
