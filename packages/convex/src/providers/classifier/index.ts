import { placeLabel, placeOf } from '@influstep/shared'
import { providersMode } from '../../lib/env'
import { anthropicClassifier } from './anthropic'
import { mockClassifier } from './mock'
import type { ClassifierProvider, ClassifyBrief } from './types'
import type { Doc } from '../../_generated/dataModel'

/**
 * Claude Haiku in real mode. Typesafe's Jev is a candidate second adapter,
 * once it matches Haiku on the operator's labelled threads (docs/plan.md,
 * slice 3).
 */
export function classifierProvider(): ClassifierProvider {
  return providersMode() === 'real' ? anthropicClassifier : mockClassifier
}

/** What the classifier reads the account's posts against: its platform, niche, audience, pillars and its workspace's sponsor. */
export function classifyBriefOf(account: Doc<'accounts'>, workspace: Doc<'workspaces'>, posts: ClassifyBrief['posts']): ClassifyBrief {
  return {
    platform: account.platform,
    placeName: placeLabel(placeOf(account)),
    niche: account.niche,
    audience: account.audience,
    pillars: account.pillars,
    sponsorName: workspace.sponsorName,
    sponsorPitch: workspace.sponsorPitch,
    posts,
  }
}
