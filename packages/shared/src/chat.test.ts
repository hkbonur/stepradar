import { describe, expect, it } from 'vitest'
import {
  CHAT_INTENT_KINDS,
  CHAT_TASKS,
  chatIntentSchema,
  isChatTask,
  matchPosts,
  parseChatIntent,
  shortDayLabel,
  weekdayOf,
  type MatchablePost,
} from './chat'
import { JOB_KIND_LABELS, JOB_KINDS } from './jobs'

describe('parseChatIntent', () => {
  it('reads the three plan changes the plan names, verbatim', () => {
    expect(parseChatIntent("Replace Tuesday's n8n post with one about Make")).toEqual({
      kind: 'replace',
      target: { weekday: 'tuesday', keyword: 'n8n' },
      concept: 'Make',
    })
    expect(parseChatIntent('move Friday to Saturday')).toEqual({ kind: 'move', target: { weekday: 'friday' }, to: 'saturday' })
    expect(parseChatIntent('drop the webhook one')).toEqual({ kind: 'drop', target: { keyword: 'webhook' } })
  })

  it('reads a replace by swap, with a curly possessive, a post, and a weekday alone', () => {
    expect(parseChatIntent('swap Friday’s post with a post about pricing pages.')).toEqual({
      kind: 'replace',
      target: { weekday: 'friday' },
      concept: 'pricing pages',
    })
    expect(parseChatIntent('Please replace the webhook one with a post about Make')).toEqual({
      kind: 'replace',
      target: { keyword: 'webhook' },
      concept: 'Make',
    })
    expect(parseChatIntent('replace Wednesday with one about error workflows')).toEqual({
      kind: 'replace',
      target: { weekday: 'wednesday' },
      concept: 'error workflows',
    })
  })

  it('reads a move by move, shift or push, with a keyword or a weekday after the noun', () => {
    expect(parseChatIntent("shift Monday's post to Thursday")).toEqual({ kind: 'move', target: { weekday: 'monday' }, to: 'thursday' })
    expect(parseChatIntent('push the Friday one back to Sunday')).toEqual({ kind: 'move', target: { weekday: 'friday' }, to: 'sunday' })
    expect(parseChatIntent('can you move the n8n post on Tuesday to Wednesday?')).toEqual({
      kind: 'move',
      target: { weekday: 'tuesday', keyword: 'n8n' },
      to: 'wednesday',
    })
  })

  it('reads a drop by drop, cancel, skip or kill, and needs a noun after a bare keyword', () => {
    expect(parseChatIntent("cancel Thursday's post")).toEqual({ kind: 'drop', target: { weekday: 'thursday' } })
    expect(parseChatIntent('skip the "retry" post')).toEqual({ kind: 'drop', target: { keyword: 'retry' } })
    expect(parseChatIntent('kill the one about pricing')).toEqual({ kind: 'drop', target: { keyword: 'pricing' } })
    expect(parseChatIntent('drop Friday')).toEqual({ kind: 'drop', target: { weekday: 'friday' } })
    expect(parseChatIntent('skip the intro')).toEqual({ kind: 'conversation' })
  })

  it('reads "the next video" as the earliest post for a drop, a move and a replace', () => {
    expect(parseChatIntent('drop the next video')).toEqual({ kind: 'drop', target: { next: true } })
    expect(parseChatIntent('move the next video to Friday')).toEqual({ kind: 'move', target: { next: true }, to: 'friday' })
    expect(parseChatIntent('replace the next video with one about Make')).toEqual({
      kind: 'replace',
      target: { next: true },
      concept: 'Make',
    })
  })

  it('reads no target in a word that only points, so nothing unnamed is changed', () => {
    for (const text of ['cancel that one', 'skip this one', 'move it to friday', 'replace it with one about Make', 'drop those'])
      expect(parseChatIntent(text)).toEqual({ kind: 'conversation' })
    expect(parseChatIntent('move that Friday one to Saturday')).toEqual({ kind: 'move', target: { weekday: 'friday' }, to: 'saturday' })
  })

  it('reads past a please or a thanks at the end', () => {
    expect(parseChatIntent('Drop Friday please')).toEqual({ kind: 'drop', target: { weekday: 'friday' } })
    expect(parseChatIntent('move the webhook one to Monday, thanks!')).toEqual({
      kind: 'move',
      target: { keyword: 'webhook' },
      to: 'monday',
    })
  })

  it('names weekdays only: today and tomorrow are not days it reads', () => {
    expect(parseChatIntent('move the webhook one to tomorrow')).toEqual({ kind: 'conversation' })
  })

  it('reads the three tasks', () => {
    expect(parseChatIntent('research brief on Make vs n8n')).toEqual({ kind: 'task', task: 'research_brief', topic: 'Make vs n8n' })
    expect(parseChatIntent('Can you write a research brief?')).toEqual({ kind: 'task', task: 'research_brief' })
    expect(parseChatIntent('do some research about pricing pages')).toEqual({
      kind: 'task',
      task: 'research_brief',
      topic: 'pricing pages',
    })
    expect(parseChatIntent('what are people saying in the comments')).toEqual({ kind: 'task', task: 'comment_digest' })
    expect(parseChatIntent('comment digest please')).toEqual({ kind: 'task', task: 'comment_digest' })
    expect(parseChatIntent('how did last week go')).toEqual({ kind: 'task', task: 'analytics_summary' })
    expect(parseChatIntent('How are we doing?')).toEqual({ kind: 'task', task: 'analytics_summary' })
    expect(parseChatIntent('send me the analytics')).toEqual({ kind: 'task', task: 'analytics_summary' })
    expect(parseChatIntent('a summary of this week')).toEqual({ kind: 'task', task: 'analytics_summary' })
    expect(parseChatIntent('anything new in the comments?')).toEqual({ kind: 'task', task: 'comment_digest' })
    expect(parseChatIntent('how did you go about the voice')).toEqual({ kind: 'conversation' })
  })

  it('keeps a directive a directive when it only mentions comments or analytics', () => {
    expect(parseChatIntent('stop saying guys in the comments')).toEqual({ kind: 'directive', text: 'stop saying guys in the comments' })
    expect(parseChatIntent('more analytics content please')).toEqual({ kind: 'directive', text: 'more analytics content please' })
  })

  it('reads something to remember as a fact, or as a rule when it says what to do', () => {
    expect(parseChatIntent("Remember that viewers hate the word 'guys'.")).toEqual({
      kind: 'remember',
      memory: 'fact',
      text: "viewers hate the word 'guys'",
    })
    expect(parseChatIntent('remember to always show the URL bar')).toEqual({
      kind: 'remember',
      memory: 'rule',
      text: 'always show the URL bar',
    })
    expect(parseChatIntent('Remember: never open with a question about pricing')).toEqual({
      kind: 'remember',
      memory: 'rule',
      text: 'never open with a question about pricing',
    })
    expect(parseChatIntent('please keep in mind that most of my viewers run n8n on their own server')).toEqual({
      kind: 'remember',
      memory: 'fact',
      text: 'most of my viewers run n8n on their own server',
    })
    expect(parseChatIntent('note that Make raised its prices in March, thanks')).toEqual({
      kind: 'remember',
      memory: 'fact',
      text: 'Make raised its prices in March',
    })
  })

  it('remembers a rule about whom to reply to, with or without "remember"', () => {
    expect(parseChatIntent('never reply to politics')).toEqual({ kind: 'remember', memory: 'rule', text: 'never reply to politics' })
    expect(parseChatIntent('Only reply to people building agents, please.')).toEqual({
      kind: 'remember',
      memory: 'rule',
      text: 'Only reply to people building agents',
    })
    expect(parseChatIntent("ok, don't answer anyone selling courses")).toEqual({
      kind: 'remember',
      memory: 'rule',
      text: "don't answer anyone selling courses",
    })
    expect(parseChatIntent('stop replying to comments')).toEqual({ kind: 'remember', memory: 'rule', text: 'stop replying to comments' })
    // A rule about how to reply, not whom, is a directive like any other.
    expect(parseChatIntent('never say "game changer" in a reply').kind).toBe('directive')
  })

  it('reads a bare "remember" or a question about remembering as no memory', () => {
    expect(parseChatIntent('remember')).toEqual({ kind: 'conversation' })
    expect(parseChatIntent('do you remember the webhook video?').kind).not.toBe('remember')
  })

  it('reads a directive when no other rule matches', () => {
    expect(parseChatIntent('focus on n8n error handling for two weeks')).toEqual({
      kind: 'directive',
      text: 'focus on n8n error handling for two weeks',
    })
    expect(parseChatIntent('Never say "game changer"')).toEqual({ kind: 'directive', text: 'Never say "game changer"' })
  })

  it('reads everything else as conversation', () => {
    expect(parseChatIntent('hi Ada, how was your week?')).toEqual({ kind: 'conversation' })
    expect(parseChatIntent('what is planned?')).toEqual({ kind: 'conversation' })
    expect(parseChatIntent('')).toEqual({ kind: 'conversation' })
  })

  it('returns intents the shared schema accepts', () => {
    for (const text of [
      "Replace Tuesday's n8n post with one about Make",
      'move Friday to Saturday',
      'drop the webhook one',
      'research brief on Make vs n8n',
      'focus on n8n error handling for two weeks',
      "remember that viewers hate the word 'guys'",
      'hello',
    ]) {
      expect(chatIntentSchema.parse(parseChatIntent(text))).toEqual(parseChatIntent(text))
    }
  })
})

describe('chat intents and tasks', () => {
  it('lists the same kinds as the schema', () => {
    expect(chatIntentSchema.options.map((option) => option.shape.kind.value)).toEqual([...CHAT_INTENT_KINDS])
  })
  it('gives each task its job kind, its role and its label', () => {
    expect(CHAT_TASKS.map((task) => JOB_KINDS[task].role)).toEqual(['researcher', 'researcher', 'analyst'])
    expect(CHAT_TASKS.map((task) => JOB_KIND_LABELS[task])).toEqual(['Research brief', 'Comment digest', 'Analytics summary'])
    expect(isChatTask('research_brief')).toBe(true)
    expect(isChatTask('write_post')).toBe(false)
  })
})

describe('days', () => {
  it('reads the weekday of a calendar day without shifting it', () => {
    expect(weekdayOf('2026-10-13')).toBe('tuesday')
    expect(weekdayOf('2026-10-18')).toBe('sunday')
    expect(weekdayOf('2026-10-19')).toBe('monday')
  })
  it('labels a day the way the account names it', () => {
    expect(shortDayLabel('2026-10-13')).toBe('Tue 13 Oct')
    expect(shortDayLabel('2027-01-01')).toBe('Fri 1 Jan')
  })
  it('throws on a malformed day', () => {
    expect(() => weekdayOf('13.10.2026')).toThrow('not a calendar day')
  })
})

describe('matchPosts', () => {
  const post = (fields: Partial<MatchablePost> & Pick<MatchablePost, '_id' | 'plannedFor'>): MatchablePost => ({
    scheduledAt: Date.parse(`${fields.plannedFor}T12:00:00Z`),
    concept: 'Untitled',
    title: 'Untitled',
    ...fields,
  })
  // Tuesday 13 Oct to Saturday 17 Oct 2026.
  const plan = [
    post({
      _id: 'tue-n8n',
      plannedFor: '2026-10-13',
      concept: 'Retry an n8n webhook',
      title: 'Retry an n8n webhook',
      pillar: 'n8n tutorials',
    }),
    post({ _id: 'tue-post', plannedFor: '2026-10-13', concept: 'n8n retries', title: 'n8n retries three times' }),
    post({ _id: 'thu-agent', plannedFor: '2026-10-15', concept: 'An agent that waits', title: 'The agent that waits for you' }),
    post({ _id: 'sat-make', plannedFor: '2026-10-17', concept: 'Make vs n8n', title: 'Make or n8n?', pillar: 'Comparisons' }),
  ]
  const ids = (target: Parameters<typeof matchPosts>[1]) => matchPosts(plan, target).map((match) => match._id)

  it('matches by id first, whatever else the target says', () => {
    expect(ids({ postId: 'thu-agent', weekday: 'tuesday' })).toEqual(['thu-agent'])
    expect(ids({ postId: 'gone' })).toEqual([])
  })
  it('matches the earliest post for next', () => {
    expect(ids({ next: true })).toEqual(['tue-n8n'])
  })
  it('matches by weekday', () => {
    expect(ids({ weekday: 'thursday' })).toEqual(['thu-agent'])
  })
  it('matches a keyword in the concept, title or pillar, ignoring case', () => {
    expect(ids({ keyword: 'WAITS FOR' })).toEqual(['thu-agent'])
    expect(ids({ keyword: 'comparisons' })).toEqual(['sat-make'])
  })
  it('needs both the weekday and the keyword when both are given', () => {
    expect(ids({ weekday: 'saturday', keyword: 'n8n' })).toEqual(['sat-make'])
    expect(ids({ weekday: 'thursday', keyword: 'n8n' })).toEqual([])
  })
  it('returns every match when several hold', () => {
    expect(ids({ keyword: 'n8n' })).toEqual(['tue-n8n', 'tue-post', 'sat-make'])
    expect(ids({ weekday: 'tuesday' })).toEqual(['tue-n8n', 'tue-post'])
  })
  it('matches nothing for a keyword that only points or is too short to name a post', () => {
    const pointing = [
      post({ _id: 'without', plannedFor: '2026-10-13', concept: 'Retry a failed webhook step without losing the payload' }),
      post({ _id: 'that', plannedFor: '2026-10-15', concept: 'Error workflows that page you once' }),
      post({ _id: 'ai', plannedFor: '2026-10-16', concept: 'Wait for an email reply' }),
    ]
    for (const keyword of ['it', 'that', 'This', 'one', 'ai'])
      expect(matchPosts(pointing, { keyword }).map((match) => match._id)).toEqual([])
    expect(matchPosts(pointing, { weekday: 'thursday', keyword: 'that' })).toEqual([])
  })
  it('matches nothing for a target that names nothing', () => {
    expect(ids({})).toEqual([])
    expect(ids({ keyword: '  ' })).toEqual([])
    expect(ids({ weekday: 'monday' })).toEqual([])
  })
})
