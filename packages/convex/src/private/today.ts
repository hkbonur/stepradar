import { v } from 'convex/values'
import { query } from '../_generated/server'
import { todayView } from '../core/today'

/**
 * Today, the home page (core/today.ts), at the studio's clock: the page reads
 * it again every minute, so one left open past midnight moves to the new day
 * and its drafts' freshness keeps up, where the backend's own clock would
 * only be read again when a row changes.
 */
export const view = query({
  args: { now: v.number() },
  handler: async (ctx, args) => todayView(ctx, args.now),
})
