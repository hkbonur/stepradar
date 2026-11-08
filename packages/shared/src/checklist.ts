export const CHECKLIST_STATUSES = ['open', 'done'] as const
export type ChecklistStatus = (typeof CHECKLIST_STATUSES)[number]

/**
 * Whether the operator ticks the item off by hand. A connect item closes only
 * by connecting the account, so its checkbox never says it is done when it
 * is not.
 */
export function ticksOffByHand(item: { action?: { kind: string } }): boolean {
  return item.action?.kind !== 'connect_account'
}

export const DIRECTIVE_VERBS = ['focus', 'stop', 'always', 'never', 'more', 'less', 'try'] as const

/**
 * A chat message becomes a directive when it reads like an instruction: it
 * opens with one of the directive verbs or addresses the account with "you
 * should". Everything else is conversation.
 */
export function readsAsDirective(text: string): boolean {
  const trimmed = text.trim().toLowerCase()
  if (trimmed.length < 8) return false
  if (/^(please\s+)?(from now on|you should|i want you to|make sure)/.test(trimmed)) return true
  return DIRECTIVE_VERBS.some((verb) => trimmed.startsWith(`${verb} `))
}
