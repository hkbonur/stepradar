import { PLATFORM_HANDLES, PLATFORM_KIND_LABELS, placeLabel, samePlace, type PlatformPlace } from './platforms'
import { namesSponsor, sameHandle } from './replies'

/**
 * Onboarding: the flow that adds the operator's own accounts, one step per
 * account, on the first run and one at a time later. The operator names the
 * account (its platform, its handle there and its name) with its niche and
 * audience; the writer proposes how it sounds and what it covers, and the
 * operator edits the proposal in place before it is created.
 */

/** How many accounts the first run adds at most; more are added one at a time. */
export const ONBOARDING_ACCOUNTS_MAX = 5

/** How many posts a new account writes unsponsored before its sponsor dial applies (CONTEXT.md, "Sponsor dial"). */
export const SPONSOR_RAMP_POSTS = 10

export const PILLARS_MIN = 3
export const PILLARS_MAX = 5

/**
 * Which of the operator's accounts it is, and who it talks to: what the
 * operator gives before the writer proposes. Its place is its platform, and
 * on a forum the forum the setup found at the address the operator gave.
 */
export type AccountIdentity = PlatformPlace & {
  /** The account's handle on its platform, as the platform spells it (shared `PLATFORM_HANDLES`); also its links' utm_source. */
  handle: string
  name: string
  niche: string
  audience: string
}

/** An account as its handle is compared: where it takes part, and its handle there. */
type PlacedHandle = PlatformPlace & { handle: string }

/** What the writer proposes for a new account, and what the operator edits before creating it. */
export interface AccountProposal {
  tone: string
  pillars: string[]
  bio: string
  bible: string
  /** How the account says it builds the sponsor, said as written in every draft that names it (CONTEXT.md, "Affiliation line"). */
  affiliationLine: string
}

/** What stops the writer proposing for the account the operator names: its identity's problems, and a handle another account has where it takes part. */
export function namedAccountProblems(identity: AccountIdentity, accounts: readonly PlacedHandle[]): string[] {
  const taken = takenHandleProblem(identity, accounts)
  return [...identityProblems(identity), ...(taken === null ? [] : [taken])]
}

/** Pillars as the operator types them: comma separated, trimmed, empty ones dropped. */
export function parsePillars(text: string): string[] {
  return text
    .split(',')
    .map((pillar) => pillar.trim())
    .filter((pillar) => pillar.length > 0)
}

/**
 * Why an account's handle is taken: another account has it in the same
 * place, in any case (an account's links name it by its handle and its place
 * together, shared `utmMediumOf`); null when none has. The same handle on two
 * platforms, or on two forums, is two accounts.
 */
export function takenHandleProblem(identity: PlacedHandle, accounts: readonly PlacedHandle[]): string | null {
  const taken = accounts.some((account) => samePlace(account, identity) && sameHandle(account.handle, identity.handle))
  return taken ? `The ${placeLabel(identity)} handle ${identity.handle} is taken.` : null
}

/**
 * Everything wrong with the account the operator names, in their words;
 * none when the writer can propose for it. Whether its handle is taken is
 * `takenHandleProblem`'s, which reads the roster; `namedAccountProblems`
 * asks both.
 */
export function identityProblems(identity: AccountIdentity): string[] {
  const problems: string[] = []
  const handles = PLATFORM_HANDLES[identity.platform]
  if (!handles.pattern.test(identity.handle)) problems.push(`${PLATFORM_KIND_LABELS[identity.platform]} handles are ${handles.rule}.`)
  if (identity.name.trim().length === 0) problems.push('The account needs a name.')
  if (identity.niche.trim().length === 0) problems.push('Say what the account is about: its niche.')
  if (identity.audience.trim().length === 0) problems.push('Say who the account talks to: its audience.')
  return problems
}

/** Everything wrong with the proposal as the operator edited it; none when the account can be created. */
export function proposalProblems(proposal: AccountProposal, sponsorName: string): string[] {
  const problems: string[] = []
  if (proposal.tone.trim().length === 0) problems.push('Describe the tone in a few words.')
  if (proposal.pillars.length < PILLARS_MIN || proposal.pillars.length > PILLARS_MAX)
    problems.push(`Give ${PILLARS_MIN} to ${PILLARS_MAX} content pillars, comma separated.`)
  if (new Set(proposal.pillars.map((pillar) => pillar.toLowerCase())).size < proposal.pillars.length)
    problems.push('Each content pillar is named once.')
  if (proposal.bio.trim().length === 0) problems.push('The account needs a bio.')
  if (proposal.bible.trim().length === 0) problems.push('The bible says how the account speaks and what it never says.')
  problems.push(...affiliationProblems(proposal.affiliationLine, sponsorName))
  return problems
}

/** What is wrong with an affiliation line: it must say, in a sentence that names it, that the operator builds the sponsor. */
export function affiliationProblems(line: string, sponsorName: string): string[] {
  return namesSponsor(line.trim(), sponsorName) ? [] : [`The affiliation line says that you build ${sponsorName}, and names it.`]
}
