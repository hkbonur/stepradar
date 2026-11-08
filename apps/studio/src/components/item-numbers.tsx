import { type ItemCounts, type ItemRead, placeLabel, type PlatformPlace } from '@influstep/shared'
import { formatCount, plural } from '@/lib/format'

/**
 * What a posted item's numbers say, named as its platform shows them (shared
 * `ItemCounts`): X's impressions, likes, replies, reposts, profile visits and
 * follows, the points and the comments on Reddit and Hacker News, a forum
 * post's reads, likes and replies. A number the platform does not show (a
 * Hacker News comment's score) is left out.
 */
export function numbersOf(counts: ItemCounts): { value: number; label: string }[] {
  const of = (value: number, one: string, many: string) => ({ value, label: plural(value, one, many) })
  if (counts.platform === 'x') {
    return [
      { value: counts.impressions, label: 'seen' },
      of(counts.likes, 'like', 'likes'),
      of(counts.replies, 'reply', 'replies'),
      of(counts.reposts, 'repost', 'reposts'),
      of(counts.profileVisits, 'profile visit', 'profile visits'),
      of(counts.follows, 'follow', 'follows'),
    ]
  }
  if (counts.platform === 'forum') {
    return [of(counts.reads, 'read', 'reads'), of(counts.likes, 'like', 'likes'), of(counts.replies, 'reply', 'replies')]
  }
  const numbers = []
  if (counts.score !== null) numbers.push(of(counts.score, 'point', 'points'))
  if (counts.replies !== null) numbers.push(of(counts.replies, 'comment', 'comments'))
  return numbers
}

/** Why an item has no numbers: the analyst has not read them yet, or the account's reader reads none where it takes part. */
export function notReadText(place: PlatformPlace, readsCounts: boolean): string {
  return readsCounts ? 'Not read yet' : `No numbers read on ${placeLabel(place)}`
}

/** An item's numbers at the last read in one line, each count in the figure face; `missing` says why there are none. */
export function ItemNumbers(props: { numbers: ItemRead | null | undefined; missing: string }) {
  if (!props.numbers) return <span>{props.missing}</span>
  return (
    <>
      {numbersOf(props.numbers.counts).map((number) => (
        <span key={number.label}>
          <span className="tabular font-mono text-graphite">{formatCount(number.value)}</span> {number.label}
        </span>
      ))}
    </>
  )
}
