/** The goal metric ladder (CONTEXT.md, "Goal metric"): closest to paying customers first, then the platform's reach. */
export const METRIC_KEYS = ['paid', 'signups', 'clicks', 'reach'] as const
export type MetricKey = (typeof METRIC_KEYS)[number]

export const METRIC_LABELS: Record<MetricKey, string> = {
  paid: 'Paid',
  signups: 'Signups',
  clicks: 'Clicks',
  reach: 'Reach',
}

/**
 * The measurement window (CONTEXT.md): how long after a post or a reply went
 * out the analyst reads its numbers before it is measured. An item's reach is
 * spent within the week.
 */
export const MEASUREMENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

/**
 * The journey a reader can take in the product after a post, in order. Each
 * one is one PostHog event on the product's side (docs/plan.md, "What the
 * product must emit").
 */
export const CONVERSION_KINDS = ['demo_started', 'signup', 'trial_started', 'paid'] as const
export type ConversionKind = (typeof CONVERSION_KINDS)[number]

export const CONVERSION_KIND_LABELS: Record<ConversionKind, string> = {
  demo_started: 'Demos',
  signup: 'Signups',
  trial_started: 'Trials',
  paid: 'Paid',
}

/** The one name of the money metric: on the report strip, in its table and on the post page. */
export const VALUE_LABEL = 'Value'
