import type { Infer } from 'convex/values'
import type { foundConversionValidator, foundProbableValidator } from '../../lib/validators'

export type FoundConversion = Infer<typeof foundConversionValidator>
export type FoundProbable = Infer<typeof foundProbableValidator>

/**
 * One of the account's sponsored posts as the mock reads it (ADR 0002: the
 * mock is deterministic from its inputs): its slug and variant, when it went
 * out, and the visits it brought the sponsor, its counted clicks or, where a
 * post links to the sponsor directly and no click is counted, its reach.
 */
export interface MockPostVisits {
  slug: string
  variantKey?: string
  postedAt: number
  visits: number
}

export interface AnalyticsProvider {
  readonly name: string
  /**
   * Conversions attributed to the account since `since`: the ones whose
   * first link named its handle as the source and its place as the medium
   * (ADR 0003, shared `utmMediumOf`). The mock spreads them over
   * `mockVisits`; a real provider reads the product's own and ignores them.
   */
  conversions(args: {
    accountHandle: string
    medium: string
    since: number
    mockVisits: readonly MockPostVisits[]
  }): Promise<FoundConversion[]>
  /**
   * Conversions with no UTM parameters since `since` that are probably a
   * platform's, each with the platform (shared probable.ts); a forum's by
   * the hosts of the workspace's forums.
   */
  probableConversions(args: { since: number; forumHosts: readonly string[] }): Promise<FoundProbable[]>
}
