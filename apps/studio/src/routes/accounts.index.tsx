import { api } from '@influstep/convex/_generated/api'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useQuery } from 'convex/react'
import { AccountMark, accountState } from '@/components/account-mark'
import { Card, Empty, LinkButton, Mono, PageHeader, Pill, Skeleton } from '@/components/ui'
import { AGENTS_IN_WORDS } from '@/lib/agents'
import { cn } from '@/lib/cn'
import { handleOf } from '@influstep/shared'
import { platformsInWords } from '@/lib/platforms'

export const Route = createFileRoute('/accounts/')({ component: AccountsPage })

function AccountsPage() {
  const accounts = useQuery(api.private.accounts.list, {})
  return (
    <>
      <PageHeader
        title="Accounts"
        lead={`Each account is one of your own, on ${platformsInWords('disjunction')}. ${AGENTS_IN_WORDS} work for it.`}
        actions={
          <LinkButton to="/onboarding" search={{ count: 1 }} variant="primary">
            New account
          </LinkButton>
        }
      />
      {!accounts && <Skeleton className="h-40 rounded-xl" />}
      {accounts && accounts.length === 0 && (
        <Empty action={<LinkButton to="/onboarding">Build your roster</LinkButton>}>No accounts yet.</Empty>
      )}
      {accounts && accounts.length > 0 && (
        <Card flush>
          <ul className="divide-y divide-mist">
            {accounts.map((account) => (
              <li key={account._id} className="card-x grid items-center gap-x-6 gap-y-3 py-4 sm:grid-cols-[1fr_auto_auto]">
                <div className="flex min-w-0 items-start gap-3">
                  <AccountMark platform={account.platform} size={32} state={accountState(account)} />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link to="/accounts/$accountId" params={{ accountId: account._id }} className="text-base font-medium hover:underline">
                        {account.name}
                      </Link>
                      {/* The mark's dot is hidden from screen readers; this says it in words. */}
                      {accountState(account) === 'working' && <span className="sr-only">working</span>}
                      <Mono className="text-ash">{handleOf(account)}</Mono>
                      {account.paused && <Pill tint="alert-amber">Paused</Pill>}
                    </div>
                    <p className="mt-0.5 line-clamp-1 text-ash">{account.niche}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ash">
                      <span className="tabular">{account.cadence.postsPerDay} a day</span>
                      <span className="tabular">sponsor {Math.round(account.sponsorDial * 100)}%</span>
                      <span>{account.pillars.join(' · ')}</span>
                    </div>
                  </div>
                </div>
                <dl className="flex gap-5 text-xs">
                  <Count label="Posted" value={account.counts.posted} />
                  {/* Drafts to post (core `waitingOn`). */}
                  <Count label="Waiting" value={account.counts.drafts} tone={account.counts.drafts > 0 ? 'amber' : undefined} />
                  <Count label="Failed" value={account.counts.failed} tone={account.counts.failed > 0 ? 'red' : undefined} />
                  <Count label="Checklist" value={account.counts.checklist} tone={account.counts.checklist > 0 ? 'amber' : undefined} />
                </dl>
                <LinkButton to="/reports/$accountId" params={{ accountId: account._id }} variant="ghost" size="sm">
                  Report
                </LinkButton>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  )
}

function Count(props: { label: string; value: number; tone?: 'red' | 'amber' }) {
  return (
    <div className="min-w-14">
      <dt className="text-ash">{props.label}</dt>
      <dd
        className={cn('tabular text-base font-medium', {
          // A zero is nothing to look at, so it recedes and the counts that matter stand out.
          'text-smoke': props.value === 0,
          'text-signal-red-deep': props.tone === 'red',
          'text-alert-amber-deep': props.tone === 'amber',
        })}
      >
        {props.value}
      </dd>
    </div>
  )
}
