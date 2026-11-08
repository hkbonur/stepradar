import type { api } from '@influstep/convex/_generated/api'
import { PLATFORM_LABELS, probableBasisText } from '@influstep/shared'
import type { FunctionReturnType } from 'convex/server'
import { formatCount, formatMoney, plural } from '@/lib/format'

/** What the reports read of a platform's probable conversions. */
type Probable = NonNullable<FunctionReturnType<typeof api.private.report.forAccount>>['probable']

/**
 * A platform's probable conversions (CONTEXT.md, "Probable conversion"),
 * apart from the funnel and labeled so: they carry no UTM parameters, so
 * they name the platform, never an account or a post. Nothing when there
 * are none.
 */
export function ProbableLine(props: { probable: Probable; currency: string }) {
  const { probable } = props
  const counted = (count: number, one: string, many: string) => (count === 0 ? [] : [`${formatCount(count)} ${plural(count, one, many)}`])
  const counts = [
    ...counted(probable.demos, 'demo', 'demos'),
    ...counted(probable.signups, 'signup', 'signups'),
    ...counted(probable.trials, 'trial', 'trials'),
    ...(probable.paid === 0 ? [] : [`${formatCount(probable.paid)} paid (${formatMoney(probable.value, props.currency)})`]),
  ]
  if (counts.length === 0) return null
  const people = (count: number, text: string) =>
    count === 0 ? [] : [`${formatCount(count)} ${plural(count, 'person', 'people')} who ${text}`]
  const from = [
    ...people(probable.heard, probableBasisText(probable.platform, 'heard_about_us')),
    ...people(probable.referred, probableBasisText(probable.platform, 'referrer')),
  ]
  return (
    <p className="max-w-[65ch] text-sm">
      <span className="font-medium">
        Probably from {probable.platform === 'forum' ? 'your forums' : PLATFORM_LABELS[probable.platform]}:
      </span>{' '}
      {counts.join(', ')}.{' '}
      <span className="text-ash">
        From {from.join(' and ')}, with no UTM parameters, so not tied to one account or post.
        {probable.mock && ' Mock data.'}
      </span>
    </p>
  )
}
