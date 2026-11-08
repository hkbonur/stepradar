import { providersMode } from '../../lib/env'
import { mockAnalytics } from './mock'
import { posthogAnalytics } from './posthog'
import type { AnalyticsProvider } from './types'

export function analyticsProvider(): AnalyticsProvider {
  return providersMode() === 'real' ? posthogAnalytics : mockAnalytics
}
export type { FoundConversion, FoundProbable, MockPostVisits } from './types'
