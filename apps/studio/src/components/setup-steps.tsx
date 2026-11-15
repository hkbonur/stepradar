import { cn } from '@/lib/cn'

/** The first run's steps (DESIGN.md, Setup): the product and the Anthropic key on /setup, then the accounts on /onboarding. */
export type SetupStep = 'product' | 'key' | 'accounts'

const STEPS: { step: SetupStep; label: string }[] = [
  { step: 'product', label: 'Your product' },
  { step: 'key', label: 'Your Anthropic key' },
  { step: 'accounts', label: 'Your accounts' },
]

/** Where the first run stands, the current step in ink and marked as the step for screen readers. */
export function SetupSteps(props: { current: SetupStep }) {
  return (
    <ol className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-ash">
      {STEPS.map((entry, index) => (
        <li
          key={entry.step}
          aria-current={entry.step === props.current ? 'step' : undefined}
          className={cn({ 'font-medium text-ink': entry.step === props.current })}
        >
          <span className="tabular">{index + 1}.</span> {entry.label}
        </li>
      ))}
    </ol>
  )
}
