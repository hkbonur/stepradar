# ADR 0003: Attribution runs through tracked links and PostHog

**Status**: accepted, 2026-10-09; PostHog removed 2026-11-08 (see the last amendment)

## Context

The goal is Formstep users, not views. Platforms report views and follows but nothing about what happened after a click. Formstep already sends product events to PostHog.

## Decision

Every publication carries one tracked link, `/go/<slug>`, served by the Worker. A click is counted in Stepradar and redirected to formstep.io with `utm_source=<persona handle>`, `utm_medium=<platform>`, `utm_campaign=<episode slug>`, and `utm_content=<variant key>`. PostHog's first-touch UTM properties then tie Formstep's `signed_up`, `form_published`, and `subscription_started` events to the persona, episode, and variant. The analyst pulls those counts from PostHog's query API (HogQL) per persona and stores them as metric snapshots, so the report's funnel is view → click → signup → paid with one source per step.

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

## Amended, 2026-11-08 (PostHog out)

- Stepradar reads no product analytics. The analytics provider, conversions, probable conversions, the value of one paying customer and the post reworked from what brought users are gone (docs/plan.md, slice 23). The operator wanted one key fewer, and a product without PostHog could not run in real mode at all: the daily metrics pull failed before it closed a post or decided an experiment.
- The tracked links and their UTM parameters stay exactly as above: Stepradar counts the clicks on X and LinkedIn, and the sponsor's own analytics, whatever it is, can still tie a visit or a signup back to an account, a post and a variant.
- The funnel ends at clicks. The goal metric ladder is clicks, then reach; pillars are weighed on clicks per reach, then reach per post, and communities on reach per post; the goal note, the growth line and the Monday digest say the clicks and the karma or followers gained.
- Where nothing reads an account's numbers (an unconnected Reddit account, LinkedIn) and its posts link directly, no experiment can be decided on that account any more: signups were the rung that reached it.
