import { cn } from '@/lib/cn'
import { counterTone } from '@/lib/counter'

/**
 * `len / limit` in 11px mono: ash under 90 percent, amber up to the limit, red
 * past it (DESIGN.md, Character counter). The field it counts points to it,
 * and it is a polite live region that says near or over the limit in words,
 * since a screen reader does not get the color. Used by the post editor and
 * the reply drafts, so every limit the operator writes against reads the
 * same.
 */
export function CharacterCounter(props: { id: string; length: number; limit: number }) {
  const tone = counterTone(props.length, props.limit)
  return (
    <span
      id={props.id}
      aria-live="polite"
      aria-atomic="true"
      className={cn('tabular font-mono text-[11px]', {
        'text-ash': tone === 'quiet',
        'text-alert-amber-deep': tone === 'near',
        'text-signal-red-deep': tone === 'over',
      })}
    >
      {props.length} / {props.limit}
      <span className="sr-only">
        {' characters'}
        {tone === 'near' && ', near the limit'}
        {tone === 'over' && ', over the limit'}
      </span>
    </span>
  )
}
