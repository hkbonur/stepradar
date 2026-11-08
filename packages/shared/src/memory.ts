/**
 * An account's memory (docs/plan.md, v0.2 item 10): short entries the account
 * and its agents write, and the writer reads before every post and reply.
 * Each has a kind, the evidence it rests on, who wrote it and a status. No
 * entry is ever deleted, so the account can show why it once believed
 * something.
 */

/**
 * What an entry is: a learning (from a decided experiment or a change the
 * strategy review made), the morning's research brief, a problem the account
 * met, a fact or a rule the operator told it, and the goal note each strategy
 * review leaves (where the account stands against the workspace's goal).
 */
export const MEMORY_KINDS = ['learning', 'brief', 'problem', 'fact', 'rule', 'goal_note'] as const
export type MemoryKind = (typeof MEMORY_KINDS)[number]

export const MEMORY_KIND_LABELS: Record<MemoryKind, string> = {
  learning: 'Learning',
  brief: 'Morning brief',
  problem: 'Problem',
  fact: 'Fact',
  rule: 'Rule',
  goal_note: 'Goal note',
}

/** The kinds the operator writes, in the chat ("remember that ...") or on the memory page. */
export const OPERATOR_MEMORY_KINDS = ['fact', 'rule'] as const satisfies readonly MemoryKind[]
export type OperatorMemoryKind = (typeof OPERATOR_MEMORY_KINDS)[number]

/**
 * Active entries are read. A superseded one gave way to a newer entry on the
 * same subject; a retired one the operator took back (a fact or a rule
 * forgotten, a problem resolved). Neither is read again, and both stay.
 */
export const MEMORY_STATUSES = ['active', 'superseded', 'retired'] as const
export type MemoryStatus = (typeof MEMORY_STATUSES)[number]

/** The kinds the operator can retire: their own facts and rules, and a problem once it is resolved. */
export const RETIRABLE_MEMORY_KINDS = ['fact', 'rule', 'problem'] as const satisfies readonly MemoryKind[]

export function isRetirable(kind: MemoryKind): boolean {
  return RETIRABLE_MEMORY_KINDS.some((retirable) => retirable === kind)
}

/** An operator's entry stays one short sentence or two, so the writer's prompt stays short. */
export const MEMORY_TEXT_MAX = 280

/** Why the operator's text cannot be stored as it is, or null when it can. */
export function memoryTextProblem(text: string): string | null {
  const trimmed = text.trim()
  if (trimmed === '') return 'Say what to remember.'
  if (trimmed.length > MEMORY_TEXT_MAX) return `Keep it to ${MEMORY_TEXT_MAX} characters; this is ${trimmed.length}.`
  return null
}

/** How an operator's entry is stored: trimmed, opening with a capital, ending with an end mark. */
export function memorySentence(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, ' ')
  const capital = trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
  return /[.!?…"'”’)]$/.test(capital) ? capital : `${capital}.`
}

/** Whether two entries say the same thing, so the same fact is not stored twice. */
export function sameMemoryText(a: string, b: string): boolean {
  const normal = (text: string) =>
    text
      .trim()
      .toLowerCase()
      .replace(/[.!?…]+$/, '')
      .replace(/\s+/g, ' ')
  return normal(a) === normal(b)
}

/**
 * The one goal every account of a workspace works toward: paying customers of
 * its sponsor. The strategy review's goal metric ladder (paid over signups
 * over clicks over follows) aims at it, and each review's goal note says
 * where the account stands against it.
 */
export function workspaceGoal(sponsorName: string): string {
  return `Paying ${sponsorName} customers`
}
