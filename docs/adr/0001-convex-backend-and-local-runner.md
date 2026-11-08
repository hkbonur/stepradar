# ADR 0001: Convex backend, Cloudflare app, local runner

**Status**: accepted, 2026-10-09. The runner half is superseded by ADR 0004 (2026-10-22): Influstep no longer records or publishes, so it has no runner.

## Context

Influstep must schedule work (plan weeks, poll sources, publish at a time), react in real time (the calendar updates as agents work), call external APIs, and record the screen of the operator's own computer. Cloudflare Workers cannot record a screen, and a cloud backend cannot sign in to the operator's n8n.

## Decision

Three runtimes with one job each:

- **Convex** is the backend: tables, domain rules, crons, the scheduler, agent actions that only need HTTP (LLM, signals, analytics, platform APIs), and file storage for recordings and renders. Locally it runs self-hosted in Docker (`docker-compose.yml`); the Formstep repo uses the same image for Playwright.
- **A Cloudflare Worker** serves the operator SPA and the two public routes that must be fast and never wake the backend on a cold path: `/go/:slug` (tracked-link click, redirect to Formstep with UTM) and `/p/:handle` (link in bio).
- **A local runner** (`apps/runner`) on the operator's machine does what needs a real browser, a GPU, or the operator's sessions: Playwright recordings against a persistent browser profile, voice generation, ffmpeg renders, uploads. It polls the backend for runner jobs over an HTTP route with a shared token, so it works from behind NAT without a tunnel.

Jobs are the contract between them: a job says where it runs (`backend` or `runner`), which agent role owns it, and carries its payload and result. Everything an agent does is a job, so the audit trail is the jobs table.

## Consequences

- The operator's computer must be on for recording and publishing to happen. A persona's plan shows this: an episode stays `recording` until the runner picks it up, and the Providers page shows the runner's last heartbeat.
- The runner is replaceable by a cloud VM with a browser later without touching the backend.
- No auth in the first version: the app is single-operator and local. Adding Better Auth later follows Formstep's setup.
