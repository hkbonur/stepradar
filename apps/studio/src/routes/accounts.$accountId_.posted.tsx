import { api } from '@influstep/convex/_generated/api'
import type { Id } from '@influstep/convex/_generated/dataModel'
import { COMMENT_STATUS_LABELS, communityLabel, postedAnchor, placeLabel, type PlatformPlace } from '@influstep/shared'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useQuery } from 'convex/react'
import React from 'react'
import type { FunctionReturnType } from 'convex/server'
import { ItemNumbers, notReadText } from '@/components/item-numbers'
import { AccountFrame } from '@/components/account-frame'
import { Card, Empty, Mono, Skeleton } from '@/components/ui'
import { formatPercent, plural, relativeTime } from '@/lib/format'

// `$accountId_`: outside the account page's route, like the replies page, since the account page renders no outlet.
export const Route = createFileRoute('/accounts/$accountId_/posted')({ component: PostedPage })

type PostedData = NonNullable<FunctionReturnType<typeof api.private.posted.forAccount>>
type Row = PostedData['items'][number]

/**
 * What the account posted this week (docs/plan.md, "Studio screens"), in the
 * account's frame: each post and reply that went out, newest first, as a card
 * with its numbers, how much of the draft the operator changed, and the
 * comments under it. A comment notification opens the page at the item the
 * comment is under.
 */
function PostedPage() {
  const params = Route.useParams()
  const accountId = params.accountId as Id<'accounts'>
  const data = useQuery(api.private.posted.forAccount, { accountId })
  const loaded = data !== undefined && data !== null
  React.useEffect(() => {
    // The anchor's item renders only once the query answers, so the browser's own jump on load finds nothing.
    if (!loaded || window.location.hash === '') return
    document.getElementById(decodeURIComponent(window.location.hash.slice(1)))?.scrollIntoView()
  }, [loaded])
  return (
    <AccountFrame accountId={accountId} tab="posted">
      {data === undefined && <Skeleton className="h-96 rounded-xl" />}
      {data !== undefined && data !== null && (
        <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0 space-y-3">
            {data.items.length === 0 && <Empty>Nothing went out in the last {data.days} days.</Empty>}
            {data.items.map((row) => (
              <PostedCard key={row.item._id} row={row} place={data.account} readsCounts={data.readsCounts} />
            ))}
          </div>
          <aside aria-label="What went out" className="space-y-4">
            <WindowCard data={data} />
          </aside>
        </div>
      )}
    </AccountFrame>
  )
}

/** The window at a glance: how many posts, replies and items without a draft went out, and the comments under them. */
function WindowCard(props: { data: PostedData }) {
  const items = props.data.items
  const count = (kind: Row['item']['kind']) => items.filter((row) => row.item.kind === kind).length
  const comments = items.reduce((sum, row) => sum + row.comments.length, 0)
  const rows: [string, number][] = [
    ['Posts', count('post')],
    ['Replies', count('reply')],
    ['Posted without a draft', count('item')],
    ['Comments under them', comments],
  ]
  return (
    <Card
      title={`Last ${props.data.days} days`}
      description={`What went out on ${placeLabel(props.data.account)}, newest first, and what came back.`}
    >
      <dl className="space-y-1.5 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-3">
            <dt className="text-ash">{label}</dt>
            <dd className="tabular font-medium">{value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  )
}

/**
 * One item that went out, as a card: what it is and where, what it says, its
 * numbers and edit share, then the comments under it, oldest first, on the
 * card's band, so every comment sits with what it answers.
 */
function PostedCard(props: { row: Row; place: PlatformPlace; readsCounts: boolean }) {
  const { item, comments } = props.row
  return (
    <article id={item.externalId === null ? undefined : postedAnchor(item.externalId)} className="surface scroll-mt-6">
      <div className="card-pad">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ash">
          <span className="rounded-md bg-hairline-strong px-1.5 py-0.5 font-medium text-graphite">{ITEM_KIND_LABELS[item.kind]}</span>
          {item.community !== null && <span>in {communityLabel(props.place.platform, item.community)}</span>}
          {item.url === null ? (
            <span>posted {relativeTime(item.postedAt)}, no link</span>
          ) : (
            <a href={item.url} target="_blank" rel="noreferrer" className="underline decoration-fog hover:text-ink hover:decoration-ink">
              posted {relativeTime(item.postedAt)}
            </a>
          )}
        </p>
        <PostedText item={item} />
        <p className="mt-2 flex flex-wrap gap-x-3 text-[11px] text-ash">
          {/* What the operator posted without a draft is not measured, so it says nothing of numbers. */}
          {item.kind !== 'item' && <ItemNumbers numbers={item.numbers} missing={notReadText(props.place, props.readsCounts)} />}
          {item.editShare !== null && <span>{formatPercent(item.editShare, 0)} of the draft changed</span>}
        </p>
      </div>
      {comments.length > 0 && (
        <div className="card-band">
          <p className="mb-2 text-xs font-medium text-graphite">
            {comments.length} {plural(comments.length, 'comment', 'comments')}
          </p>
          <ul className="space-y-3">
            {comments.map((comment) => (
              <li key={comment._id} className="text-sm">
                <p className="text-xs text-ash">
                  <Mono className="text-graphite">{comment.author.handle}</Mono> · {relativeTime(comment.postedAt)} ·{' '}
                  {COMMENT_STATUS_LABELS[comment.status]}
                </p>
                <p className="mt-0.5">{comment.text}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  )
}

/** What each kind of item that went out is called on the page. */
const ITEM_KIND_LABELS: Record<Row['item']['kind'], string> = { post: 'Post', reply: 'Reply', item: 'Posted without a draft' }

/** A post by its title, linked to its page; a reply by its words and what it answers; an item without a draft by its words. */
function PostedText(props: { item: Row['item'] }) {
  const item = props.item
  if (item.kind === 'post') {
    return (
      <Link to="/posts/$postId" params={{ postId: item._id }} className="mt-2 block font-medium hover:underline">
        {item.title}
      </Link>
    )
  }
  if (item.kind === 'item') return <p className="mt-2 line-clamp-3 text-sm">{item.text}</p>
  return (
    <>
      <p className="mt-2 text-sm">{item.text}</p>
      <p className="mt-0.5 line-clamp-1 text-xs text-ash">to {item.answers}</p>
    </>
  )
}
