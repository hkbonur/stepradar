import { api } from '@influstep/convex/_generated/api'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useQuery } from 'convex/react'
import { AccountLabel } from '@/components/account-mark'
import { Card, CardList, Collapsible, Empty, Mono, PageHeader, Skeleton } from '@/components/ui'
import { formatDateTime } from '@/lib/format'
import { handleOf } from '@influstep/shared'
import { ChecklistAction, ChecklistCheckbox } from '@/components/checklist-item'

export const Route = createFileRoute('/checklist')({ component: ChecklistPage })

type Item = NonNullable<ReturnType<typeof useQuery<typeof api.private.checklist.list>>>[number]

/**
 * What only the operator can do (DESIGN.md, Checklist page): the open items
 * as one card per account, so each item sits with the account it is for, and
 * what was done folded under them.
 */
function ChecklistPage() {
  const items = useQuery(api.private.checklist.list, {})
  const open = items?.filter((item) => item.status === 'open') ?? []
  const done = items?.filter((item) => item.status === 'done') ?? []
  // One group per account, in the order its first open item came.
  const groups = [...new Set(open.map((item) => item.accountId))].map((accountId) => open.filter((item) => item.accountId === accountId))
  return (
    <>
      <PageHeader title="Checklist" lead="What only you can do: connections, keys, steps on a platform, links to paste." />
      {!items && <Skeleton className="h-40 rounded-xl" />}
      {items && open.length === 0 && (
        <Empty>Nothing waits on you. The agents add an item here when they need a key or a step only you can take.</Empty>
      )}
      <div className="space-y-4">
        {groups.map((group) => {
          const [first] = group
          if (!first) throw new Error('a checklist group without an item')
          return (
            <Card
              key={first.accountId}
              title={
                <Link to="/accounts/$accountId" params={{ accountId: first.accountId }} className="hover:underline">
                  <AccountLabel platform={first.account.platform} name={first.account.name} className="font-semibold text-ink" />
                </Link>
              }
              count={group.length}
              flush
            >
              <CardList>
                {group.map((item) => (
                  <ChecklistRow key={item._id} item={item} />
                ))}
              </CardList>
            </Card>
          )
        })}
        {done.length > 0 && (
          <Card flush>
            <Collapsible summary="Done" count={done.length} inset>
              <CardList className="text-sm text-ash">
                {done.map((item) => (
                  <li key={item._id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="line-through">{item.title}</span>
                    <Mono className="text-xs">{handleOf(item.account)}</Mono>
                    <span className="ml-auto text-xs">{item.doneAt ? formatDateTime(item.doneAt) : ''}</span>
                  </li>
                ))}
              </CardList>
            </Collapsible>
          </Card>
        )}
      </div>
    </>
  )
}

function ChecklistRow(props: { item: Item }) {
  const { item } = props
  return (
    <li className="flex items-start gap-3">
      <ChecklistCheckbox item={item} className="mt-1 size-4" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{item.title}</p>
        <p className="mt-0.5 max-w-[75ch] text-sm text-graphite">{item.why}</p>
        <p className="mt-1 font-mono text-[11px] text-ash">{formatDateTime(item.createdAt)}</p>
      </div>
      <ChecklistAction item={item} />
    </li>
  )
}
