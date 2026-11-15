# ADR 0005: The operator's provider keys are stored in the backend

**Status**: accepted, 2026-11-08

## Context

Every real adapter read its key from the Convex deployment's environment (`ANTHROPIC_API_KEY`, `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_USER_AGENT`), set with `convex env set` from a terminal. The operator asked to bring their own keys in the studio instead, and for the first-run setup to ask for them. Environment variables had one strength: no query can return them, and the studio has no sign-in yet.

## Decision

The keys an operator brings for the real providers live in a `providerKeys` table, one row per key (shared `PROVIDER_KEYS`). The setup asks for the Anthropic key, which can wait ("Add it later"); the Providers page sets, replaces and removes each key.

- **Write-only.** `private/keys.ts` sets and removes keys; no function the studio calls returns one. The Providers page's status shows whether each key is set, its last four characters and when (core/keys.ts `keyStatuses`).
- **Read once per function.** An action reads the stored keys through `internal.keys.stored` and hands them to the providers it builds (`llmProvider(keys)`, `classifierProvider(keys)`, `platformReader(place, connection, keys)`); a query reads them with `storedKeys`. The adapters read a key where each request is made, so a missing key fails that step with its name (`requireKey`), never a mock (ADR 0002).
- **One source per key.** These keys are read from the table only, never from the environment as well.
- **What stays on the deployment.** `PROVIDERS_MODE` (the operator chose to keep switching modes with one command), the VAPID keys (`pnpm backend:up` makes them; the operator never brings them) and `CONVEX_SITE_URL` (the deployment's own address). None of these is the operator's to bring, so none moves.
- **A seed reset keeps the keys.** They are no demo data.

## Consequences

- The keys are stored in plain text in the operator's own Convex backend, as the Reddit refresh tokens already are. That is fine for one operator on their own machine.
- With no sign-in, anyone who can reach the backend can replace or remove a key, and so spend the operator's Anthropic credit, though no function hands a key back. A deployment anyone else can reach needs sign-in first, as it already did for everything else.
- A new provider key is added to shared `PROVIDER_KEYS` with its label and hint; the setup, the Providers page and the refusals follow.
