import {
  CADENCE_POSTS_MAX,
  CADENCE_POSTS_MIN,
  POST_INTENTS,
  POST_INTENT_LABELS,
  PLATFORM_POST_KINDS,
  POST_KIND_LABELS,
  REPLIES_PER_DAY_MAX,
  REPLIES_PER_DAY_MIN,
  postSlotHours,
  type PlatformFormat,
  type XCadence,
  PLATFORM_KIND_LABELS,
} from '@influstep/shared'
import { cn } from '@/lib/cn'
import { formatHour } from '@/lib/format'
import { Field, Input } from './ui'

/** How the account takes part on its platform: the hour of the first post, then the cadence fields below. */
export function FormatFields(props: { value: PlatformFormat; onChange: (next: PlatformFormat) => void; className?: string }) {
  const format = props.value
  return (
    <fieldset className={cn('grid grid-cols-2 gap-3 border-y border-mist py-2.5 lg:grid-cols-4', props.className)}>
      <legend className="text-xs font-medium text-graphite">{PLATFORM_KIND_LABELS[format.platform]}</legend>
      <Field label="First post at" hint="Local hour, 0 to 23">
        <NumberInput value={format.publishHour} min={0} max={23} onChange={(publishHour) => props.onChange({ ...format, publishHour })} />
      </Field>
      <CadenceFields format={format} onChange={(cadence) => props.onChange({ ...format, cadence })} />
    </fieldset>
  )
}

/**
 * The account's post cadence: how many posts a day, three hours apart from the first
 * post's hour, which kinds and intents the planner rotates through, and how
 * many replies the account drafts a day (zero turns listening off). Kinds keep
 * POST_KINDS order and intents POST_INTENTS order, and the last ticked one of
 * each cannot be cleared, because the backend refuses a format without one.
 */
function CadenceFields(props: { format: PlatformFormat; onChange: (cadence: XCadence) => void }) {
  const cadence = props.format.cadence
  // The field reports every number the operator types, out of range ones too; the hours only mean something inside the range.
  const postsPerDay = cadence.postsPerDay
  const inRange = Number.isInteger(postsPerDay) && postsPerDay >= CADENCE_POSTS_MIN && postsPerDay <= CADENCE_POSTS_MAX
  return (
    <>
      <Field
        label="Posts a day"
        hint={inRange ? postSlotHours(props.format).map(formatHour).join(', ') : `${CADENCE_POSTS_MIN} to ${CADENCE_POSTS_MAX}`}
      >
        <NumberInput
          value={cadence.postsPerDay}
          min={CADENCE_POSTS_MIN}
          max={CADENCE_POSTS_MAX}
          onChange={(postsPerDay) => props.onChange({ ...cadence, postsPerDay })}
        />
      </Field>
      <OrderedCheckboxes
        legend="Post kinds"
        // A thread is X's: elsewhere a post is one part (shared PLATFORM_POST_KINDS).
        options={PLATFORM_POST_KINDS[props.format.platform]}
        labels={POST_KIND_LABELS}
        value={cadence.kinds}
        onChange={(kinds) => props.onChange({ ...cadence, kinds })}
        className="col-span-2 sm:col-span-1 lg:col-span-3"
      />
      <Field label="Replies a day" hint={cadence.repliesPerDay === 0 ? 'Off: listens to nobody' : 'Drafts for you to post'}>
        <NumberInput
          value={cadence.repliesPerDay}
          min={REPLIES_PER_DAY_MIN}
          max={REPLIES_PER_DAY_MAX}
          onChange={(repliesPerDay) => props.onChange({ ...cadence, repliesPerDay })}
        />
      </Field>
      {/* Under the kinds on wide screens: both lists say what the planner rotates through. */}
      <OrderedCheckboxes
        legend="Post intents"
        options={POST_INTENTS}
        labels={POST_INTENT_LABELS}
        value={cadence.intents}
        onChange={(intents) => props.onChange({ ...cadence, intents })}
        className="col-span-2 lg:col-span-3"
      />
    </>
  )
}

/**
 * A set picked from a fixed list, kept in the list's order whatever is
 * ticked first. The last ticked option cannot be cleared, because the
 * backend refuses a cadence without a kind or an intent.
 */
function OrderedCheckboxes<T extends string>(props: {
  legend: string
  options: readonly T[]
  labels: Record<T, string>
  value: readonly T[]
  onChange: (next: T[]) => void
  className: string
}) {
  const toggle = (option: T, on: boolean) =>
    props.onChange(props.options.filter((candidate) => (candidate === option ? on : props.value.includes(candidate))))
  return (
    <fieldset className={cn('flex flex-col gap-1.5', props.className)}>
      <legend className="mb-1.5 text-xs font-medium text-graphite">{props.legend}</legend>
      <div className="flex min-h-8 flex-wrap items-center gap-x-4 gap-y-1">
        {props.options.map((option) => {
          const on = props.value.includes(option)
          return (
            <label key={option} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-3.5 accent-ink"
                checked={on}
                disabled={on && props.value.length === 1}
                onChange={(event) => toggle(option, event.target.checked)}
              />
              {props.labels[option]}
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

/**
 * Uncontrolled on purpose: a controlled number input snaps back the moment the
 * operator clears it to type a new value. The parent hears every finite value,
 * and the browser refuses an empty or out-of-range field at submit.
 */
function NumberInput(props: { value: number; min: number; max: number; onChange: (value: number) => void }) {
  return (
    <Input
      type="number"
      required
      min={props.min}
      max={props.max}
      step={1}
      defaultValue={props.value}
      onChange={(event) => {
        const next = event.target.valueAsNumber
        if (Number.isNaN(next)) return
        props.onChange(next)
      }}
    />
  )
}
