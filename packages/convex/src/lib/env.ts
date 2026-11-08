import { refusal } from './errors'

/**
 * Deployment configuration (ADR 0002). Every read is explicit: a missing value
 * that matters throws with the variable's name, never a silent default.
 */
export type ProvidersMode = 'mock' | 'real'

export function providersMode(): ProvidersMode {
  const mode = process.env.PROVIDERS_MODE ?? 'mock'
  if (mode === 'mock' || mode === 'real') return mode
  throw new Error(`PROVIDERS_MODE must be "mock" or "real", got "${mode}"`)
}

/** A missing value is the operator's to set, so it is said in words the studio shows (lib/errors `refusal`). */
export function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw refusal(`${name} is not set on this deployment. The Providers page lists the keys each provider needs.`)
  return value
}

export function hasEnv(name: string): boolean {
  return Boolean(process.env[name])
}
