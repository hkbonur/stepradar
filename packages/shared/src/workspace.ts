/**
 * The product a workspace's accounts promote (CONTEXT.md, Sponsor): its name,
 * where it lives, what it does in one sentence, and its profile, what a
 * search asks for beyond the account's pillars. The studio's first-run setup and
 * its settings check the fields with these words before they are sent, and
 * the backend refuses with the same ones.
 */

/** The longest pitch: one sentence the writer says in its own words, never a paragraph it reads out. */
export const SPONSOR_PITCH_MAX = 200

/** The shortest pitch that still says what the product does. */
export const SPONSOR_PITCH_MIN = 20

/**
 * The sponsor's profile (CONTEXT.md, Product profile): what people call the
 * thing the sponsor does and what they compare it with. A search asks for
 * both in a query of its own beside an account's pillars, so a thread that
 * says none of a pillar's words is still found. Either list may be empty: a
 * search then asks what it asked without a profile.
 */
export interface SponsorProfile {
  /** Other products people compare the sponsor with, by name. */
  competitors: string[]
  /** What people call what the sponsor does, in the few words they type into a search. */
  searchTerms: string[]
}

/**
 * A proposed profile, with whether the sponsor's website was read for it. A
 * website that could not be read says why, and the proposal then rests on the
 * name and the pitch alone, which the form says beside it.
 */
export interface ProfileProposal {
  profile: SponsorProfile
  site: { read: true } | { read: false; why: string }
}

/** How many entries each list of the profile holds, and how long one may be. */
export const SPONSOR_PROFILE_LIMITS = {
  competitors: { count: 6, length: 40 },
  searchTerms: { count: 8, length: 40 },
} as const satisfies Record<keyof SponsorProfile, { count: number; length: number }>

/** The profile's lists, in form order. */
export const SPONSOR_PROFILE_FIELDS = ['competitors', 'searchTerms'] as const satisfies readonly (keyof SponsorProfile)[]

/** A profile that says nothing yet. */
export function emptySponsorProfile(): SponsorProfile {
  return { competitors: [], searchTerms: [] }
}

/** What the product is: the setup's first step, and what a profile is proposed from. */
export interface SponsorProduct {
  sponsorName: string
  sponsorUrl: string
  sponsorPitch: string
}

export interface SponsorFields extends SponsorProduct {
  sponsorProfile: SponsorProfile
}

/** One problem with the fields, naming the field it is about, so a form marks that field and shows only its own step's. */
export interface SponsorProblem {
  field: keyof SponsorProduct | keyof SponsorProfile
  message: string
}

/** Every problem with the fields, in form order; none when the backend takes them. */
export function sponsorProblems(fields: SponsorFields): SponsorProblem[] {
  return [...sponsorProductProblems(fields), ...sponsorProfileProblems(fields.sponsorProfile, fields.sponsorName)]
}

/** The problems with what the product is. */
export function sponsorProductProblems(fields: SponsorProduct): SponsorProblem[] {
  const problems: SponsorProblem[] = []
  const add = (field: SponsorProblem['field'], message: string) => problems.push({ field, message })
  if (fields.sponsorName.trim() === '') add('sponsorName', 'Name the product.')
  if (!isWebUrl(fields.sponsorUrl.trim())) add('sponsorUrl', 'The website must be a full address, such as https://example.com.')
  const pitch = fields.sponsorPitch.trim()
  if (pitch.length < SPONSOR_PITCH_MIN)
    add('sponsorPitch', `Say what the product does in a sentence of at least ${SPONSOR_PITCH_MIN} characters.`)
  if (pitch.length > SPONSOR_PITCH_MAX) add('sponsorPitch', `Keep what the product does to ${SPONSOR_PITCH_MAX} characters.`)
  return problems
}

/** The problems with the product's profile, read as it would be stored: a list past its count, an entry past its length, the sponsor among its own competitors. */
export function sponsorProfileProblems(typed: SponsorProfile, sponsorName: string): SponsorProblem[] {
  const problems: SponsorProblem[] = []
  const profile = tidySponsorProfile(typed)
  for (const field of SPONSOR_PROFILE_FIELDS) {
    const { count, length } = SPONSOR_PROFILE_LIMITS[field]
    const { one, many } = PROFILE_WORDS[field]
    if (profile[field].length > count) problems.push({ field, message: `Keep to ${count} ${many}.` })
    if (profile[field].some((entry) => entry.length > length))
      problems.push({ field, message: `Keep each ${one} to ${length} characters.` })
  }
  if (namedAmong(sponsorName, profile.competitors))
    problems.push({ field: 'competitors', message: `A competitor is another product: take ${sponsorName.trim()} out.` })
  return problems
}

/** What each list of the profile holds, as a problem names it. */
const PROFILE_WORDS: Record<keyof SponsorProfile, { one: string; many: string }> = {
  competitors: { one: 'competitor', many: 'competitors' },
  searchTerms: { one: 'search term', many: 'search terms' },
}

/** Whether the name is one of the entries, in any case. */
function namedAmong(name: string, entries: string[]): boolean {
  const wanted = name.trim().toLowerCase()
  return wanted !== '' && entries.some((entry) => entry.toLowerCase() === wanted)
}

/** A list as typed or proposed: each entry trimmed, empty ones dropped, one said twice in any case kept once. */
function tidyList(entries: string[]): string[] {
  const seen = new Set<string>()
  return entries.flatMap((raw) => {
    const entry = raw.trim().replace(/\s+/g, ' ')
    const key = entry.toLowerCase()
    if (entry === '' || seen.has(key)) return []
    seen.add(key)
    return [entry]
  })
}

/** The profile as a form holds it: each list comma separated. */
export type SponsorProfileText = Record<keyof SponsorProfile, string>

/** What the operator typed, as the profile it means. */
export function sponsorProfileOfText(text: SponsorProfileText): SponsorProfile {
  return tidySponsorProfile({
    competitors: text.competitors.split(','),
    searchTerms: text.searchTerms.split(','),
  })
}

/** A profile as the form shows it. */
export function sponsorProfileText(profile: SponsorProfile): SponsorProfileText {
  return {
    competitors: profile.competitors.join(', '),
    searchTerms: profile.searchTerms.join(', '),
  }
}

/** The profile as it is stored: every list tidied, nothing else changed. */
export function tidySponsorProfile(profile: SponsorProfile): SponsorProfile {
  return {
    competitors: tidyList(profile.competitors),
    searchTerms: tidyList(profile.searchTerms),
  }
}

/**
 * A proposed profile made to fit: tidied, the sponsor's own name out of its
 * competitors, an entry past its length dropped and each list cut to its
 * count. Only a proposal is cut this way, since the operator reads it before
 * it is saved; what the operator types is refused instead (`sponsorProblems`).
 */
export function fitSponsorProfile(profile: SponsorProfile, sponsorName: string): SponsorProfile {
  const tidy = tidySponsorProfile(profile)
  const fit = (field: keyof SponsorProfile, entries: string[]) =>
    entries.filter((entry) => entry.length <= SPONSOR_PROFILE_LIMITS[field].length).slice(0, SPONSOR_PROFILE_LIMITS[field].count)
  return {
    competitors: fit(
      'competitors',
      tidy.competitors.filter((entry) => !namedAmong(sponsorName, [entry]))
    ),
    searchTerms: fit('searchTerms', tidy.searchTerms),
  }
}

/**
 * What a search asks for from the profile, beside an account's pillars: the
 * search terms, then the competitors by name, one said in both kept once.
 */
export function profileSearchTerms(profile: SponsorProfile): string[] {
  return tidyList([...profile.searchTerms, ...profile.competitors])
}

/** Whether the text is an http or https address, the only kind a tracked link may redirect to. */
export function isWebUrl(value: string): boolean {
  if (!URL.canParse(value)) return false
  const protocol = new URL(value).protocol
  return protocol === 'http:' || protocol === 'https:'
}

/** An address typed without its scheme ("ledgerly.com") as the https address it means; anything else as typed. */
export function withScheme(value: string): string {
  const trimmed = value.trim()
  if (trimmed === '' || /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed
  return `https://${trimmed}`
}
