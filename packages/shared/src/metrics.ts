/** The goal metric ladder (CONTEXT.md, "Goal metric"): clicks on the sponsor's tracked links first, then the platform's reach. */
export const METRIC_KEYS = ['clicks', 'reach'] as const
export type MetricKey = (typeof METRIC_KEYS)[number]

export const METRIC_LABELS: Record<MetricKey, string> = {
  clicks: 'Clicks',
  reach: 'Reach',
}

/**
 * The measurement window (CONTEXT.md): how long after a post or a reply went
 * out the analyst reads its numbers before it is measured. An item's reach is
 * spent within the week.
 */
export const MEASUREMENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
