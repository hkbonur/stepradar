import { platformOfHeardAbout, platformOfReferrer, type Platform, type ProbableBasis } from '@influstep/shared'
import { z } from 'zod'
import { requireEnv } from '../../lib/env'
import type { AnalyticsProvider, FoundConversion, FoundProbable } from './types'

/** The product's PostHog events that count as conversions (ADR 0003, docs/plan.md "What the product must emit"). */
const EVENT_TO_KIND = {
  demo_started: 'demo_started',
  signed_up: 'signup',
  trial_started: 'trial_started',
  subscription_started: 'paid',
} as const
type ConversionEvent = keyof typeof EVENT_TO_KIND
const EVENT_LIST = Object.keys(EVENT_TO_KIND)
  .map((event) => `'${event}'`)
  .join(', ')

/** How long before the window an answer to "where did you hear about us" still explains a conversion in it. */
const HEARD_LOOKBACK_MS = 30 * 24 * 3_600_000

const resultSchema = z.object({ results: z.array(z.array(z.unknown())) })

/**
 * PostHog query API with HogQL over the person's initial UTM properties, so
 * a signup credits the first account link the person ever clicked, by the
 * account's handle and place together (shared `utmMediumOf`); a person with
 * none is a probable conversion when they said where they heard
 * of the sponsor, or first arrived from a platform's domain.
 */
export const posthogAnalytics: AnalyticsProvider = {
  name: 'posthog',
  async conversions(args): Promise<FoundConversion[]> {
    const rows = await hogql(
      `
      select event, distinct_id, timestamp, person.properties.$initial_utm_campaign, person.properties.$initial_utm_content
      from events
      where event in (${EVENT_LIST})
        and person.properties.$initial_utm_source = {handle}
        and person.properties.$initial_utm_medium = {medium}
        and timestamp > {since}
      order by timestamp asc`,
      { handle: args.accountHandle, medium: args.medium, since: new Date(args.since).toISOString() }
    )
    const out: FoundConversion[] = []
    for (const [event, distinctId, timestamp, campaign, content] of rows) {
      if (!isConversionEvent(event)) continue
      out.push({
        kind: EVENT_TO_KIND[event],
        distinctId: String(distinctId),
        at: new Date(String(timestamp)).getTime(),
        utm: { source: args.accountHandle, medium: args.medium, campaign: asString(campaign), content: asString(content) },
      })
    }
    return out
  },
  async probableConversions(args): Promise<FoundProbable[]> {
    // What each person last said about where they heard of the sponsor, from the product's `heard_about_us` event.
    const heard = new Map<string, string>()
    const answers = await hogql(
      `
      select person_id, properties.answer
      from events
      where event = 'heard_about_us' and timestamp > {since}
      order by timestamp asc`,
      { since: new Date(args.since - HEARD_LOOKBACK_MS).toISOString() }
    )
    for (const [personId, answer] of answers) {
      const text = asString(answer)
      if (text !== undefined) heard.set(String(personId), text)
    }
    const rows = await hogql(
      `
      select event, distinct_id, timestamp, person_id, person.properties.$initial_referring_domain
      from events
      where event in (${EVENT_LIST})
        and coalesce(person.properties.$initial_utm_source, '') = ''
        and timestamp > {since}
      order by timestamp asc`,
      { since: new Date(args.since).toISOString() }
    )
    const out: FoundProbable[] = []
    for (const [event, distinctId, timestamp, personId, referrer] of rows) {
      if (!isConversionEvent(event)) continue
      const found = probablePlatform(heard.get(String(personId)), asString(referrer), args.forumHosts)
      if (found === null) continue
      out.push({ ...found, kind: EVENT_TO_KIND[event], distinctId: String(distinctId), at: new Date(String(timestamp)).getTime() })
    }
    return out
  },
}

/**
 * The platform a conversion with no UTM parameters is probably from: the one
 * the person named, else the one they first came from; what they said wins,
 * since a visitor who arrived from a search may have heard of it on Reddit.
 */
function probablePlatform(
  answer: string | undefined,
  referrer: string | undefined,
  forumHosts: readonly string[]
): { platform: Platform; basis: ProbableBasis } | null {
  const said = answer === undefined ? null : platformOfHeardAbout(answer)
  if (said !== null) return { platform: said, basis: 'heard_about_us' }
  const came = referrer === undefined ? null : platformOfReferrer(referrer, forumHosts)
  if (came !== null) return { platform: came, basis: 'referrer' }
  return null
}

/** The rows one HogQL page holds, and the most pages a query reads before it fails instead of reading part of the window. */
const PAGE_ROWS = 1000
const MAX_PAGES = 50

/**
 * One HogQL query against the product's PostHog project, ordered and without
 * a limit: every row it matches, a page at a time, as PostHog returns them.
 */
async function hogql(query: string, values: Record<string, string>): Promise<unknown[][]> {
  const host = requireEnv('POSTHOG_HOST')
  const projectId = requireEnv('POSTHOG_PROJECT_ID')
  const apiKey = requireEnv('POSTHOG_API_KEY')
  const rows: unknown[][] = []
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const paged = `${query}\n      limit ${PAGE_ROWS} offset ${page * PAGE_ROWS}`
    const response = await fetch(`${host}/api/projects/${projectId}/query/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: { kind: 'HogQLQuery', query: paged, values } }),
    })
    if (!response.ok) throw new Error(`PostHog query failed: ${response.status} ${await response.text()}`)
    const results = resultSchema.parse(await response.json()).results
    rows.push(...results)
    if (results.length < PAGE_ROWS) return rows
  }
  throw new Error(`PostHog matched more than ${PAGE_ROWS * MAX_PAGES} rows for one query; the window is too long to read whole.`)
}

function isConversionEvent(event: unknown): event is ConversionEvent {
  return typeof event === 'string' && event in EVENT_TO_KIND
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}
