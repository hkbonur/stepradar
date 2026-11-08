import { parsePostedLink, type PlatformPlace } from '@influstep/shared'
import React from 'react'
import { cn } from '@/lib/cn'
import { Input } from './ui'

/**
 * The link to what the operator posted, checked as it is typed (shared
 * `parsePostedLink`): a link that names nothing of the operator's on the
 * account's platform, or on its forum, marks the field invalid
 * and says so under it, in a polite live region that stays mounted. The post
 * page shows the label; a reply's compact row only names the field.
 */
export function PostedLinkField(props: {
  place: PlatformPlace
  label: string
  showLabel: boolean
  hint?: string
  value: string
  onChange: (value: string) => void
  placeholder: string
  /** Small, to sit in a row of small buttons. */
  compact?: boolean
  className?: string
}) {
  const id = React.useId()
  const link = parsePostedLink(props.place, props.value)
  const problem = link.kind === 'invalid' ? link.problem : null
  const described = props.hint === undefined ? `${id}-problem` : `${id}-hint ${id}-problem`
  return (
    <div className={cn('flex flex-col gap-1.5', props.className)}>
      <label htmlFor={id} className={props.showLabel ? 'text-xs font-medium text-graphite' : 'sr-only'}>
        {props.label}
      </label>
      <Input
        id={id}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        placeholder={props.placeholder}
        aria-invalid={problem !== null}
        aria-describedby={described}
        className={cn({ 'h-7 text-xs': props.compact })}
      />
      {props.hint !== undefined && (
        <span id={`${id}-hint`} className="text-xs text-ash">
          {props.hint}
        </span>
      )}
      <span id={`${id}-problem`} aria-live="polite" className="text-xs text-signal-red-deep">
        {problem}
      </span>
    </div>
  )
}
