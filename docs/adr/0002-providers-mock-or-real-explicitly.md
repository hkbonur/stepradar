# ADR 0002: Providers are mock or real by explicit mode, never by fallback

**Status**: accepted, 2026-10-09

## Context

Influstep depends on ElevenLabs, an avatar generator, YouTube, TikTok, Instagram, Hacker News, Reddit, Google Trends, PostHog, and an LLM. Most need keys, app reviews, or paid plans. The pipeline must still be walkable end to end on a laptop with none of them.

## Decision

Every external capability is a **provider**: one TypeScript interface, one mock adapter, one real adapter. The deployment picks the mode with `PROVIDERS_MODE=mock|real` (backend env and runner env). In real mode a missing key throws at the call site with the key's name; nothing degrades to mock silently (coding rule: no silent fallbacks). The Providers page shows the mode and, in real mode, which keys are present.

Mock adapters are deterministic from their inputs (seeded by ids), so tests and demos are stable, and they are honest: a mock recording is a generated placeholder video that says "mock recording", a mock metric snapshot is labeled mock in the report.

## Consequences

- A new provider is added by writing the interface in `packages/shared`, both adapters in `packages/convex/src/providers` or `apps/runner/src/providers`, and a row on the Providers page.
- Real adapters for Hacker News (Algolia API, no key) and Reddit (public JSON, no key) work from day one; the rest need keys listed in `packages/convex/.env.example`.
