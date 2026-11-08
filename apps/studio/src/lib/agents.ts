import { AGENT_ROLES, AGENT_ROLE_LABELS } from '@influstep/shared'

/** The agents by name, in the order work flows, for a sentence: "The researcher, the writer and the analyst". */
export const AGENTS_IN_WORDS = (() => {
  const words = new Intl.ListFormat('en-GB', { style: 'long', type: 'conjunction' }).format(
    AGENT_ROLES.map((role) => `the ${AGENT_ROLE_LABELS[role].toLowerCase()}`)
  )
  return words.charAt(0).toUpperCase() + words.slice(1)
})()
