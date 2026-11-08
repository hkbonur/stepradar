/**
 * The product a workspace's accounts promote (CONTEXT.md, Sponsor): its name,
 * where it lives, what it does in one sentence, and what one paying customer
 * is worth. The studio's first-run setup and its settings check the fields
 * with these words before they are sent, and the backend refuses with the
 * same ones.
 */

/** The longest pitch: one sentence the writer says in its own words, never a paragraph it reads out. */
export const SPONSOR_PITCH_MAX = 200

/** The shortest pitch that still says what the product does. */
export const SPONSOR_PITCH_MIN = 20

export interface SponsorFields {
  sponsorName: string
  sponsorUrl: string
  sponsorPitch: string
  valuePerPaid: number
  currency: string
}

const CURRENCY_PATTERN = /^[A-Z]{3}$/

/** One problem with the fields, naming the field it is about, so a form marks that field and shows only its own step's. */
export interface SponsorProblem {
  field: keyof SponsorFields
  message: string
}

/** Every problem with the fields, in form order; none when the backend takes them. */
export function sponsorProblems(fields: SponsorFields): SponsorProblem[] {
  const problems: SponsorProblem[] = []
  const add = (field: keyof SponsorFields, message: string) => problems.push({ field, message })
  if (fields.sponsorName.trim() === '') add('sponsorName', 'Name the product.')
  if (!isWebUrl(fields.sponsorUrl.trim())) add('sponsorUrl', 'The website must be a full address, such as https://example.com.')
  const pitch = fields.sponsorPitch.trim()
  if (pitch.length < SPONSOR_PITCH_MIN)
    add('sponsorPitch', `Say what the product does in a sentence of at least ${SPONSOR_PITCH_MIN} characters.`)
  if (pitch.length > SPONSOR_PITCH_MAX) add('sponsorPitch', `Keep what the product does to ${SPONSOR_PITCH_MAX} characters.`)
  if (!(Number.isFinite(fields.valuePerPaid) && fields.valuePerPaid >= 0)) add('valuePerPaid', 'A paying customer is worth 0 or more.')
  if (!CURRENCY_PATTERN.test(fields.currency)) add('currency', 'The currency is three capital letters, such as USD or EUR.')
  return problems
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
