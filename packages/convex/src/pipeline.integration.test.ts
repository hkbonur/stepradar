import {
  DEFAULT_FORMATS,
  VOICE_EXAMPLES_MAX,
  lengthKindProblem,
  parsePastedPosts,
  parseXArchive,
  type ImportedPost,
  type PostIntent,
  type PostLength,
} from '@influstep/shared'
import type { FunctionReturnType } from 'convex/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import { addDays, dayKey, instantAt } from './core/dates'
import { historySummary } from './core/history'
import { createIdea } from './core/posts'
import { setup } from '../test/setup'

const TIMEZONE = 'Europe/Oslo'

const DAY_MS = 86_400_000

/**
 * One post through the whole pipeline with mock providers: the writer drafts
 * it the day before it is due, the operator posts it by hand and says so with
 * its link, and the analyst measures it until its window closes. Influstep
 * never posts (ADR 0004).
 */

afterEach(() => {
  vi.useRealTimers()
})

describe('post pipeline', () => {
  it('walks a post from idea to measured', async () => {
    const t = setup()
    await t.mutation(internal.internal.seed.run, {})
    const accountId = await t.mutation(api.private.accounts.create, newAccount)
    await t.finishAllScheduledFunctions(() => {})
    const account = await t.run((ctx) => ctx.db.get(accountId))
    if (!account) throw new Error('the account vanished')

    // An idea for tomorrow is written at once.
    const postId = await t.run((ctx) =>
      createIdea(ctx, account, {
        plannedFor: addDays(dayKey(Date.now(), TIMEZONE), 1),
        concept: 'Ship the smallest thing first',
        pillar: 'Shipping',
        sponsorSegment: 'none',
        signalIds: [],
        kind: 'text',
        publishHour: 15,
        intent: 'teach',
        length: 'medium',
      })
    )
    await t.finishAllScheduledFunctions(() => {})
    const drafted = await t.query(api.private.posts.get, { postId })
    expect(drafted?.post.status).toBe('draft')
    expect(drafted?.post.parts?.length).toBe(1)
    expect(drafted?.post.hook).not.toBe('')

    // The operator posts it on X as written and gives its link.
    const written = drafted?.post
    if (!written?.parts) throw new Error('the writer left no post')
    await t.mutation(api.private.posts.markPosted, {
      postId,
      title: written.title,
      parts: written.parts,
      url: 'https://x.com/iris_ships/status/1849012345678901234',
    })
    const posted = await t.query(api.private.posts.get, { postId })
    expect(posted?.post).toMatchObject({ status: 'posted', posted: { kind: 'linked', externalId: '1849012345678901234' } })
    expect(posted?.post.posted?.at).toBeGreaterThan(0)
    // Posted, it is locked.
    await expect(t.mutation(api.private.posts.updatePost, { postId, title: 'Late edit', parts: ['No.'] })).rejects.toThrow(
      'The post is locked once you posted it'
    )

    // The analyst reads its numbers while its window is open, then closes it.
    await t.mutation(api.private.accounts.pullMetrics, { accountId })
    await t.finishAllScheduledFunctions(() => {})
    const measuring = await t.query(api.private.posts.get, { postId })
    expect(measuring?.post.status).toBe('posted')
    expect(measuring?.post.numbers?.counts).toMatchObject({ platform: 'x' })
    await t.run(async (ctx) => {
      const row = await ctx.db.get(postId)
      if (row?.posted === undefined) throw new Error('the post went out without its posted details')
      await ctx.db.patch(postId, { posted: { ...row.posted, at: Date.now() - 8 * DAY_MS } })
    })
    await t.mutation(api.private.accounts.pullMetrics, { accountId })
    await t.finishAllScheduledFunctions(() => {})
    expect((await t.query(api.private.posts.get, { postId }))?.post.status).toBe('measured')
  })

  it('marks a draft posted with or without its link, and refuses a link that names no post on X', async () => {
    const t = setup()
    await t.mutation(internal.internal.seed.run, {})
    const ada = await seededAda(t)
    const linked = await insertPost(t, ada, { kind: 'text', status: 'draft', hour: 15, length: 'medium', parts: ['A post.'] })
    const posted = (url?: string) => ({
      title: 'A post',
      parts: ['A post, as I posted it.'],
      ...(url === undefined ? {} : { url }),
    })
    await expect(t.mutation(api.private.posts.markPosted, { postId: linked, ...posted('https://example.com/post/1') })).rejects.toThrow(
      'That is no link to your post or reply on X.'
    )
    expect((await t.run((ctx) => ctx.db.get(linked)))?.status).toBe('draft')

    // Without a link it counts as posted, with no id for the analyst to read; the post keeps the words that went out.
    await t.mutation(api.private.posts.markPosted, { postId: linked, ...posted('  ') })
    const unlinked = await t.run((ctx) => ctx.db.get(linked))
    expect(unlinked?.status).toBe('posted')
    expect(unlinked?.parts).toEqual(['A post, as I posted it.'])
    expect(unlinked?.posted).toMatchObject({ kind: 'said' })
    await expect(t.mutation(api.private.posts.markPosted, { postId: linked, ...posted() })).rejects.toThrow(
      'Only a draft can be marked posted; this post is at "Posted".'
    )
    const idea = await insertPost(t, ada, { kind: 'text', status: 'idea', hour: 18, length: 'medium' })
    await expect(t.mutation(api.private.posts.markPosted, { postId: idea, ...posted() })).rejects.toThrow(
      'Only a draft can be marked posted; this post is at "Idea".'
    )
  })

  it('skips a draft the operator passes on, and retries a failed post from its draft', async () => {
    const t = setup()
    await t.mutation(internal.internal.seed.run, {})
    const ada = await seededAda(t)
    const skipped = await insertPost(t, ada, { kind: 'text', status: 'draft', hour: 15, length: 'medium', parts: ['A post.'] })
    await t.mutation(api.private.posts.skip, { postId: skipped })
    expect(await t.run((ctx) => ctx.db.get(skipped))).toMatchObject({ status: 'skipped', skipReason: 'You skipped it.' })
    await expect(t.mutation(api.private.posts.skip, { postId: skipped })).rejects.toThrow('A post at "Skipped" cannot be skipped.')

    const failed = await insertPost(t, ada, { kind: 'text', status: 'draft', hour: 18, length: 'medium', parts: ['A post.'] })
    await t.run((ctx) => ctx.db.patch(failed, { status: 'failed', failedFrom: 'draft', error: 'The writer gave up.' }))
    await t.mutation(api.private.posts.retry, { postId: failed })
    const retried = await t.run((ctx) => ctx.db.get(failed))
    expect(retried?.status).toBe('draft')
    expect([retried?.failedFrom, retried?.error]).toEqual([undefined, undefined])

    // A rewrite whose write failed keeps the old words, yet retries as the idea it was, so the writer writes it again.
    await t.mutation(api.private.posts.rewrite, { postId: failed })
    await t.mutation(internal.internal.dispatch.failPost, { postId: failed, error: 'The writer gave up again.' })
    expect(await t.run((ctx) => ctx.db.get(failed))).toMatchObject({ status: 'failed', failedFrom: 'idea' })
    await t.mutation(api.private.posts.retry, { postId: failed })
    expect((await t.run((ctx) => ctx.db.get(failed)))?.status).toBe('idea')
  })

  it('reports a funnel from the seeded month', async () => {
    // The seed's oldest post sits at the edge of the report's 28 days, so whether it counts would hang on the hour the
    // test runs: the clock stands at eight in the morning, UTC, today.
    const today = new Date()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 8))
    const t = setup()
    await t.mutation(internal.internal.seed.run, {})
    await t.finishAllScheduledFunctions(() => {})
    const ada = await seededAda(t)
    const report = await t.query(api.private.report.forAccount, { accountId: ada._id })
    expect(report?.funnel.reach).toBeGreaterThan(1000)
    expect(report?.funnel.signups).toBeGreaterThan(0)
    // Eight measured posts and yesterday's, still in its window, and the replies posted this week.
    expect(report?.posted.filter((item) => item.kind === 'post').length).toBe(9)
    expect(report?.posted.some((item) => item.kind === 'reply')).toBe(true)
    expect(report?.trend.length).toBe(28)
    // The followers the analyst read each day: the reach line climbs over the month.
    expect(report?.reachLine?.change).toBeGreaterThan(0)
    const experiments = await t.query(api.private.experiments.list, { accountId: ada._id })
    expect(experiments.map((experiment) => [experiment.kind, experiment.status])).toEqual([['reply_style', 'running']])
  })

  it('shows an account as working while one of its jobs is queued or running', async () => {
    const t = setup()
    await t.mutation(internal.internal.seed.run, {})
    await t.finishAllScheduledFunctions(() => {})
    // A new account queues its first signal poll, and is idle once the poll is done.
    const accountId = await t.mutation(api.private.accounts.create, newAccount)
    const queued = await t.query(api.private.accounts.list, {})
    expect(queued.find((account) => account._id === accountId)).toMatchObject({ working: true })
    await t.finishAllScheduledFunctions(() => {})
    const idle = await t.query(api.private.accounts.list, {})
    expect(idle.find((account) => account._id === accountId)?.working).toBe(false)
  })

  it('turns a chat instruction into a directive the writer reads', async () => {
    const t = setup()
    await t.mutation(internal.internal.seed.run, {})
    await t.finishAllScheduledFunctions(() => {})
    const accounts = await t.query(api.private.accounts.list, {})
    const max = accounts.find((account) => account.handle === 'max_builds')!
    await t.mutation(api.private.accounts.sendMessage, { accountId: max._id, text: 'Never mention pricing in a post' })
    await t.finishAllScheduledFunctions(() => {})
    const page = await t.query(api.private.accounts.get, { accountId: max._id })
    expect(page?.directives.map((directive) => directive.text)).toContain('Never mention pricing in a post')
    // The account reads the message once: the operator's message carries the directive it became.
    const asked = page?.messages.find((message) => message.author === 'operator' && message.text === 'Never mention pricing in a post')
    expect(asked?.directiveId).toBeDefined()
    expect(page?.messages.at(-1)?.author).toBe('account')
  })
})

/** Posts on X: the data rules. The writer and the planner have their own tests (posts.integration.test.ts). */
describe('posts on X', () => {
  it('refuses a post X would not take', async () => {
    const t = setup()
    await t.mutation(internal.internal.seed.run, {})
    const ada = await seededAda(t)
    const postId = await insertPost(t, ada, { kind: 'thread', status: 'draft', hour: 15, length: 'long' })
    const updatePost = (parts: string[]) => t.mutation(api.private.posts.updatePost, { postId, title: 'A thread', parts })
    await expect(updatePost(['Fine.', 'b'.repeat(281)])).rejects.toThrow('Part 2 is 281 characters; X allows 280.')
    // X weighs a link 23 whatever its length.
    await expect(updatePost(['Fine.', `${'b'.repeat(257)} https://formstep.io/a/long/path`])).rejects.toThrow(
      'Part 2 is 281 characters; X allows 280.'
    )
    await expect(updatePost(['Only one part.'])).rejects.toThrow('A thread is 2 to 6 parts.')
    await updatePost(['First.\nMore of the first.', `${'b'.repeat(256)} https://formstep.io/a/long/path`])
    const saved = await t.query(api.private.posts.get, { postId })
    expect(saved?.post.hook).toBe('First.')
    expect(saved?.post.parts?.length).toBe(2)
  })

  it('checks the X cadence wherever an account is saved', async () => {
    const t = setup()
    await t.mutation(internal.internal.seed.run, {})
    const ada = await seededAda(t)
    const x = DEFAULT_FORMATS.x
    const create = (format: typeof x) => t.mutation(api.private.accounts.create, { ...newAccount, ...format })
    const { cadence } = x
    await expect(create({ ...x, publishHour: 24 })).rejects.toThrow('X: the posting hour is 0 to 23.')
    await expect(create({ ...x, cadence: { ...cadence, postsPerDay: 5 } })).rejects.toThrow('X: posts per day is 1 to 4.')
    await expect(create({ ...x, cadence: { ...cadence, postsPerDay: 0 } })).rejects.toThrow('X: posts per day is 1 to 4.')
    await expect(create({ ...x, cadence: { ...cadence, postsPerDay: 1.5 } })).rejects.toThrow('X: posts per day is 1 to 4.')
    await expect(create({ ...x, cadence: { ...cadence, kinds: [] } })).rejects.toThrow('X: pick at least one post kind.')
    await expect(create({ ...x, cadence: { ...cadence, kinds: ['text', 'thread', 'text'] } })).rejects.toThrow(
      'X: Text post is picked twice.'
    )
    await expect(create({ ...x, cadence: { ...cadence, intents: [] } })).rejects.toThrow('X: pick at least one post intent.')
    await expect(create({ ...x, cadence: { ...cadence, intents: ['ask', 'teach', 'ask'] } })).rejects.toThrow('X: each post intent once.')
    await expect(create({ ...x, cadence: { ...cadence, repliesPerDay: 21 } })).rejects.toThrow('X: replies per day is 0 to 20.')
    await expect(create({ ...x, cadence: { ...cadence, repliesPerDay: -1 } })).rejects.toThrow('X: replies per day is 0 to 20.')
    // A thread is X's.
    await expect(create({ ...x, platform: 'linkedin', cadence: { ...cadence, kinds: ['text', 'thread'] } })).rejects.toThrow(
      'LinkedIn: takes no thread; a post there is one part.'
    )
    await expect(t.mutation(api.private.accounts.update, { ...settingsOf(ada), cadence: { ...cadence, postsPerDay: 9 } })).rejects.toThrow(
      'X: posts per day is 1 to 4.'
    )
    // The affiliation line names the sponsor however it is saved: the writer's ground rule 1 checks drafts against it.
    await expect(t.mutation(api.private.accounts.update, { ...settingsOf(ada), affiliationLine: 'I build things.' })).rejects.toThrow(
      'The affiliation line says that you build Formstep, and names it.'
    )
  })
})

describe('taking over an X account', () => {
  it('imports an archive and a paste once each', async () => {
    const t = setup()
    await t.mutation(internal.internal.seed.run, {})
    const archive = parseXArchive(JSON.stringify(archiveOf(3, 1)))
    const accountId = await t.mutation(api.private.accounts.create, newAccount)
    const importPosts = (source: 'archive' | 'paste', posts: ImportedPost[]) =>
      t.mutation(api.private.history.importPosts, { accountId, source, posts })
    expect(await importPosts('archive', archive)).toEqual({ added: 4, skipped: 0 })
    // The same archive again adds nothing: posts are matched by their X id.
    expect(await importPosts('archive', archive)).toEqual({ added: 0, skipped: 4 })
    // A paste matches by a hash of the text, so a post pasted twice, in one batch or two, is stored once.
    const pasted = parsePastedPosts('Pasted one.\n---\nPasted two.\n---\nPasted one.')
    expect(await importPosts('paste', pasted)).toEqual({ added: 2, skipped: 1 })
    expect(await importPosts('paste', parsePastedPosts('Pasted two.'))).toEqual({ added: 0, skipped: 1 })

    const history = await t.query(api.private.history.history, { accountId, limit: 2 })
    expect(history.totals).toEqual({ count: 6, originals: 5, replies: 1, bySource: { archive: 4, paste: 2, api: 0, mock: 0 } })
    expect(history.posts.length).toBe(2)
    expect(history.posts[0]?.postedAt).toBeGreaterThanOrEqual(history.posts[1]?.postedAt ?? Number.POSITIVE_INFINITY)
    // X could not tell the language of a pasted post, so the row has none.
    const stored = await t.run((ctx) =>
      ctx.db
        .query('accountPosts')
        .withIndex('by_account_posted', (q) => q.eq('accountId', accountId))
        .collect()
    )
    expect(stored.filter((post) => post.source === 'paste').map((post) => post.lang)).toEqual([undefined, undefined])
    expect(stored.filter((post) => post.source === 'archive').map((post) => post.lang)).toEqual(['en', 'en', 'en', 'en'])
    expect(stored.some((post) => post.example)).toBe(false)
    // The self-thread is one row, root first.
    expect(stored.find((post) => post.externalId === '100')?.parts).toEqual(['Original 1.', 'The second part of the first thread.'])

    const tooMany = Array.from({ length: 501 }, (_, index) => ({ ...pasted[0]!, externalId: `bulk-${index}` }))
    await expect(importPosts('paste', tooMany)).rejects.toThrow('Import at most 500 posts at a time.')

    // Import from X is the researcher's job; the mutation only queues it.
    const jobId = await t.mutation(api.private.history.importHistory, { accountId })
    const job = await t.run((ctx) => ctx.db.get(jobId))
    expect(job).toMatchObject({ kind: 'import_history', role: 'researcher', accountId })
  })

  it('learns a voice only from enough originals, and says how many there are', async () => {
    const t = setup()
    await t.mutation(internal.internal.seed.run, {})
    const accountId = await t.mutation(api.private.accounts.create, newAccount)
    // Three originals and two replies: replies are not the account's own voice, so there are three.
    await t.mutation(api.private.history.importPosts, {
      accountId,
      source: 'archive',
      posts: parseXArchive(JSON.stringify(archiveOf(3, 2))),
    })
    await expect(t.mutation(api.private.history.learnVoice, { accountId })).rejects.toThrow('Import at least 10 posts first; there are 3.')

    await t.mutation(api.private.history.importPosts, {
      accountId,
      source: 'paste',
      posts: parsePastedPosts(Array.from({ length: 7 }, (_, index) => `Pasted post ${index + 1}.`).join('\n---\n')),
    })
    const jobId = await t.mutation(api.private.history.learnVoice, { accountId })
    const job = await t.run((ctx) => ctx.db.get(jobId))
    expect(job).toMatchObject({ kind: 'learn_voice', role: 'analyst', accountId })
  })

  it('shows the seeded voice and lets the operator edit its words, never its counts', async () => {
    const t = setup()
    await t.mutation(internal.internal.seed.run, {})
    const ada = await seededAda(t)
    const learned = ada.voice
    if (!learned) throw new Error('the seed has no voice for Ada')
    expect(await t.run((ctx) => historySummary(ctx, ada._id))).toEqual({ posts: 40, examples: 5 })
    expect(learned).toMatchObject({ language: 'en', sampleSize: 36, emoji: 'rare', hashtags: 'rare' })

    const updateVoice = (edit: { language: string; summary: string; traits: string[] }) =>
      t.mutation(api.private.history.updateVoice, { accountId: ada._id, ...edit })
    const edit = { language: ' nb ', summary: ' Rolig og presis. ', traits: ['Short sentences', ' Lists in threads '] }
    await updateVoice(edit)
    const voiceOfAda = async () => (await t.run((ctx) => ctx.db.get(ada._id)))?.voice
    const edited = await voiceOfAda()
    expect(edited).toEqual({
      ...learned,
      language: 'nb',
      summary: 'Rolig og presis.',
      traits: ['Short sentences', 'Lists in threads'],
    })

    await expect(updateVoice({ ...edit, language: '  ' })).rejects.toThrow('The language is empty.')
    await expect(updateVoice({ ...edit, language: 'not a tag' })).rejects.toThrow('"not a tag" is not a language tag such as en, nb or tr.')
    await expect(updateVoice({ ...edit, summary: '' })).rejects.toThrow('The summary is empty.')
    await expect(updateVoice({ ...edit, traits: [] })).rejects.toThrow('A voice has 1 to 8 traits.')
    await expect(updateVoice({ ...edit, traits: Array.from({ length: 9 }, (_, index) => `Trait ${index}`) })).rejects.toThrow(
      'A voice has 1 to 8 traits.'
    )
    await expect(updateVoice({ ...edit, traits: ['Fine', ' '] })).rejects.toThrow('Trait 2 is empty.')
    expect(await voiceOfAda()).toEqual(edited)

    // An account whose voice was never learned has nothing to edit.
    const accountId = await t.mutation(api.private.accounts.create, newAccount)
    await expect(t.mutation(api.private.history.updateVoice, { accountId, ...edit })).rejects.toThrow(
      'Learn the voice first; there is nothing to edit yet.'
    )
  })

  it('keeps at most eight examples, shows them first, and clears them with the history', async () => {
    const t = setup()
    await t.mutation(internal.internal.seed.run, {})
    const ada = await seededAda(t)
    const top: Doc<'accountPosts'>[] = await t.query(api.private.history.topPosts, { accountId: ada._id, limit: 10 })
    const examples = top.filter((post) => post.example)
    expect(examples.length).toBe(5)
    // Examples first, then the other originals by likes plus reposts; no reply is a candidate.
    expect(top.slice(0, 5).every((post) => post.example)).toBe(true)
    expect(top.length).toBe(15)
    expect(top.some((post) => post.isReply)).toBe(false)
    const others = top.slice(5).map((post) => post.likes + post.reposts)
    expect(others).toEqual([...others].sort((a, b) => b - a))

    const candidates = top.slice(5)
    const setExample = (accountPostId: Id<'accountPosts'>, example: boolean) =>
      t.mutation(api.private.history.setExample, { accountPostId, example })
    for (const post of candidates.slice(0, VOICE_EXAMPLES_MAX - 5)) await setExample(post._id, true)
    const ninth = candidates[VOICE_EXAMPLES_MAX - 5]
    if (!ninth) throw new Error('not enough top posts')
    await expect(setExample(ninth._id, true)).rejects.toThrow('A voice keeps at most 8 example posts; unmark one first.')
    // Marking one that already is an example changes nothing and is not refused.
    await setExample(candidates[0]!._id, true)
    await setExample(examples[0]!._id, false)
    await setExample(ninth._id, true)
    expect(await t.run((ctx) => historySummary(ctx, ada._id))).toEqual({ posts: 40, examples: 8 })

    expect(await t.mutation(api.private.history.clearHistory, { accountId: ada._id })).toEqual({ deleted: 40, more: false })
    expect((await t.run((ctx) => ctx.db.get(ada._id)))?.voice).toBeUndefined()
    expect(await t.run((ctx) => historySummary(ctx, ada._id))).toEqual({ posts: 0, examples: 0 })
    expect((await t.query(api.private.history.history, { accountId: ada._id, limit: 10 })).totals.count).toBe(0)
  })

  it('gives every post an intent and a length that fits its kind', async () => {
    const t = setup()
    await t.mutation(internal.internal.seed.run, {})
    const ada = await seededAda(t)
    const page = await t.query(api.private.accounts.get, { accountId: ada._id })
    for (const post of page?.posts ?? []) expect(lengthKindProblem(post.kind, post.length), post.title).toBeNull()

    // The planner's idea: a thread that is not long, or a text post that is, is refused before anything is stored.
    const account = await t.run((ctx) => ctx.db.get(ada._id))
    if (!account) throw new Error('Ada vanished')
    const idea = (kind: 'text' | 'thread', length: PostLength, intent: PostIntent = 'ask') =>
      t.run((ctx) =>
        createIdea(ctx, account, {
          plannedFor: addDays(dayKey(Date.now(), TIMEZONE), 7),
          concept: `A ${kind} post`,
          pillar: account.pillars[0] ?? '',
          sponsorSegment: 'none',
          signalIds: [],
          kind,
          publishHour: 15,
          intent,
          length,
        })
      )
    await expect(idea('thread', 'medium')).rejects.toThrow('A thread is always long.')
    await expect(idea('text', 'long')).rejects.toThrow('A text post is short or medium, never long.')
    const planned = await idea('thread', 'long', 'teach')
    expect(await t.run((ctx) => ctx.db.get(planned))).toMatchObject({ kind: 'thread', intent: 'teach', length: 'long', status: 'idea' })

    // The post update: a thread stored with a length that is not long cannot be saved, however well its parts fit X.
    const postId = await insertPost(t, ada, { kind: 'thread', status: 'draft', hour: 15, length: 'short' })
    await expect(t.mutation(api.private.posts.updatePost, { postId, title: 'A thread', parts: ['First.', 'Second.'] })).rejects.toThrow(
      'A thread is always long.'
    )
    const text = await insertPost(t, ada, { kind: 'text', status: 'draft', hour: 18, length: 'long' })
    await expect(t.mutation(api.private.posts.updatePost, { postId: text, title: 'A text post', parts: ['One.'] })).rejects.toThrow(
      'A text post is short or medium, never long.'
    )
  })
})

/**
 * A tweets.js with `originals` posts of the account's own, the first of them
 * a two-part self-thread, and `replies` replies to posts outside the file.
 */
function archiveOf(originals: number, replies: number) {
  const day = Date.UTC(2026, 8, 1)
  const item = (id: string, text: string, offsetHours: number, replyTo?: string) => ({
    tweet: {
      id_str: id,
      full_text: text,
      created_at: new Date(day + offsetHours * 3_600_000)
        .toUTCString()
        .replace(/^(\w+), (\d+) (\w+) (\d+) (\S+) GMT$/, '$1 $3 $2 $5 +0000 $4'),
      favorite_count: String(10 * offsetHours),
      retweet_count: '1',
      ...(replyTo === undefined ? {} : { in_reply_to_status_id_str: replyTo }),
      lang: 'en',
    },
  })
  return [
    ...Array.from({ length: originals }, (_, index) => item(`${100 + index}`, `Original ${index + 1}.`, index + 1)),
    item('199', 'The second part of the first thread.', 1.5, '100'),
    ...Array.from({ length: replies }, (_, index) => item(`${300 + index}`, `@someone Reply ${index + 1}.`, 20 + index, `9${index}`)),
    item('400', 'RT @someone: not the account’s words', 30),
  ]
}

/** An account the tests create, on X. */
const newAccount = {
  name: 'Iris Ships',
  handle: 'iris.ships',
  niche: 'shipping small SaaS products',
  tone: 'plain',
  bio: 'One shipped feature a week.',
  bible: 'Iris shows the change before she names it.',
  affiliationLine: "I'm building Formstep, so take this with salt.",
  pillars: ['Shipping'],
  ...DEFAULT_FORMATS.x,
  sponsorDial: 0.3,
  sponsorRampPosts: 10,
  timezone: TIMEZONE,
}

async function seededAda(t: ReturnType<typeof setup>) {
  const ada = (await t.query(api.private.accounts.list, {})).find(
    (account) => account.handle === 'ada_automates' && account.platform === 'x'
  )
  if (!ada) throw new Error('seed has no Ada')
  return ada
}

/** A post for Ada a week out, at one of her slots, as the writer would leave it. */
async function insertPost(
  t: ReturnType<typeof setup>,
  ada: { _id: Id<'accounts'> },
  args: { kind: 'text' | 'thread'; status: 'idea' | 'draft'; hour: number; length: PostLength; parts?: string[] }
): Promise<Id<'posts'>> {
  const plannedFor = addDays(dayKey(Date.now(), TIMEZONE), 7)
  const now = Date.now()
  return t.run((ctx) =>
    ctx.db.insert('posts', {
      accountId: ada._id,
      slug: `test-${args.kind}-${Math.random().toString(36).slice(2, 6)}`,
      kind: args.kind,
      intent: 'teach',
      length: args.length,
      status: args.status,
      concept: `A ${args.kind} post`,
      title: `A ${args.kind} post`,
      hook: args.parts?.[0] ?? '',
      parts: args.parts,
      sponsorSegment: 'none',
      plannedFor,
      scheduledAt: instantAt(plannedFor, args.hour, TIMEZONE),
      signalIds: [],
      createdAt: now,
      updatedAt: now,
    })
  )
}

/** The settings form's payload for an account as `list` returns it: every field `update` takes, nothing it refuses. */
function settingsOf(account: FunctionReturnType<typeof api.private.accounts.list>[number]) {
  return {
    accountId: account._id,
    name: account.name,
    niche: account.niche,
    tone: account.tone,
    bio: account.bio,
    bible: account.bible,
    affiliationLine: account.affiliationLine,
    pillars: account.pillars,
    publishHour: account.publishHour,
    cadence: account.cadence,
    sponsorDial: account.sponsorDial,
    sponsorRampPosts: account.sponsorRampPosts,
    timezone: account.timezone,
  }
}
