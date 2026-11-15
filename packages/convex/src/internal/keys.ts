import { internalQuery } from '../_generated/server'
import { storedKeys, type ProviderKeys } from '../core/keys'

/** The stored keys for an action or an HTTP route, which read no table themselves (core/keys.ts). */
export const stored = internalQuery({
  args: {},
  handler: async (ctx): Promise<ProviderKeys> => storedKeys(ctx),
})
