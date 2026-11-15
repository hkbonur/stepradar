/**
 * The keys the operator brings for the real providers (ADR 0005): stored
 * write-only in the backend, asked for by the setup and set on the
 * Providers page. What the deployment itself runs on (`PROVIDERS_MODE`, the
 * web push keys, `CONVEX_SITE_URL`) stays on the deployment.
 */
export const PROVIDER_KEYS = ['ANTHROPIC_API_KEY', 'REDDIT_CLIENT_ID', 'REDDIT_CLIENT_SECRET', 'REDDIT_USER_AGENT'] as const
export type ProviderKey = (typeof PROVIDER_KEYS)[number]

/** Each key as a field and a refusal name it. */
export const PROVIDER_KEY_LABELS: Record<ProviderKey, string> = {
  ANTHROPIC_API_KEY: 'Anthropic API key',
  REDDIT_CLIENT_ID: 'Reddit app ID',
  REDDIT_CLIENT_SECRET: 'Reddit app secret',
  REDDIT_USER_AGENT: 'Reddit user agent',
}

/** Where each key comes from, said under its field. */
export const PROVIDER_KEY_HINTS: Record<ProviderKey, string> = {
  ANTHROPIC_API_KEY: 'From console.anthropic.com, under API keys. The writer, the judge and the classifier run on it.',
  REDDIT_CLIENT_ID:
    'A "web app" at reddit.com/prefs/apps whose redirect URI is your backend\'s /oauth/reddit/callback (locally http://127.0.0.1:3221/oauth/reddit/callback); its ID is the line under its name.',
  REDDIT_CLIENT_SECRET: "The same app's secret.",
  REDDIT_USER_AGENT: 'Names the app and you, such as web:stepradar:0.1 (by /u/yourname).',
}

/** How many of a stored key's last characters the studio shows, so the operator knows which key it is. */
const SHOWN_ENDING = 4

/** The shortest value taken as a key: every one Anthropic and Reddit hand out is longer, and the shown ending stays a small part of it. */
const KEY_MIN_LENGTH = 12

/** The end of a stored key the studio may show: never the key. */
export function keyEnding(value: string): string {
  return value.slice(-SHOWN_ENDING)
}

/** What is wrong with a key as typed, in the words the studio and the backend both use; null when it can be stored. */
export function providerKeyProblem(name: ProviderKey, value: string): string | null {
  const key = value.trim()
  if (key === '') return `Paste the ${PROVIDER_KEY_LABELS[name]}.`
  if (key.length < KEY_MIN_LENGTH) return `That is too short to be the ${PROVIDER_KEY_LABELS[name]}: paste the whole key.`
  return null
}
