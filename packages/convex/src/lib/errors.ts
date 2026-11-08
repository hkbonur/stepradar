import { ConvexError } from 'convex/values'

/**
 * A rule the operator ran into, in words the studio shows as they are.
 * Convex replaces the message of a plain Error with "Server Error" for
 * clients in production and wraps it in a request id and stack in
 * development, so every refusal the operator should read is thrown through
 * here. A bug (a missing row, a broken invariant) stays a plain Error.
 */
export function refusal(message: string): ConvexError<string> {
  return new ConvexError(message)
}
