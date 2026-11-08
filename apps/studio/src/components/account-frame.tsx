import { api } from '@influstep/convex/_generated/api'
import type { Id } from '@influstep/convex/_generated/dataModel'
import { handleOf } from '@influstep/shared'
import { useQuery } from 'convex/react'
import React from 'react'
import { AccountMark, accountState } from './account-mark'
import { Mono, Pill, Skeleton, TabNav, filled, type TabItem } from './ui'

/** An account's pages, each a tab of its frame, in the order the operator works through them. */
export type AccountTab = 'overview' | 'replies' | 'posted' | 'report' | 'strategy' | 'memory' | 'voice'

function tabsOf(accountId: Id<'accounts'>, current: AccountTab): TabItem[] {
  const params = { accountId }
  const tab = (key: AccountTab, label: string, link: TabItem['link']): TabItem => ({ key, label, current: key === current, link })
  return [
    tab('overview', 'Overview', { to: '/accounts/$accountId', params }),
    tab('replies', 'Replies', { to: '/accounts/$accountId/replies', params }),
    tab('posted', 'Posted', { to: '/accounts/$accountId/posted', params }),
    tab('report', 'Report', { to: '/reports/$accountId', params }),
    tab('strategy', 'Strategy', { to: '/accounts/$accountId/strategy', params }),
    tab('memory', 'Memory', { to: '/accounts/$accountId/memory', params }),
    tab('voice', 'Voice', { to: '/accounts/$accountId/voice', params }),
  ]
}

/**
 * Every page of one account, in one frame (DESIGN.md, Account frame): the
 * account's mark, name, handle and niche with the page's actions, a line the
 * page adds under them, then the account's pages as tabs, so the operator
 * always knows whose page this is and moves between its pages in one click.
 * It reads the roster the sidebar already holds, so it costs no request.
 */
export function AccountFrame(props: {
  accountId: Id<'accounts'>
  tab: AccountTab
  /** One line under the handle: the account's numbers, the report's window. */
  lead?: React.ReactNode
  actions?: React.ReactNode
  children: React.ReactNode
}) {
  const accounts = useQuery(api.private.accounts.list, {})
  const account = accounts?.find((candidate) => candidate._id === props.accountId)
  if (accounts === undefined) return <Skeleton className="h-96 rounded-xl" />
  if (account === undefined) return <p className="text-ash">This account does not exist.</p>
  return (
    <>
      <header className="mb-4 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 items-start gap-3.5">
          <AccountMark platform={account.platform} size={40} state={accountState({ working: account.working, paused: account.paused })} />
          <div className="min-w-0">
            <h1 className="text-metric">{account.name}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-ash">
              <Mono className="text-graphite">{handleOf(account)}</Mono>
              <span aria-hidden>·</span>
              <span>{account.niche}</span>
              {account.paused && <Pill tint="alert-amber">Paused</Pill>}
            </p>
            {filled(props.lead) && <div className="mt-1 text-sm">{props.lead}</div>}
          </div>
        </div>
        {filled(props.actions) && <div className="flex flex-wrap items-center gap-2">{props.actions}</div>}
      </header>
      <TabNav label={`${account.name}'s pages`} items={tabsOf(account._id, props.tab)} className="mb-6" />
      {props.children}
    </>
  )
}
