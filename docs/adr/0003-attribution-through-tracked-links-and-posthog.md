# ADR 0003: Attribution runs through tracked links and PostHog

**Status**: accepted, 2026-10-09

## Context

The goal is Formstep users, not views. Platforms report views and follows but nothing about what happened after a click. Formstep already sends product events to PostHog.

## Decision

Every publication carries one tracked link, `/go/<slug>`, served by the Worker. A click is counted in Influstep and redirected to formstep.io with `utm_source=<persona handle>`, `utm_medium=<platform>`, `utm_campaign=<episode slug>`, and `utm_content=<variant key>`. PostHog's first-touch UTM properties then tie Formstep's `signed_up`, `form_published`, and `subscription_started` events to the persona, episode, and variant. The analyst pulls those counts from PostHog's query API (HogQL) per persona and stores them as metric snapshots, so the report's funnel is view → click → signup → paid with one source per step.

## Consequences

- Attribution is first-touch by UTM; a viewer who clicks twice from two episodes credits the first. Good enough for choosing between variants, and the report says so.
- Clicks are real even in mock mode (the Worker counts them locally); signups and paid are mock until PostHog keys are set.
- The PostHog project must keep `$initial_utm_*` person properties, which is PostHog's default.

## Amended, 2026-10-23 (the engagement desk, ADR 0004)

- A post, not a publication, carries the link, and only a post that names the sponsor: replies stay without one. The UTM keys stay as above, with the account's handle as the source, the platform as the medium, the post's slug as the campaign and its variant as the content, on the redirect and in a direct link alike.
- On X and LinkedIn the link is the tracked link above. On Reddit and Hacker News, which distrust redirect domains, it is the sponsor's website with the UTM parameters in the link itself, so no click is counted there: the report shows those clicks as not counted, and the experiments and the strategy review use signups and reach instead.
- A conversion with no UTM parameters whose person said they heard of the sponsor on a platform (`heard_about_us`), or first arrived from a platform's domain, is a probable conversion: stored by platform, shown apart from the funnel, read by no experiment.
- Conversions are stored as conversions, not metric snapshots; Polar and the discount codes are gone.
- A conversion is an account's when the person's first link named the account's handle as the source and its platform as the medium. So a handle is unique on its platform only: the same handle on two platforms is two accounts, and one handle in two cases on one platform is the same one, on every platform, Hacker News included.
- A forum account's medium is its forum's host (`utm_medium=community.n8n.io`), not the platform's name, since every forum is its own site and one username on two forums is two accounts. Its posts link directly, as on Reddit, and its probable conversions are the ones that first arrived from the workspace's forums' hosts, or whose person named a forum.
