import { v } from 'convex/values'
import { query } from '../_generated/server'
import { addDays } from '../core/dates'
import { calendarPostOf, type CalendarPost } from '../core/calendar'

/** The week strip on Today: each day's posts across the accounts, soonest first (core/calendar.ts). */
export const week = query({
  args: { weekStart: v.string() },
  handler: async (ctx, args): Promise<{ days: { day: string; posts: CalendarPost[] }[] }> => {
    const accounts = new Map((await ctx.db.query('accounts').collect()).map((account) => [account._id, account]))
    const days = []
    for (let offset = 0; offset < 7; offset += 1) {
      const day = addDays(args.weekStart, offset)
      const rows = await ctx.db
        .query('posts')
        .withIndex('by_day', (q) => q.eq('plannedFor', day))
        .collect()
      const posts: CalendarPost[] = []
      for (const post of rows) {
        const account = accounts.get(post.accountId)
        if (!account) continue
        posts.push(await calendarPostOf(ctx, post, account))
      }
      posts.sort((a, b) => a.scheduledAt - b.scheduledAt)
      days.push({ day, posts })
    }
    return { days }
  },
})
