import { ConvexError } from 'convex/values'

/**
 * What the studio shows when a call fails. A refusal from the backend
 * (packages/convex/src/lib/errors.ts) is shown as written. Anything else is a
 * bug, so its raw message is shown on purpose: the operator is the one who
 * fixes it.
 */
export function errorMessage(caught: unknown): string {
  if (caught instanceof ConvexError && typeof caught.data === 'string') return caught.data
  return caught instanceof Error ? caught.message : String(caught)
}
