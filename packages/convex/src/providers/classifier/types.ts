import type { HeardFit, Platform, ReplyOrigin, SelfPromotion } from '@influstep/shared'

/** One account's heard posts, with what the classifier reads them against: the niche, the pillars and the sponsor. */
export interface ClassifyBrief {
  platform: Platform
  /** Where the account takes part: the platform's name, or a forum's (shared `placeLabel`). */
  placeName: string
  niche: string
  audience: string | undefined
  pillars: string[]
  sponsorName: string
  sponsorPitch: string
  posts: { origin: ReplyOrigin; text: string }[]
}

/**
 * Sorts what the listener heard (docs/plan.md, slice 3): a fit per post, in
 * the posts' order. Fast and cheap, since it reads every heard post.
 */
export interface ClassifierProvider {
  readonly name: string
  classify(brief: ClassifyBrief): Promise<HeardFit[]>
  /** Whether a community's rules let an account name its own product, and why (docs/plan.md, ground rule 3). */
  communityRules(args: {
    platform: Platform
    placeName: string
    community: string
    rules: string
  }): Promise<{ selfPromotion: SelfPromotion; reason: string }>
}
