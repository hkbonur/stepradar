# Influstep

The operator's engagement desk on Reddit, Hacker News, X, LinkedIn and product forums. For each of the operator's own accounts it finds the threads worth answering, drafts replies and posts in the account's voice, and waits: the operator posts by hand. Influstep then finds what went out, measures it, says when someone answers, runs experiments, and says what to do next. It never posts.

## Run it locally

Needs Docker, Node 24 (`.nvmrc`) and pnpm 11.

```bash
pnpm install
pnpm backend:up      # local Convex in docker, pushes the backend
pnpm dev             # the studio on http://localhost:3300, and the Convex watcher
```

The first visit opens the setup: name the product your accounts promote, say in one sentence what it does, and what one paying customer is worth; then add one to five of your own accounts.

To look around with demo data instead, run `pnpm seed` on an empty backend: it builds a workspace for Formstep (the product Influstep was first built for) with two accounts on X and one on the n8n Community, and a planned week. `pnpm seed:fresh` wipes the backend first.

Under Vite, `/go/:slug` (a tracked link) is an SPA route that calls the same Convex function as the worker. To exercise the worker itself, run `pnpm --filter @influstep/app exec wrangler dev --port 3301`. Before a real deploy, override `CONVEX_URL` in `apps/studio/wrangler.toml` (it is committed pointing at the local docker backend) or set it as a Cloudflare variable.

Everything runs with mock providers by default: signals, threads, drafts and numbers are generated so the whole loop can be walked end to end. Set `PROVIDERS_MODE=real` and the keys on the Convex deployment to switch; the Providers page lists the keys each provider needs, and a missing one is refused by name, never served from a mock.

## Layout

- `apps/studio` — the operator app (React, TanStack Router, Tailwind) on a Cloudflare Worker that also serves tracked links
- `packages/convex` — the backend: accounts, posts, replies, comments, signals, experiments, jobs, crons, providers
- `packages/shared` — types and pure helpers shared by both

Read `CONTEXT.md` for the vocabulary, `PRODUCT.md` for what Influstep is for, and `docs/plan.md` for the plan and where the build stands.
