# Stepradar

The operator's engagement desk on Reddit, Hacker News, X, LinkedIn and product forums. For each of the operator's own accounts it finds the threads worth answering, drafts replies and posts in the account's voice, and waits: the operator posts by hand. Stepradar then finds what went out, measures it, says when someone answers, runs experiments, and says what to do next. It never posts.

## Run it locally

Needs Docker, Node 24 (`.nvmrc`) and pnpm 11.

```bash
pnpm install
pnpm backend:up      # local Convex in docker, pushes the backend
pnpm dev             # the studio on http://localhost:3300, and the Convex watcher
```

The first visit opens the setup: name the product your accounts promote and say in one sentence what it does, paste your Anthropic key (or add it later), then add one to five of your own accounts.

To look around with demo data instead, run `pnpm seed` on an empty backend: it builds a workspace for Formstep (the product Stepradar was first built for) with two accounts on X and one on the n8n Community, and a planned week. `pnpm seed:fresh` wipes the backend first.

Under Vite, `/go/:slug` (a tracked link) is an SPA route that calls the same Convex function as the worker. To exercise the worker itself, run `pnpm --filter @stepradar/app exec wrangler dev --port 3301`. Before a real deploy, override `CONVEX_URL` in `apps/studio/wrangler.toml` (it is committed pointing at the local docker backend) or set it as a Cloudflare variable.

Everything runs with mock providers by default: signals, threads, drafts and numbers are generated so the whole loop can be walked end to end. To switch, add your keys in the studio (the setup asks for the Anthropic key; the Providers page takes it and the Reddit app's keys any time), then set `PROVIDERS_MODE=real` on the deployment from `packages/convex`:

```bash
pnpm exec convex env set PROVIDERS_MODE real
```

A missing key is refused by name, never served from a mock. Hacker News and Discourse forums need no key.

## Layout

- `apps/studio` — the operator app (React, TanStack Router, Tailwind) on a Cloudflare Worker that also serves tracked links
- `packages/convex` — the backend: accounts, posts, replies, comments, signals, experiments, jobs, crons, providers
- `packages/shared` — types and pure helpers shared by both

Read `CONTEXT.md` for the vocabulary, `PRODUCT.md` for what Stepradar is for, and `docs/plan.md` for the plan and where the build stands.
