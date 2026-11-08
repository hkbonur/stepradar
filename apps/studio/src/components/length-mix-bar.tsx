import { POST_LENGTHS, POST_LENGTH_LABELS, type LengthMix, type PostLength } from '@influstep/shared'
import { cn } from '@/lib/cn'
import { formatPercent } from '@/lib/format'

/**
 * Literal classes, so Tailwind sees them. Lightest for a one-liner, darkest for
 * a thread: more words, more ink. Neutrals on purpose: the chart series are
 * spoken for by the report, and the bar is chrome, not identity.
 */
const TONE: Record<PostLength, string> = { short: 'bg-smoke', medium: 'bg-ash', long: 'bg-ink' }

/**
 * How a feed splits into one-liners, posts and threads (DESIGN.md, Length mix
 * bar): one stacked bar, then a legend that carries the numbers. The bar is
 * hidden from screen readers, since the legend says the same in words.
 */
export function LengthMixBar(props: { mix: LengthMix; className?: string }) {
  return (
    <div className={cn('space-y-2', props.className)}>
      <div aria-hidden className="flex h-2 gap-0.5 overflow-hidden rounded-full">
        {POST_LENGTHS.filter((length) => props.mix[length] > 0).map((length) => (
          // Grown by its share from a zero basis, so the gaps between segments come out of the shares, not past the end.
          <span key={length} className={cn('basis-0', TONE[length])} style={{ flexGrow: props.mix[length] }} />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-graphite">
        {POST_LENGTHS.map((length) => (
          <li key={length} className="flex items-center gap-1.5">
            <span aria-hidden className={cn('size-2 rounded-[2px]', TONE[length])} />
            {POST_LENGTH_LABELS[length]}
            <span className="tabular font-mono text-[11px] text-ash">{formatPercent(props.mix[length], 0)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
