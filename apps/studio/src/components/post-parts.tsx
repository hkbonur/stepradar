import { cn } from '@/lib/cn'

/**
 * A post's text exactly as X shows it: one part as it is, a thread's parts
 * numbered. Used for the account's imported posts.
 */
export function PostParts(props: { parts: string[]; className?: string }) {
  return (
    <ol className={cn('grid gap-1', props.className)}>
      {props.parts.map((part, index) => (
        // Copied from the post and never reordered, so the position is the part's identity.
        <li key={index} className="flex items-baseline gap-2">
          {props.parts.length > 1 && <span className="tabular w-4 shrink-0 font-mono text-[11px] text-ash">{index + 1}</span>}
          <p className="min-w-0 whitespace-pre-line">{part}</p>
        </li>
      ))}
    </ol>
  )
}
