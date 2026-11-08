import { STRATEGY_REVIEW_SLOT } from '@influstep/shared'
import { cronJobs } from 'convex/server'
import { internal } from './_generated/api'

/**
 * The account's clock. Everything here fans out per active account through
 * internal/schedule.ts, so a paused account is skipped at the source.
 */
const crons = cronJobs()

crons.interval('poll signals for every account', { hours: 1 }, internal.internal.schedule.pollSignals, {})
// Listen every hour; the writer drafts within the day's reply budget.
crons.interval('listen for threads to answer', { hours: 1 }, internal.internal.schedule.listen, {})
// Find what the operator posted soon after they post it, so its numbers and comments are read from the start.
crons.interval('find what was posted', { minutes: 10 }, internal.internal.schedule.match, {})
// Read the comments under what went out and the mentions, so a comment is answered and notified within ten minutes.
crons.interval('read comments and mentions', { minutes: 10 }, internal.internal.schedule.pollComments, {})
// Push what is due: each notification is scheduled for its time, and this sweeps up any a failed run left queued.
crons.interval('push due notifications', { minutes: 10 }, internal.internal.push.sendDue, {})
crons.daily('pull metrics and decide experiments', { hourUTC: 5, minuteUTC: 0 }, internal.internal.schedule.pullMetrics, {})
// After the comments are read, so the brief and the problem log see this morning's.
crons.daily('morning sweep: signals, brief, problem log', { hourUTC: 6, minuteUTC: 15 }, internal.internal.schedule.morningSweep, {})
// After the sweep, so each post's last check and the writer read this morning's research.
crons.daily("write tomorrow's posts", { hourUTC: 7, minuteUTC: 30 }, internal.internal.schedule.writeDuePosts, {})
// Every hour, for the accounts whose local morning it is (core/notifications.ts, DIGEST_HOUR).
crons.hourly('morning digest', { minuteUTC: 0 }, internal.internal.notifications.morningDigest, {})
// The review runs half an hour before planning, so next week's plan follows its pillar weights and defaults.
crons.weekly('review every strategy', STRATEGY_REVIEW_SLOT, internal.internal.schedule.reviewStrategies, {})
crons.weekly('plan next week', { dayOfWeek: 'monday', hourUTC: 7, minuteUTC: 0 }, internal.internal.schedule.planNextWeek, {})
crons.daily('age out unused signals', { hourUTC: 3, minuteUTC: 0 }, internal.internal.schedule.ageOutSignals, {})

export default crons
