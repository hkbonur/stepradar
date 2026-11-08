/**
 * The local Convex backend (ADR 0001): `up` starts the docker container,
 * generates an admin key, writes packages/convex/.env.local, sets the
 * deployment's env vars, and pushes the functions. `push` pushes again.
 * `down` stops the container and keeps its data volume.
 *
 * Run through `node --experimental-strip-types`; no build step.
 */
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const convexRoot = path.join(repoRoot, 'packages', 'convex')
const composeFile = path.join(repoRoot, 'docker-compose.yml')
const envLocal = path.join(convexRoot, '.env.local')

const CONVEX_URL = 'http://127.0.0.1:3220'
const CONVEX_SITE_URL = 'http://127.0.0.1:3221'

function run(command: string, args: string[], cwd = repoRoot): string {
  return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function convex(args: string[]): string {
  const binary = path.join(convexRoot, 'node_modules', '.bin', 'convex')
  const output = execFileSync(binary, [...args, '--env-file', envLocal], {
    cwd: convexRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (/wrong number of app bundles|✖/i.test(output)) throw new Error(`convex ${args[0]} failed:\n${output}`)
  return output.trim()
}

async function waitForHttp(url: string, timeoutMs = 60_000): Promise<void> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    try {
      await fetch(url)
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }
  throw new Error(`Timed out waiting for ${url}. Is Docker Desktop running?`)
}

function readEnvLocal(): Record<string, string> {
  if (!fs.existsSync(envLocal)) return {}
  const out: Record<string, string> = {}
  for (const line of fs.readFileSync(envLocal, 'utf8').split(/\r?\n/)) {
    const index = line.indexOf('=')
    if (index === -1 || line.startsWith('#')) continue
    out[line.slice(0, index).trim()] = line.slice(index + 1).trim()
  }
  return out
}

async function up(): Promise<void> {
  run('docker', ['compose', '-f', composeFile, 'up', '-d'])
  await waitForHttp(CONVEX_URL)
  await waitForHttp(CONVEX_SITE_URL)
  const existing = readEnvLocal()
  const adminKey =
    existing.CONVEX_SELF_HOSTED_ADMIN_KEY ||
    run('docker', ['compose', '-f', composeFile, 'exec', '-T', 'convex-backend', './generate_admin_key.sh'])
      .split(/\r?\n/)
      .filter(Boolean)
      .at(-1)
  if (!adminKey) throw new Error('generate_admin_key.sh printed no key')
  fs.writeFileSync(envLocal, `CONVEX_SELF_HOSTED_URL=${CONVEX_URL}\nCONVEX_SELF_HOSTED_ADMIN_KEY=${adminKey}\n`)

  const current = convex(['env', 'list'])
  const defaults: Record<string, string> = {
    PROVIDERS_MODE: 'mock',
    ...(current.includes('VAPID_PUBLIC_KEY=') ? {} : vapidPair()),
  }
  for (const [name, value] of Object.entries(defaults)) {
    if (current.includes(`${name}=`)) continue
    convex(['env', 'set', name, value])
  }
  push()
  console.log(`Convex backend ready at ${CONVEX_URL} (HTTP routes at ${CONVEX_SITE_URL}).`)
}

/**
 * A VAPID key pair for local web push (docs/plan.md, "Notifier: web push"):
 * a P-256 key, its public point uncompressed and its private scalar, both
 * base64url, as the web-push package and the browser read them.
 */
function vapidPair(): Record<string, string> {
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const jwk = privateKey.export({ format: 'jwk' })
  if (!jwk.x || !jwk.y || !jwk.d) throw new Error('node:crypto exported a P-256 key without its coordinates')
  const point = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')])
  return { VAPID_PUBLIC_KEY: point.toString('base64url'), VAPID_PRIVATE_KEY: jwk.d, VAPID_SUBJECT: 'mailto:operator@localhost' }
}

function push(): void {
  console.log(convex(['dev', '--once', '--typecheck', 'disable']))
}

function down(): void {
  run('docker', ['compose', '-f', composeFile, 'down', '--remove-orphans'])
  console.log('Convex backend stopped; data volume kept.')
}

const command = process.argv[2]
if (command === 'up') await up()
else if (command === 'push') push()
else if (command === 'down') down()
else {
  console.error('usage: local-convex.ts up|push|down')
  process.exit(1)
}
