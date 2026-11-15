import { PROVIDER_KEYS, PROVIDER_KEY_LABELS, keyEnding, type ProviderKey } from '@stepradar/shared'
import type { QueryCtx } from '../_generated/server'
import { refusal } from '../lib/errors'

/**
 * The keys the operator brought for the real providers (ADR 0005), as the
 * backend reads them: once per function, handed to the providers that need
 * them, never to the studio. A missing key is refused by name where it is
 * used, never replaced by a mock (ADR 0002).
 */

type Reader = { db: QueryCtx['db'] }

/** Each stored key's value, by name; a key never set is absent. */
export type ProviderKeys = Readonly<Partial<Record<ProviderKey, string>>>

export async function storedKeys(ctx: Reader): Promise<ProviderKeys> {
  const rows = await ctx.db.query('providerKeys').collect()
  return Object.fromEntries(rows.map((row) => [row.name, row.value]))
}

/** A key's value, or a refusal the studio shows, naming it and where to set it. */
export function requireKey(keys: ProviderKeys, name: ProviderKey): string {
  const value = keys[name]
  if (value === undefined) throw refusal(`The ${PROVIDER_KEY_LABELS[name]} is not set. Add it on the Providers page.`)
  return value
}

/** The keys of `names` the operator has not set, in their order. */
export function missingKeys(keys: ProviderKeys, names: readonly ProviderKey[]): ProviderKey[] {
  return names.filter((name) => keys[name] === undefined)
}

/** What the studio may know of each key: whether it is set, its last characters and when; never the key. */
export type KeyStatus = { name: ProviderKey; set: false } | { name: ProviderKey; set: true; ending: string; setAt: number }

export async function keyStatuses(ctx: Reader): Promise<KeyStatus[]> {
  const rows = await ctx.db.query('providerKeys').collect()
  return PROVIDER_KEYS.map((name): KeyStatus => {
    const row = rows.find((candidate) => candidate.name === name)
    return row === undefined ? { name, set: false } : { name, set: true, ending: keyEnding(row.value), setAt: row.setAt }
  })
}
