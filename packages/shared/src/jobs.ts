export const AGENT_ROLES = ['researcher', 'writer', 'judge', 'analyst'] as const
export type AgentRole = (typeof AGENT_ROLES)[number]

export const AGENT_ROLE_LABELS: Record<AgentRole, string> = {
  researcher: 'Researcher',
  writer: 'Writer',
  judge: 'Judge',
  analyst: 'Analyst',
}

export const JOB_STATUSES = ['queued', 'running', 'done', 'failed'] as const
export type JobStatus = (typeof JOB_STATUSES)[number]

/** Every unit of agent work. Every job runs on the backend (ADR 0004): Influstep never posts, so nothing needs the operator's machine. */
export const JOB_KINDS = {
  poll_signals: { role: 'researcher' },
  // Every morning: poll the sources, log repeated questions as problems, write the daily brief.
  morning_sweep: { role: 'researcher' },
  plan_week: { role: 'writer' },
  write_post: { role: 'writer' },
  // The judge reads each written post from the reader's side before it waits for the operator (shared judge.ts).
  judge_post: { role: 'judge' },
  poll_comments: { role: 'researcher' },
  pull_metrics: { role: 'analyst' },
  // Once a day for the whole workspace: every platform's probable conversions (shared probable.ts). They name a
  // platform, not an account, so the job runs under the first active account only to be listed on the Agents page.
  pull_probable: { role: 'analyst' },
  review_strategy: { role: 'analyst' },
  import_history: { role: 'researcher' },
  learn_voice: { role: 'analyst' },
  // Replies (shared replies.ts): the listener's sweep and the writer's replies. The operator posts each one.
  listen: { role: 'researcher' },
  write_replies: { role: 'writer' },
  // The match: which of the account's own posts and comments came from which draft (docs/plan.md, slice 5).
  match: { role: 'analyst' },
  // Tasks the operator gives an account in its chat (shared CHAT_TASKS): the role that owns the data answers there.
  research_brief: { role: 'researcher' },
  comment_digest: { role: 'researcher' },
  analytics_summary: { role: 'analyst' },
} as const satisfies Record<string, { role: AgentRole }>

export type JobKind = keyof typeof JOB_KINDS

export const JOB_KIND_LIST = Object.keys(JOB_KINDS) as JobKind[]

export const JOB_KIND_LABELS: Record<JobKind, string> = {
  poll_signals: 'Poll signals',
  morning_sweep: 'Morning sweep',
  plan_week: 'Plan the week',
  write_post: 'Write the post',
  judge_post: 'Judge the post',
  poll_comments: 'Read comments',
  pull_metrics: 'Pull metrics',
  pull_probable: 'Probable conversions',
  review_strategy: 'Review strategy',
  import_history: 'Import history',
  learn_voice: 'Learn the voice',
  listen: 'Listen',
  write_replies: 'Write replies',
  match: 'Match',
  research_brief: 'Research brief',
  comment_digest: 'Comment digest',
  analytics_summary: 'Analytics summary',
}
