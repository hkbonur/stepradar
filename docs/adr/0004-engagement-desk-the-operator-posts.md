# ADR 0004: An engagement desk where the operator posts, not AI personas that publish videos

**Status**: accepted, 2026-10-22. Supersedes the runner half of ADR 0001.

## Context

Influstep was built to run AI personas that record, render and publish short videos, and post and reply on X, so that their followers discover the operator's product. The operator wants to grow attention for the product where its future customers already talk: Reddit, Hacker News, X and LinkedIn, from the operator's own accounts.

On those platforms an account that posts on its own is a liability. Reddit and Hacker News remove promotion that hides who is behind it and dislike machine-written text, X limits automated replies to strangers, and LinkedIn forbids automation. An AI persona there would be a fake account; the operator's own account run by a bot would risk the account itself.

## Decision

- **Influstep never posts, likes, votes or follows.** It listens, drafts, matches what the operator posted, measures it, reads the comments under it and recommends what to do next. Every word that reaches a platform is posted by the operator by hand from their own account.
- **The unit is an account**: one of the operator's own accounts on one platform. Personas, the looks, the voices, the videos and the publish pipeline go.
- **No runner.** Nothing needs the operator's machine any more, so every job runs on the backend, and the runner, its HTTP routes and its token go. Convex stays the backend and the Cloudflare Worker still serves the SPA and `/go/:slug` (ADR 0001's other two parts hold).
- **One platform reader per platform** (search, own activity, comments, counts, account counts), each with a mock and a real adapter (ADR 0002). A capability a platform does not offer is a manual step the operator sees, never mock data.
- **Disclosure is a rule in the code.** A draft that names the sponsor says that the operator builds it, a draft never speaks as a customer, and a community whose rules forbid self-promotion never gets the sponsor's name.
- **No browser extension in v1.** Reddit and Hacker News have read APIs; X runs by hand until its API tier is chosen, and LinkedIn runs by hand.
- **Notifications are web push** from the studio.

## Consequences

- The operator's computer no longer has to be on. The studio is the only thing they open.
- Drafts on Reddit and Hacker News are meant to be rewritten, so the match finds a posted item by where and when it was posted, and uses the text only to break ties.
- Experiments decide more slowly: a person posts a handful of items a day, not a calendar of videos.
- A later extension (LinkedIn coverage, a draft in a side panel) talks to Convex over HTTP with a token, as the runner did, and gets its own ADR.
