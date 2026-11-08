import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import { instantAt } from './core/dates'
import { mockLlm } from './providers/llm/mock'
import { POST_HOUR, insertPost, insertJob, insertAccount, TIMEZONE } from '../test/fixtures'
import { setup } from '../test/setup'

/**
 * The chat that changes the plan (docs/plan.md, slice 7), end to end with the
 * mock interpreter (shared parseChatIntent): the operator sends a message,
 * the account reads it once, applies it and replies in the chat. The clock
 * stands on Wednesday 14 October 2026 in Oslo, so every weekday in a message
 * names a known day.
 */

const TODAY = '2026-10-14'
const THIS_THURSDAY = '2026-10-15'
const NEXT_TUESDAY = '2026-10-20'
const NEXT_FRIDAY = '2026-10-23'
const NEXT_SATURDAY = '2026-10-24'

beforeEach(() => {
  // Only Date is faked, and it keeps running, so the scheduler's timers and the rows' creation order are real.
  vi.useFakeTimers({ now: instantAt(TODAY, 10, TIMEZONE), toFake: ['Date'], shouldAdvanceTime: true })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

type Harness = ReturnType<typeof setup>

/** Ada and three posts: a draft this Thursday, an n8n idea next Tuesday, another draft next Friday. */
async function plan(t: Harness) {
  return t.run(async (ctx) => {
    const account = await insertAccount(ctx)
    const thursday = await insertPost(ctx, account, {
      status: 'draft',
      plannedFor: THIS_THURSDAY,
      concept: 'Error workflows that page you once',
    })
    const tuesday = await insertPost(ctx, account, {
      status: 'idea',
      plannedFor: NEXT_TUESDAY,
      concept: 'Retry an n8n webhook',
      pillar: 'n8n tutorials',
    })
    const friday = await insertPost(ctx, account, {
      status: 'draft',
      plannedFor: NEXT_FRIDAY,
      concept: 'Pause a workflow until the customer signs off',
    })
    return { account, thursday, tuesday, friday }
  })
}

/** Sends a message as the operator and waits until the account has read it and everything it queued has run. */
async function say(t: Harness, account: Doc<'accounts'>, text: string): Promise<void> {
  await t.mutation(api.private.accounts.sendMessage, { accountId: account._id, text })
  await t.finishAllScheduledFunctions(() => {})
}

/** The account's messages after the operator's last one, oldest first. */
async function repliesTo(t: Harness, account: Doc<'accounts'>): Promise<Doc<'messages'>[]> {
  const messages = await t.run((ctx) =>
    ctx.db
      .query('messages')
      .withIndex('by_account', (q) => q.eq('accountId', account._id))
      .collect()
  )
  const lastAsk = messages.map((message) => message.author).lastIndexOf('operator')
  return messages.slice(lastAsk + 1)
}

async function onlyReply(t: Harness, account: Doc<'accounts'>): Promise<Doc<'messages'>> {
  const replies = await repliesTo(t, account)
  expect(replies.map((reply) => reply.author)).toEqual(['account'])
  const [reply] = replies
  if (!reply) throw new Error('no reply')
  return reply
}

async function jobKindsOf(t: Harness, postId: Id<'posts'>): Promise<string[]> {
  const jobs = await t.run((ctx) =>
    ctx.db
      .query('jobs')
      .withIndex('by_post', (q) => q.eq('postId', postId))
      .collect()
  )
  return jobs.map((job) => job.kind)
}

async function post(t: Harness, postId: Id<'posts'>): Promise<Doc<'posts'>> {
  const row = await t.run((ctx) => ctx.db.get(postId))
  if (!row) throw new Error(`post ${postId} not found`)
  return row
}

describe('chat changes the plan', () => {
  it('replaces a post: the old one is killed and a new idea takes its day, written the day before', async () => {
    const t = setup()
    const { account, tuesday } = await plan(t)

    await say(t, account, "Replace Tuesday's n8n post with one about Make")

    expect((await post(t, tuesday._id)).status).toBe('killed')
    const reply = await onlyReply(t, account)
    expect(reply.text).toBe('Replaced Tuesday\'s "Retry an n8n webhook" with "Make". The writer writes it on Mon 19 Oct.')
    if (reply.postId === undefined) throw new Error('the reply links no post')
    const replacement = await post(t, reply.postId)
    expect([replacement.concept, replacement.plannedFor, replacement.kind, replacement.pillar]).toEqual([
      'Make',
      NEXT_TUESDAY,
      tuesday.kind,
      'n8n tutorials',
    ])
    expect([replacement.intent, replacement.length, replacement.scheduledAt]).toEqual([tuesday.intent, tuesday.length, tuesday.scheduledAt])
    expect(await jobKindsOf(t, replacement._id)).toEqual([])
  })

  it("replaces tomorrow's post with the writer on it at once", async () => {
    const t = setup()
    const { account, thursday } = await plan(t)

    await say(t, account, "Replace Thursday's post with one about Zapier")

    expect((await post(t, thursday._id)).status).toBe('killed')
    const reply = await onlyReply(t, account)
    expect(reply.text).toBe('Replaced Thursday\'s "Error workflows that page you once" with "Zapier". The writer is on it.')
    if (reply.postId === undefined) throw new Error('the reply links no post')
    const replacement = await post(t, reply.postId)
    expect([replacement.concept, replacement.plannedFor]).toEqual(['Zapier', THIS_THURSDAY])
    // The writer first; the judge reads what it wrote after.
    expect((await jobKindsOf(t, replacement._id))[0]).toBe('write_post')
  })

  it('moves a post within its week, at its slot', async () => {
    const t = setup()
    const { account, friday } = await plan(t)

    await say(t, account, 'move Friday to Saturday')

    const reply = await onlyReply(t, account)
    expect([reply.text, reply.postId]).toEqual([
      'Moved "Pause a workflow until the customer signs off" from Friday to Saturday.',
      friday._id,
    ])
    const moved = await post(t, friday._id)
    expect([moved.plannedFor, moved.scheduledAt]).toEqual([NEXT_SATURDAY, instantAt(NEXT_SATURDAY, POST_HOUR, TIMEZONE)])
  })

  it('drops a post', async () => {
    const t = setup()
    const { account, tuesday } = await plan(t)

    await say(t, account, 'drop the webhook one')

    const reply = await onlyReply(t, account)
    expect([reply.text, reply.postId]).toEqual([
      'Dropped "Retry an n8n webhook" (Tuesday). It stays on the calendar as killed.',
      tuesday._id,
    ])
    expect((await post(t, tuesday._id)).status).toBe('killed')
  })

  it('asks which one when the message names several posts, and changes nothing', async () => {
    const t = setup()
    const { account, tuesday } = await plan(t)
    const other = await t.run((ctx) =>
      insertPost(ctx, account, { status: 'idea', plannedFor: NEXT_FRIDAY, concept: 'n8n or Make for a small team' })
    )

    await say(t, account, 'drop the n8n one')

    const reply = await onlyReply(t, account)
    expect(reply.text).toBe('That matches 2 posts: Tue 20 Oct: Retry an n8n webhook; Fri 23 Oct: n8n or Make for a small team. Which one?')
    expect([(await post(t, tuesday._id)).status, (await post(t, other._id)).status]).toEqual(['idea', 'idea'])
  })

  it('lists the plan when the message names no post of it', async () => {
    const t = setup()
    const { account } = await plan(t)

    await say(t, account, 'drop the pricing one')

    const reply = await onlyReply(t, account)
    expect(reply.text).toBe(
      [
        'I could not find a post of mine that matches. Planned:',
        'Thu 15 Oct: Error workflows that page you once',
        'Tue 20 Oct: Retry an n8n webhook',
        'Fri 23 Oct: Pause a workflow until the customer signs off',
      ].join('\n')
    )
  })

  it('refuses a move to a day that has passed, in the reply', async () => {
    const t = setup()
    const { account, thursday } = await plan(t)

    await say(t, account, 'move Thursday to Monday')

    const reply = await onlyReply(t, account)
    expect([reply.text, reply.postId]).toEqual([
      'Mon 12 Oct has passed, so "Error workflows that page you once" stays on Thursday.',
      thursday._id,
    ])
    expect((await post(t, thursday._id)).plannedFor).toBe(THIS_THURSDAY)
  })

  it('stores a directive and marks the operator message that became it', async () => {
    const t = setup()
    const { account } = await plan(t)

    await say(t, account, 'focus on n8n error handling for two weeks')

    const directives = await t.run((ctx) => ctx.db.query('directives').collect())
    expect(directives.map((directive) => [directive.text, directive.active])).toEqual([['focus on n8n error handling for two weeks', true]])
    const [directive] = directives
    const messages = await t.run((ctx) => ctx.db.query('messages').collect())
    const ask = messages.find((message) => message.author === 'operator')
    expect(ask?.directiveId).toBe(directive?._id)
    const reply = await onlyReply(t, account)
    expect(reply.directiveId).toBe(directive?._id)
  })
})

describe('chat remembers', () => {
  async function memoriesOf(t: Harness, account: Doc<'accounts'>): Promise<Doc<'memories'>[]> {
    return t.run((ctx) =>
      ctx.db
        .query('memories')
        .withIndex('by_account_status', (q) => q.eq('accountId', account._id))
        .collect()
    )
  }

  it('keeps a fact with the message as its evidence, its quotes intact, and says so once', async () => {
    const t = setup()
    const { account } = await plan(t)

    await say(t, account, "remember that readers hate the word 'guys'")

    const [fact, ...others] = await memoriesOf(t, account)
    expect(others).toEqual([])
    const ask = (await t.run((ctx) => ctx.db.query('messages').collect())).find((message) => message.author === 'operator')
    expect(fact).toMatchObject({
      kind: 'fact',
      text: "Readers hate the word 'guys'",
      actor: 'operator',
      evidence: { postIds: [], signalIds: [], messageId: ask?._id },
      status: 'active',
    })
    const reply = await onlyReply(t, account)
    expect(reply.text).toBe(`I will remember that: "Readers hate the word 'guys'" I read what I know before every post and reply.`)
  })

  it('keeps a rule, and says it already knows the same words told again', async () => {
    const t = setup()
    const { account } = await plan(t)

    await say(t, account, 'Remember to always show the URL bar, please')
    expect((await onlyReply(t, account)).text).toBe(
      'I will keep this rule: "Always show the URL bar." I read my rules before every post and reply.'
    )
    await say(t, account, 'note that always show the url bar.')

    expect((await onlyReply(t, account)).text).toBe('I already remember that: "Always show the URL bar."')
    expect((await memoriesOf(t, account)).map((entry) => [entry.kind, entry.text])).toEqual([['rule', 'Always show the URL bar.']])
  })
})

describe('chat tasks', () => {
  it('queues a research brief with the researcher, which answers in the chat', async () => {
    const t = setup()
    const { account } = await plan(t)

    await say(t, account, 'research brief on Make vs n8n')

    const jobs = await t.run((ctx) => ctx.db.query('jobs').collect())
    const brief = jobs.find((job) => job.kind === 'research_brief')
    if (!brief) throw new Error('no research brief was queued')
    const messages = await t.run((ctx) => ctx.db.query('messages').collect())
    const ask = messages.find((message) => message.author === 'operator')
    expect([brief.role, brief.status, brief.accountId, brief.messageId]).toEqual(['researcher', 'done', account._id, ask?._id])
    expect(brief.topic).toBe('Make vs n8n')

    const replies = await repliesTo(t, account)
    expect(replies.map((reply) => [reply.author, reply.jobId])).toEqual([
      ['account', brief._id],
      ['account', brief._id],
    ])
    const [ack, report] = replies
    expect(ack?.text).toBe('Asked the researcher for a research brief on Make vs n8n. It lands here when it is done.')
    expect(brief.result).toEqual({ messageId: report?._id })
  })

  it('filters a research brief by the whole topic, or by either side of a comparison', async () => {
    const t = setup()
    const { account } = await plan(t)
    await t.run(async (ctx) => {
      const titles = [
        'The n8n Error Trigger node, explained',
        'The other side of webhooks',
        'Make scenarios that retry',
        'Weather alerts in n8n',
        'Design a customer signup flow',
      ]
      for (const [index, title] of titles.entries())
        await ctx.db.insert('signals', {
          accountId: account._id,
          source: 'hackernews',
          externalId: `hn-${index}`,
          title,
          url: `https://news.ycombinator.com/item?id=${index}`,
          summary: '',
          score: 10,
          topics: [],
          status: 'new',
          foundAt: Date.now(),
          mock: true,
        })
    })

    await say(t, account, 'research brief on the n8n error trigger')
    expect((await repliesTo(t, account)).at(-1)?.text).toBe(
      '1 new signal on the n8n error trigger: "The n8n Error Trigger node, explained".'
    )

    await say(t, account, 'research brief on Make vs n8n')
    const comparison = (await repliesTo(t, account)).at(-1)?.text
    expect(comparison).toContain('3 new signals on Make vs n8n')
    expect(comparison).not.toContain('The other side of webhooks')

    await say(t, account, 'research brief on customer sign-off')
    expect((await repliesTo(t, account)).at(-1)?.text).toBe('No new signals on customer sign-off.')
  })

  it('says in the chat when a task fails', async () => {
    const t = setup()
    const { account } = await plan(t)
    vi.spyOn(mockLlm, 'taskReport').mockRejectedValue(new Error('the model is down'))

    await say(t, account, 'comment digest please')

    const jobs = await t.run((ctx) => ctx.db.query('jobs').collect())
    const digest = jobs.find((job) => job.kind === 'comment_digest')
    if (!digest) throw new Error('no comment digest was queued')
    expect([digest.role, digest.status]).toEqual(['researcher', 'failed'])
    const replies = await repliesTo(t, account)
    expect(replies.map((reply) => reply.jobId)).toEqual([digest._id, digest._id])
    const failure = replies.at(-1)?.text
    expect(failure).toContain('The researcher could not finish the comment digest: ')
    expect(failure).toContain('the model is down')
  })
})

describe('agents board', () => {
  it('lists the four roles with each job in its bucket', async () => {
    const t = setup()
    const { account, thursday, tuesday } = await plan(t)
    const jobs = await t.run(async (ctx) => {
      const pulling = await insertJob(ctx, thursday, { kind: 'pull_metrics', status: 'running' })
      const firstScript = await insertJob(ctx, tuesday, { kind: 'write_post', status: 'queued' })
      const secondScript = await insertJob(ctx, thursday, { kind: 'write_post', status: 'queued' })
      const messageId = await ctx.db.insert('messages', {
        accountId: account._id,
        author: 'operator',
        text: 'what are people saying in the comments',
        createdAt: Date.now(),
      })
      const digestId = await ctx.db.insert('jobs', {
        kind: 'comment_digest',
        role: 'researcher',
        status: 'failed',
        accountId: account._id,
        messageId,
        error: 'the model is down',
        attempts: 1,
        createdAt: Date.now(),
        startedAt: Date.now(),
        finishedAt: Date.now(),
      })
      return { pulling, firstScript, secondScript, digestId }
    })

    const board = await t.query(api.private.agents.board, {})

    expect(board.roles.map((row) => row.role)).toEqual(['researcher', 'writer', 'judge', 'analyst'])
    const row = (role: string) => {
      const found = board.roles.find((candidate) => candidate.role === role)
      if (!found) throw new Error(`no ${role} row`)
      return found
    }
    expect(row('analyst').running.map((job) => [job._id, job.account?.name, job.post?.title])).toEqual([
      [jobs.pulling._id, account.name, thursday.title],
    ])
    expect(row('writer').queued.count).toBe(2)
    expect(row('writer').queued.next.map((job) => job._id)).toEqual([jobs.firstScript._id, jobs.secondScript._id])
    expect(row('researcher')).toEqual({
      role: 'researcher',
      running: [],
      queued: { count: 0, next: [] },
      recent: [
        expect.objectContaining({
          _id: jobs.digestId,
          status: 'failed',
          error: 'the model is down',
          brief: 'what are people saying in the comments',
        }),
      ],
    })
  })
})
