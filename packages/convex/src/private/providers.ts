import { PLATFORMS, needsConnection, type Platform, type PlatformPlace } from '@stepradar/shared'
import { query } from '../_generated/server'
import { keyStatuses } from '../core/keys'
import { hasEnv, providersMode } from '../lib/env'
import { capabilitiesOf, readerKeys, realReader } from '../providers/platforms'

/** A placeholder forum the Providers page builds the forum reader at, to say what it reads on Discourse; it is never read. */
const SHOWN_FORUM = { origin: 'https://forum.example.com', name: 'A Discourse forum', software: 'discourse' } as const

/** Where the Providers page builds a platform's reader: the platform, or for a forum the placeholder. */
function shownPlace(platform: Platform): PlatformPlace {
  return platform === 'forum' ? { platform, forum: SHOWN_FORUM } : { platform }
}

/**
 * The Providers page: what runs mock, what runs real, what each platform's
 * reader can do, and which keys are set: the operator's, stored in the
 * backend (core/keys.ts), each with its last characters only, and the
 * deployment's own web push keys.
 */
export const status = query({
  args: {},
  handler: async (ctx) => {
    const recentJobs = await ctx.db.query('jobs').order('desc').take(30)
    const providerKeys = await keyStatuses(ctx)
    // Each key a provider needs, by name, whether set: the operator's and the deployment's alike, for the adapters' table.
    const set: Record<string, boolean> = {
      ...Object.fromEntries(providerKeys.map((key) => [key.name, key.set])),
      VAPID_PUBLIC_KEY: hasEnv('VAPID_PUBLIC_KEY'),
      VAPID_PRIVATE_KEY: hasEnv('VAPID_PRIVATE_KEY'),
      VAPID_SUBJECT: hasEnv('VAPID_SUBJECT'),
    }
    // Built only to say what each reader reads, never read with, so they need no keys.
    const noKeys = {}
    return {
      mode: providersMode(),
      providerKeys,
      keys: set,
      providers: [
        { name: 'llm', real: 'Anthropic Messages API', hasReal: true, needs: ['ANTHROPIC_API_KEY'] },
        { name: 'classifier', real: 'Claude Haiku 5.5', hasReal: true, needs: ['ANTHROPIC_API_KEY'] },
        ...PLATFORMS.map((platform) => {
          const reader = realReader(shownPlace(platform), null, noKeys)
          const reads = capabilitiesOf(reader)
          // A reader is only built here, never read with, so a placeholder grant shows what a connected one reads.
          const connected = needsConnection(platform) ? realReader(shownPlace(platform), { refreshToken: 'placeholder' }, noKeys) : null
          const once = connected === null ? '' : `; ${connected.name} once connected: ${capabilitiesOf(connected).join(', ')}`
          const elsewhere = platform === 'forum' ? '; a forum on other software is read by hand' : ''
          return {
            name: `reader: ${platform}`,
            real: reads.length === 0 ? 'none: every step is manual' : `${reader.name}: ${reads.join(', ')}${once}${elsewhere}`,
            hasReal: reads.length > 0,
            needs: [...readerKeys(platform)],
          }
        }),
        { name: 'suggestions', real: 'Google autocomplete (unofficial)', hasReal: true, needs: [] as string[] },
        { name: 'site', real: "The product's website, read once for a profile proposal", hasReal: true, needs: [] as string[] },
        { name: 'notifier', real: 'Web push', hasReal: true, needs: ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'] },
      ],
      recentJobs,
    }
  },
})
