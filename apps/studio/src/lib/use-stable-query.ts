import type { FunctionReference, FunctionReturnType, OptionalRestArgs } from 'convex/server'
import { useQuery } from 'convex/react'
import React from 'react'

/**
 * `useQuery`, keeping the last answer while new arguments load. Convex treats
 * new arguments as a new query and answers undefined until the server
 * replies, which would show the page's skeleton and unmount what the
 * operator is editing; the last answer stays on screen instead.
 */
export function useStableQuery<Query extends FunctionReference<'query'>>(
  query: Query,
  ...args: OptionalRestArgs<Query>
): FunctionReturnType<Query> | undefined {
  const result = useQuery(query, ...args)
  const [kept, setKept] = React.useState(result)
  // React's own pattern for keeping a value from an earlier render: set during render, only when it changed.
  if (result !== undefined && result !== kept) setKept(result)
  return result ?? kept
}
