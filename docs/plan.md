# Influstep: plan

Written 2026-10-22. This plan replaces the video plan (slices 1 to 17, in git up to commit 7978fcd). The decision is ADR 0004.

## The decision

Influstep stops making videos. It becomes the operator's engagement desk on Reddit, Hacker News, X and LinkedIn. It finds the conversations where the sponsor's future customers talk about the problem the sponsor solves. It drafts replies and posts in the operator's voice. The operator posts them by hand from their own accounts. Influstep then finds what went out, measures it, tells the operator when someone answers, runs experiments, and says what to do next.

**Influstep never posts, likes, votes or follows.** Every word that reaches a platform is posted by a person from their own account. This one rule removes the runner, the publisher, every write scope on every platform API, and the automation risk to the operator's accounts.

## The loop

There are two loops. They share the drafts, the match, the comments, the metrics and the experiments.

**Reply loop.** The listener sweeps each account's communities for threads worth answering. The writer drafts a reply for each one it keeps, within the day's reply budget. The operator opens the thread, pastes or rewrites the draft, and posts it. The match finds the posted comment in the account's own activity. The analyst measures it for a week. Comments under it come back as notifications, each with a drafted answer.

**Post loop.** The researcher turns the week's signals into ideas. The planner spreads them over the week by the account's cadence. The writer drafts each post the day before it is due. The operator posts it. From there it runs like a reply: match, measure, comments, notifications.

Both loops feed one strategy per account. The strategy review moves weight toward the communities and pillars that earn the most. Experiments test one dimension at a time. The Today page shows the next steps.

## Ground rules

These rules live in `core/disclosure.ts` and in the writer's prompt. A draft that breaks one is refused when stored, rewritten once, and then skipped with the reason.

1. **Affiliation is stated.** A draft that names the sponsor says that the operator builds it, in the account's own affiliation line ("I'm building Formstep, so take this with salt"). The operator sets the line once per account.
2. **No borrowed experience.** No draft speaks as a customer, a reviewer or a third party who found the sponsor.
3. **Community rules win.** The listener reads each community's rules (a subreddit's rules, HN's guidelines). A draft never names the sponsor in a community whose rules forbid self-promotion.
4. **The sponsor dial caps mentions.** It caps the share of an account's posted drafts that name the sponsor, over a rolling seven days. The default is 1 in 10. Most drafts help without any mention, and that is how an account earns karma and followers.
5. **Pain-point posts ask a real question.** A post that asks people how they handle a problem asks it openly. The sponsor appears only if it comes up in the operator's own later reply, and then with the affiliation line.
6. **Each platform gets the draft shape it tolerates.**

| Platform | Draft shape | Why |
| --- | --- | --- |
| X | Ready-to-post text, one part per post in a thread | Short format; voice learned from the account's history. |
| LinkedIn | Ready-to-post text | Long format; voice learned from history. |
| Reddit | Full text, marked "rewrite in your words" | Many subreddits remove text that reads machine-written. |
| Hacker News | Talking points (at most three) and the facts or links to cite | HN moderators remove generated comments. The operator writes the comment. |

On X and LinkedIn the match measures how much the operator changed each draft. The writer reads that number, so drafts move toward what the operator actually posts. On Reddit and HN the operator is expected to rewrite, so the number means nothing there and the writer never learns from it.

## Do we need a Chrome extension?

Not for v1.

- **Reading:** Reddit, Hacker News and X have read APIs. These APIs cover finding threads, the operator's own activity, comments and counts. Convex actions call them directly. X still runs by hand in v1, like LinkedIn, until its API tier is chosen (decision 3).
- **Posting:** stays manual by design. An extension that clicks Post would bring back the automation this plan removes.
- **Knowing what was posted:** the match reads the account's own recent activity through the same APIs. No paste and no extension are needed, except on LinkedIn.
- **LinkedIn is the gap.** LinkedIn has no read API for search or for a member's own posts and comments without partner approval (check this when the keys are set up). In v1, LinkedIn runs by hand: drafts are written, the operator pastes the post's link, and counts are typed in or skipped. LinkedIn's own notifications cover its comments.

An extension earns its place later if one of these becomes worth the build:

- LinkedIn coverage beyond pasting links. The extension would read only the pages the operator opens, never crawl.
- Opening a thread with its draft in a side panel, with a button that puts the text into the compose box. The operator still clicks Post.
- Capturing the posted link at the moment of posting, with no wait for the match.

If it comes, the extension talks to Convex over HTTP with a token, the way the runner does today. It gets its own ADR.

Headless browsing as the operator (the runner's Playwright profile) is off the table. LinkedIn and X forbid it, and it puts the operator's real accounts at risk.

## Architecture

```
 Operator ── posts by hand ──► Reddit · Hacker News · X · LinkedIn
    │                                   ▲ read only
    │ browser                           │
    ▼                                   │
 Studio SPA (Cloudflare Worker)         │ platform readers (mock | real)
  Today · Drafts · Posted · Accounts    │
  Experiments · Reports · Providers     │
    │ Convex client                     │
    ▼                                   │
 Convex backend ────────────────────────┘
  core/       listener, drafts, disclosure, match, comments,
              experiments, strategy, next steps, attribution
  private/    operator queries and mutations
  internal/   researcher, writer and analyst actions, schedule fan-out
  crons.ts    listen, match, comments, metrics, sweep, review, plan
  providers/  llm · platforms/{reddit,hackernews,x,linkedin,discourse}
              analytics (PostHog) · notifier (web push)
    │                          │
    ▼                          ▼
 Web push ──► phone, laptop    PostHog (conversions)
```

What changes per package:

- **`apps/runner`: deleted.** Nothing needs the operator's machine. Every job runs on the backend, so the job runtime field, the `runners` table, the `/runner/*` routes and `RUNNER_TOKEN` go too.
- **`apps/studio`:** new home (Today), drafts with copy, open and skip, posted items with comments, and account pages. The worker keeps serving the SPA and `/go/:slug`. It drops `/p/:handle`.
- **`packages/convex`:** same layers. The domain moves from episodes to posts, replies and comments. One provider per platform replaces the signals, engagement, timeline and comments providers.
- **`packages/shared`:** video types go (beats, shots, renders, formats, appearance, media, assets, publications, runner payloads). Status machines are added for posts, replies and comments.

### Platform readers

One provider interface per platform replaces four. A platform reader can:

- **search:** find threads and comments for the listener, and items for the researcher;
- **activity:** list the account's own recent posts and comments, for the match and the history import;
- **comments:** list answers under one item since a time, plus mentions;
- **counts:** read one item's numbers;
- **account:** read the account's karma or followers.

Each reader states which of these it supports. A missing capability makes that step manual and visible: a checklist item on the account, never mock data (ADR 0002). On a platform without search (X and LinkedIn in v1), the operator pastes a thread's link and the text they want to answer, and the writer drafts a reply to it like any heard post.

| | Hacker News | Reddit | X | LinkedIn | Forum on Discourse (slice 16) |
| --- | --- | --- | --- | --- | --- |
| search | Algolia, stories and comments | Data API, per subreddit and keyword | API v2 recent search | none: the operator pastes a thread | `search.json`, topics by their first post |
| activity | Firebase `user.submitted` | `/user/<name>/comments` and `/submitted` | user timeline | none: paste the link | `user_actions.json`, topics and replies |
| comments | Firebase item `kids` | inbox: comment replies and mentions | mentions and conversation search | none: LinkedIn's own notifications | posts after the last read in a topic; a reply's replies; no mentions |
| counts | story points and comment count; comment scores are not public | score (fuzzed) and comment count | impressions, likes, replies, reposts, profile visits | typed in, or none | reads, likes and replies |
| account | karma | link and comment karma | followers | followers, typed in | likes received |
| access | free, no key; the account is its username | OAuth web app; one refresh token per connected account; check the free-tier limits and the commercial terms at setup | paid; by hand in v1, real reader once a tier is chosen | by hand; check partner access later | free, no key, public forums only; a forum on other software (the Zapier Community) is run by hand like LinkedIn |

The mock reader of each platform is deterministic from its inputs, as today.

### Notifier: web push

The notifier is a new provider. Its real adapter is web push from the studio (decision 1), and its mock adapter only records the notification.

- **What it sends.** A comment notification within ten minutes of the comment. Several comments in that window go out as one ("3 new comments"). It also sends a morning digest: drafts ready, posts due, next steps. Quiet hours are a workspace setting.
- **The payload.** A title ("u/someone answered you on r/n8n"), the first 120 characters, the URL to open (the comment on the Posted page, or Today), and a tag. The tag is the comment's id, so a repeat replaces the earlier notification instead of stacking.
- **The studio becomes installable.** It gets a manifest and icons, plus `public/sw.js`, a service worker. The worker shows each push, and a click focuses the studio or opens it at the payload's URL.
- **Subscribing.** A "Turn on notifications" button on Today and on Providers. A browser only asks for permission after a click. The button subscribes with the VAPID public key and stores the subscription, one per device. Providers lists the devices, each with Remove.
- **Sending.** A Node action (`"use node"`) uses the `web-push` package with `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT`. A 404 or 410 from the push service deletes that subscription. Any other error is written on the notification and shows on Providers. A missing key is an error that names the key (ADR 0002).
- **Mock mode.** Nothing is pushed. The notification row is marked mock, and Today's in-app list shows it the same way.
- **iPhone.** Push reaches an iPhone only after the studio is added to the Home Screen (iOS 16.4 or later). The button says so on iOS.
- **Local development.** Service workers need a secure context, and `localhost` counts as one.

## Domain model

### Glossary changes (CONTEXT.md)

| Term | Change |
| --- | --- |
| **Account** | New. Replaces **Persona**. One of the operator's own accounts on one platform: handle, platform, niche, audience, pillars, communities, affiliation line, sponsor dial, reply budget, cadence, voice, strategy. It owns its signals, drafts, experiments, memory, chat and report. The operator connects as many as they like, several on one platform if they have them (decision 2). It shows as the platform's logo and its handle. _Avoid_: persona, profile, bot. |
| **Post** | Redefined. Replaces **Episode** and **Publication**. An original post on one account, from idea to measured. Its text is the post's draft until the match finds what went out. |
| **Reply** | Generalized from X to every platform. A draft answer to someone else's thread or to a comment, posted by the operator. |
| **Draft** | Redefined. Text the writer wrote for the operator to post: a post's or a reply's. |
| **Match** | New. Finding the operator's real post or comment that came from a draft, or the link the operator pasted. _Avoid_: verify, detect, sync. |
| **Comment** | Redefined. Someone's answer under one of the operator's matched posts or replies, or a mention of the account. It becomes a notification and gets a drafted answer. |
| **Community** | New. Where an account takes part: a subreddit, Hacker News (with Ask and Show), an X topic, a LinkedIn audience. It has rules, a self-promotion flag and a weight in the strategy. |
| **Affiliation line** | New. How an account says it builds the sponsor. |
| **Next step** | New. One of at most three recommendations on Today, each with its reason and numbers. |
| **Agent** | Three roles: researcher (signals, listening, comments, morning brief), writer (drafts), analyst (match, metrics, experiments, strategy, next steps). The producer and the publisher go. |
| Removed | Look, Voice (spoken), Beat, Shot, Recipe, Render, Script, Publish package, Sponsor segment (a draft names the sponsor or it doesn't), Description format, Runner, Link in bio, Asset, Asset library, Generated picture. |

### Status machines (shared)

- **Post:** idea → draft → posted → measured. A post can also end skipped, killed or failed.
- **Reply:** heard → draft → posted → measured. A reply can also end skipped (with the reason: writer passed, rule, community forbids it, operator skipped, draft went stale) or failed.
- **Comment:** new → seen → answered or dismissed. A comment becomes answered by itself when the match finds the operator's reply under it.

When the operator copies a draft or opens its thread, Influstep stamps `openedAt` on it. The stamp only orders candidates. The match also considers drafts that were never opened, since the operator may find the thread on the platform itself. A draft still unmatched 48 hours after it was written or opened goes back to waiting with a line that asks for the link.

### Match rules (core/match.ts)

The match compares the account's own new items with every draft waiting on that account. The drafts on Reddit and HN are meant to be rewritten, so the match rests on where and when the operator posted. Text similarity only breaks ties.

- **A reply** matches a draft when the operator's comment has the same parent (thread or comment id) and was posted after the draft was written. When several of the operator's comments share that parent, the one with the closest text wins. Similarity is measured on normalized word shingles.
- **A post** matches a draft when it is in the same community, was posted on the draft's day or the day after, after the draft was written, and its title (or, on X and LinkedIn, its first line) is at least a quarter alike to the draft's (`POST_SIMILARITY_MIN`). When several posts qualify, the closest wins.
- An own item that matches no draft is still stored, as posted without a draft. The operator's own posts count in the report too.
- The match stores the posted time, the external id and the URL, and a reply's posted text. On X and LinkedIn it also stores the edit share, and a single post there takes the posted words; a Reddit or Hacker News post keeps its parts, since the item is a title and a body.
- A pasted link is fetched and matched the same way. On LinkedIn the pasted link is trusted as given.

### Tables

| Table | Change |
| --- | --- |
| `workspaces` | Drop `signInRequiredHosts` and `signedInHosts`. Add notifier settings and quiet hours. |
| `personas` → `accounts` | Add `platform`, `externalUserId`, `affiliationLine` and cadence (posts a week, reply budget). Drop `color`, `formats`, `voiceId`, `voiceDescription`, `appearance`, `sponsorRampEpisodes`, `episodesPerWeek`, `autoApprove`, `autoPublish` and `bible` (folded into the voice and the rules). |
| `connections` | New. One row per account that needs OAuth (Reddit in v1): the refresh token, scopes, when it connected, and the last error. It is kept apart from `accounts` so no query that lists accounts ever sends a token to the studio. |
| `pushSubscriptions` | New. One row per device: endpoint, `p256dh` and `auth` keys, a device label, `createdAt`, `lastOkAt`. |
| `episodes` + `publications` → `posts` | One row per post on one account. Keep the concept, hook, pillar, signals, experiment, variant and plan day. Add community, title, parts, `openedAt`, `postedText`, `editShare`, `externalId`, `url` and `postedAt`. Drop the shot plan, shots, renders, format, description, footer and discount stamping. |
| `replies` | Generalize from X: thread URL, community, parent id, draft shape, `openedAt`, `postedText`, `editShare`. Origin adds `comment` (answering a comment on the operator's own item). Drop `queued`, `sending` and `dispatchedAt`. |
| `comments` | New. Account, platform, the post or reply it answers (or none for a mention), external id, author, text, URL, time, status, `notifiedAt`, answer reply id. |
| `communities` | New. Account, name, rules text, self-promotion allowed, weight, `rulesReadAt`. |
| `notifications` | New. Kind (comment, digest, thread took off), the rows it names, channel, `sentAt` and error. It is the log the notifier dedupes on. |
| `accountPosts`, `accountCounts` | Keep, generalized to every platform's history for learning the voice. |
| `metricSnapshots` | Keep. One row per read of a post's or a reply's numbers, as its platform counts them: score and comments on Reddit and Hacker News; impressions, likes, replies, reposts, profile visits and follows on X. The post or reply keeps its latest read. Clicks come from tracked links and signups and paid from conversions, so a snapshot holds neither. |
| `accountSnapshots` | New. One row per read of an account's karma or followers: the report's reach line. |
| `signals` | Keep. Sources: `hackernews`, `reddit`, `x`, `search`, `comments`, `problems`. Drop `google_trends` and `youtube_search`. |
| `experiments`, `journal`, `memories`, `directives`, `messages`, `checklistItems`, `links`, `linkClicks`, `conversions` | Keep. Swap `personaId` for `accountId` and episode ids for post or reply ids. Checklist actions become "connect account" and "set key". A conversion's `via` loses `code`. |
| `jobs` | Keep. Drop `runsOn` and `aliveAt`. |
| `assets`, `generations`, `runners`, `discountCodes` | Drop. There are no discount codes (decision 4). |

No production data exists, so this needs no migration code. Locally: reset, push, then seed a new demo, as CLAUDE.md describes.

## Jobs and crons

| When | Job | Role | Writes |
| --- | --- | --- | --- |
| hourly | `listen` (per account) | researcher | heard replies with their reply test variant |
| after listen | `write_replies` | writer | reply drafts within the reply budget |
| every 10 min | `match` (accounts with waiting drafts) | analyst | posted posts and replies |
| every 10 min | `poll_comments` (items posted in the last 7 days) | researcher | comments, answer drafts, notifications |
| every 6 h | `pull_metrics` | analyst | snapshots, account karma and followers, conversions, decisions |
| hourly | `poll_signals` | researcher | signals |
| daily 06:15 UTC | `morning_sweep` | researcher | brief, problem log, morning digest |
| daily 07:30 UTC | write due posts | writer | drafts for tomorrow's posts |
| Monday 06:30 UTC | `review_strategy` | analyst | community and pillar weights, defaults, experiments, journal |
| Monday 07:00 UTC | `plan_week` | writer | next week's post ideas |
| daily 03:00 UTC | age out signals, mark stale drafts | — | — |

These jobs stay: `import_history` (renamed from `import_x_history`, every platform), `learn_voice` and the chat tasks.

These jobs go: `produce`, `publish`, `post_reply`, `open_browser`, `design_voice`, `generate_media`, and the dispatch crons.

Polling cost is the reason for the 10-minute intervals. Hacker News and Reddit are cheap at that rate. X costs money per read, so its intervals follow the tier chosen at setup.

## Experiments, strategy and next steps

**Dimensions.** These stay:

- reply style: tip, question back, own story;
- hook, for posts;
- posting time, for posts (the video plan's publish time);
- post kind: question about a problem, how-to, story, show (Show HN or a demo).

These change:

- reply target: on Reddit and HN, a new thread (under two hours, few comments) against a rising one; on X, peers against big authors;
- sponsor mention: never, against a mention with the affiliation line where the community allows it.

These are new:

- reply length: one or two sentences, against a paragraph or more;
- call to action on posts: ends with a question, against no question.

These go: concept, video length, video CTA, description format.

**Goal metric ladder:** paid, signups, clicks, then the platform's reach (CONTEXT.md, "Reach"): impressions on X, points on Reddit and on a Hacker News story. A Hacker News comment has no reach, because HN comment scores are not public, and LinkedIn's numbers are not read. Unsponsored drafts are judged on reach. That is the honest version of growing karma and followers: helpful drafts, measured.

**Strategy review.** It keeps today's rules (pillar weights, publish hours, re-tests). It adds community weights: more drafts where the account earns more reach and clicks per item, fewer where it earns nothing. A community that removed a comment or banned the account drops to zero and becomes a checklist item.

**Next steps.** These are rule-based and derived on read, at most three:

1. comments waiting on the operator;
2. a thread the operator took part in that is taking off;
3. a draft that has waited too long;
4. an experiment one exposure short of a decision;
5. what the latest decision changes.

Each step names its numbers. The LLM only phrases the morning digest.

**Small samples.** A person posts maybe 5 to 20 items a day. Decisions come slowly. The experiments page says how many exposures each variant still needs.

## Attribution

- **Reddit and Hacker News:** drafts link to the sponsor's site directly, with UTM parameters (`utm_source=reddit`, `utm_medium=community`, `utm_content=<draft slug>`). Redirect and shortener domains get filtered or distrusted there.
- **X and LinkedIn:** use `/go/:slug`, which counts clicks exactly (decision 6).
- **Readers who search for the sponsor instead of clicking** are likely the majority. Influstep reads PostHog's first referring domain (reddit.com, news.ycombinator.com, linkedin.com, t.co) and an optional `heard_about_us` event from the sponsor's signup. These count as probable conversions, reported apart from UTM conversions and labeled so.
- The PostHog reader stays. Discount codes and the Polar reader go (decision 4).

### What the product must emit

Influstep reads the product's PostHog project. For the full funnel the product sends these events with the person's `$initial_utm_*` properties intact; a product that sends fewer events shows the missing steps as zero.

| Event                  | When                                            | Properties          |
| ---------------------- | ----------------------------------------------- | ------------------- |
| `demo_started`         | the visitor tries the product before signing up | `demo`              |
| `signed_up`            | account created                                 | `provider`, `app`   |
| `trial_started`        | a paid trial begins                             | `plan`              |
| `subscription_started` | first successful payment                        | `plan`, `interval`  |
| `heard_about_us`       | the person answers "where did you hear about us" (optional) | `answer`, the person's words or the option they chose |

Influstep names a platform from `answer` by its words (Reddit or an r/ name, Hacker News or HN, X or Twitter, LinkedIn); an answer that names another place, or two platforms, is no probable conversion. A person with no initial UTM source who sends no `heard_about_us` still counts when their `$initial_referring_domain` is one of a platform's domains.

Two caveats the report states on screen. PostHog behind a consent banner undercounts UTM-attributed numbers; tracked-link clicks are exact and consent-independent. Attribution is first touch.

## Studio screens

- **Today (home).** From the top:
  1. comments waiting, each with its drafted answer;
  2. reply drafts ranked by freshness and fit, within the budget;
  3. posts due today;
  4. next steps;
  5. failures and checklist.

  A week strip replaces the calendar.
- **Draft card.** Open thread · Copy · I posted it (optional link) · Edit · Skip. HN drafts show talking points, not a paste button.
- **Posted.** Matched items with their numbers, edit share and comment thread.
- **Account page** (replaces the persona page). Chat, communities with their rules, voice, strategy, memory, report.
- **Experiments, Reports, Signals, Checklist, Providers, Agents.** Kept and retargeted. Providers shows each platform reader's capabilities, the web push devices and the last push error.
- **Setup.** The product step stays as it is. Then the operator connects any number of accounts: a handle for Hacker News, X and LinkedIn, and Connect Reddit for each Reddit account. Each account gets its communities and its affiliation line. Onboarding's look, voice and format steps go. "Add account" in the sidebar runs the same step.
- **Removed screens:** episode page (replaced by post page), assets, publish package, script editor, format fields, link-in-bio page.

## Changes checklist

Every slice ends the same way:

1. Run `pnpm quality:fix`, `pnpm quality:check`, `pnpm test` and `pnpm knip`.
2. Run `$cleanup` and the maintainability review (`review`) on the slice's changes, and act on what they find.
3. Reset, push and seed the local backend.
4. Smoke test the new screens in Chrome.
5. Update the plan's Progress.
6. Commit with explicit paths.

### Before slice 0

- [x] Commit the Setup work in progress on its own first (7978fcd). That work is about 40 modified files plus the new `setup.tsx`, `product-fields.tsx` and `shared/workspace.ts`. It touches `docs/plan.md`, `PRODUCT.md`, `CONTEXT.md`, `onboarding.tsx` and `providers.tsx`, which slices 0 and 1 rewrite. CLAUDE.md rules out stash and reset, so this commit is the clean starting point.

### Slice 0: decision and docs

- [x] ADR 0004: the operator posts by hand; video and the runner are removed; one platform reader per platform; no extension in v1. Mark ADR 0001's runner half as superseded.
- [x] `PRODUCT.md`: what it is, who uses it, principles (the operator posts, affiliation stated, community rules win, nothing silent), surfaces.
- [x] `CONTEXT.md`: the glossary changes above.
- [x] `docs/plan.md`: replaced by this plan. The video history stays in git.
- [x] `DESIGN.md`: the overview, the status tints and the identity rule. Each slice rewrites the screens and components it changes, so the video screens leave it with slice 1.
- [x] `CLAUDE.md`: what Influstep is now. The runner commands and notes leave with the runner in slice 1.

### Slice 1: remove video and the runner

"Influstep never posts" becomes true in this slice. Without the runner nothing can publish, so a written post or reply waits for the operator as a draft, and an "I posted it" action with an optional link marks it posted: slice 5's manual match in its smallest form. Two commits, each green: video, the runner and discount codes out (the codes were too tangled with the video paths to leave on their own), then the mascot and persona colors out.

- [x] Status machine for posts and replies: idea (posts) or heard (replies), draft, posted, measured, skipped, killed (posts), failed. Only a draft waits on the operator.
- [x] Post kinds become text and thread: an image post needs the producer to render its card. The post kind variants, the planner's rotation, the cadence validator, `postProblems`, the card preview and the seed follow.
- [x] Platforms become X only until slice 3. A persona's format keeps only `platform`, `publishHour` and the cadence; slice 2 moves them onto the account.
- [x] `publications` fold into episodes: `parts`, `url`, `externalId` and `postedAt` on the episode. The bio link and per-publication tracked links go with `/p/:handle`; per-draft links come in slice 11.
- [x] Replies: the auto-send for engaged-first posts, `queued`, `sending`, `dispatchedAt` and the dispatch cron go with `post_reply`.
- [x] Reports, strategy, what works and the goal metrics lose their video branches only; slices 9 and 10 redesign them.
- [x] Root `package.json`, turbo and the workspace drop the runner; `pnpm dev` still boots.

- [x] Delete `apps/runner` and the root `dev:runner` script. Remove the runner from the workspace and turbo config.
- [x] Convex: delete `core/assets.ts`, `core/media.ts`, `internal/media.ts`, `internal/runner.ts`, `private/assets.ts`, `private/media.ts`, `private/publications.ts`, `providers/media/` and `providers/comments/youtube.ts`.
- [x] Convex: delete the runner routes in `http.ts`; the file goes if nothing is left. Delete `RUNNER_TOKEN` from `lib/env.ts`, `private/providers.ts`, `.env.example` and `scripts/local-convex.ts`. Only the runner uses it; the worker calls public functions, and the `/links/*` routes that `.env.example` mentions do not exist.
- [x] Convex: delete `assets.integration.test.ts`, `media.integration.test.ts` and `script.integration.test.ts`. Delete the video cases in `pipeline.integration.test.ts`. `voice.integration.test.ts` stays: it holds the X voice tests, not the spoken voice.
- [x] Convex: cut the video paths from `core/episodes.ts`, `core/formats.ts`, `core/attribution.ts` (the footer), `core/research.ts` (tool-broke problems), `core/experiments.ts` (video dimensions), `internal/agents.ts` (write script, poll video comments) and `internal/schedule.ts`.
- [x] Convex: in `schema.ts`, drop `assets`, `generations` and `runners`, the video fields on personas and episodes, and `jobs.runsOn` and `jobs.aliveAt` with the `by_runtime_status` index.
- [x] Convex: drop the job kinds `produce`, `publish`, `post_reply`, `open_browser`, `design_voice` and `generate_media`, and the dispatch crons.
- [x] Shared: delete `appearance`, `assets`, `beats`, `media` and `publications`, and the runner payloads in `jobs.ts`. Cut `formats.ts` down to the cadence. Drop the video kind in `episode-kinds.ts` and `episode-status.ts`, and the disclosure lines in `platforms.ts`.
- [x] Studio: delete `personas.$personaId_.assets.tsx`, `p.$handle.tsx`, `publish-package.tsx`, `script-editor.tsx` and `lib/assets.ts`. `format-fields.tsx` stays as the X cadence form, and `length-mix-bar.tsx` stays for the X voice page. Cut the video steps from `onboarding.tsx`, the video view from `episodes.$episodeId.tsx`, and the runner status from `__root.tsx`, `providers.tsx` and `use-runner-online.ts`.
- [x] Worker: drop `/p/:handle` and `bioPage`.
- [x] Discount codes (decision 4): delete `core/discounts.ts` and its test, `providers/discounts/`, the `discountCodes` table, the chat's give-code change, the code fields in the persona settings and the episode page, redemptions in the report, `via: 'code'` on conversions, `discountCode` in the PostHog reader, and the `POLAR_*` keys.
- [x] Mascot and persona colors (decision 5): delete `persona-avatar.tsx`, `mascot-motion.ts`, their tests, shared `persona-colors.ts` with its tests, and `personaColorValidator`. Every avatar becomes the account mark (the platform's logo) beside the name or the handle.
- [x] Seed: remove the video data and the discount codes.

### Slice 2: persona → account, episode → post

This slice is mechanical.

- [x] Rename tables, ids, validators, functions, routes (`/accounts/$accountId`, `/posts/$postId`), components and copy.
- [x] Fold the remaining `publications` fields into `posts` (slice 1 did). An account has one platform: `platform`, `publishHour` and `cadence` sit on the account.
- [x] Codegen. Tests green with no behavior change.

### Slice 3: platform readers

The platforms grow from X to Reddit, Hacker News, X and LinkedIn in this slice, and the setup asks which of the operator's own accounts it is (platform, handle, name) instead of having the writer invent one; the readers read the account by that handle.

- [x] `providers/platforms/types.ts`: a `PlatformReader` with a capability per method. A deterministic mock per platform.
- [x] Real Hacker News reader (Algolia and Firebase). An HN account is its username.
- [x] Real Reddit reader. It uses an OAuth web app: `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET` and `REDDIT_USER_AGENT` on the deployment, plus one refresh token per connected account in `connections`. Connect Reddit sends the operator to Reddit's consent page with the scopes `identity`, `read`, `history` and `privatemessages`. A Convex HTTP route (`/oauth/reddit/callback`) stores the token and returns to the account page. A revoked token becomes a checklist item to connect again.
- [x] X and LinkedIn readers have no capabilities in v1 (decision 3), so every step is manual: pasting a thread, pasting the posted link, and typing counts or leaving them out. The X archive import stays, so the voice can still be learned.
- [x] Remove `providers/signals`, `engagement`, `timeline` and `comments`. Point the researcher, the listener and the history import at the readers.
- [x] Providers page: one row per platform with its capabilities and keys.
- [x] Checklist: "Connect your Reddit account" and similar.
- [x] A `classifier` provider for the listener (relevant or not, intent, reply-worthy, a score with its confidence), with a mock and a Claude Haiku adapter. Typesafe's Jev, a fast schema-bound decision model (early access, hosted only, unbenchmarked in public), is a candidate second adapter: switch to it only after it matches Haiku on about 200 of the operator's labelled threads (operator, 2026-10-22).

### Slice 4: reply loop on every platform

- [x] `communities` table. The listener reads a community's rules when it first meets it and re-reads them weekly.
- [x] Listener per account on platforms with search (Reddit and HN in v1). Generalize `replies`: thread, community, parent, origin `comment`.
- [x] Paste a thread (X and LinkedIn): the link and the text to answer become a heard reply, and the writer drafts it.
- [x] Writer: draft shapes per platform, the voice, the affiliation line and the community rules in the prompt.
- [x] `core/disclosure.ts`: the six ground rules, with tests. Store refuses, rewrites once, then skips with the reason. The sponsor dial caps mentions over seven days.
- [x] Drafts list with Open thread, Copy, I posted it, Edit and Skip. Copy and Open stamp `openedAt`.
- [x] Remove the X-only automation rules that remain (the engaged-first auto-send goes in slice 1).

### Slice 5: match

- [x] `core/match.ts`: candidates from every waiting draft, parent and time first, similarity as the tie-break, edit share on X and LinkedIn only. Tests cover a fully rewritten Reddit reply, two of the operator's comments under one parent, a post without a draft, and a draft never opened from the studio.
- [x] `match` job and cron. A pasted link is fetched and matched. LinkedIn trusts the link.
- [x] The writer reads the account's last five posted texts on every platform, and the average edit share on X and LinkedIn.
- [x] A draft unmatched 48 hours after it was written or opened goes back to waiting and asks for the link.

### Slice 6: comments and notifications

- [x] `comments` and `notifications` tables. `poll_comments` for items posted in the last 7 days, plus mentions.
- [x] Each new comment gets an answer draft, a reply with origin `comment`. When the match sees the operator's reply under a comment, that comment is answered.
- [x] The notifier provider. The mock records a row; the real adapter sends web push from a Node action with `web-push` and the VAPID keys. Batched within 10 minutes. Quiet hours.
- [x] Studio: the manifest, the icons, `public/sw.js` (show the push, focus or open on click), and the "Turn on notifications" button with the iOS Home Screen line.
- [x] `pushSubscriptions` with subscribe and remove mutations. A 404 or 410 deletes the subscription. Providers lists the devices.
- [x] The VAPID keys go in `.env.example`. `scripts/local-convex.ts` generates a local pair.
- [x] An in-app notification list on Today, which is all that shows in mock mode.
- [x] The morning digest as a push.
- [x] The problem log reads repeated questions in comments, as today.

### Slice 7: Today

- [x] The Today page as described above. The week strip replaces the calendar route.
- [x] Sidebar: each account as its platform logo and handle, with what waits on the operator, and Add account.

### Slice 8: post loop

- [x] The planner and the writer for posts per platform and community: Reddit and HN titles, Ask HN and Show HN, X threads, LinkedIn posts.
- [x] Post kinds, including the pain-point question.
- [x] Just-in-time drafts and the last check, kept.
- [x] Chat changes retargeted to posts.

### Slice 9: metrics and reports

- [x] Per-platform counts. Account snapshots with karma and followers.
- [x] Measurement window: 7 days for replies and posts.
- [x] Report: the reach line (karma and followers), the funnel from reach to replies, clicks, signups and paid, and the posted items. Every number says its source.

### Slice 10: experiments, strategy, next steps

- [x] The new dimension catalog and goal metric ladder, with tests.
- [x] Community weights in the strategy review. A removal or ban zeroes the community and opens a checklist item.
- [x] Next steps on Today.

### Slice 11: attribution

- [x] UTM per draft on direct sponsor links for Reddit and HN. `/go/:slug` for X and LinkedIn.
- [x] Probable conversions from the first referring domain and `heard_about_us`, reported apart.
- [x] Update "What the product must emit": add `heard_about_us`.

### Slices 12 to 15: what the pivot left for later (operator, 2026-10-23)

- [x] Slice 12, the debt: the experiments form offers only what a dimension can be decided on; the mock brings Reddit and Hacker News posts their own conversions; a `heard_about_us` answer with a one-letter typo still names its platform; half a Reddit sweep keeps to the account's subreddits; the seed's data apart from its steps.
- [x] Slice 13: one handle can be an account on two platforms; conversions match on the handle and the platform together.
- [x] Slice 14: the posting time dimension.
- [x] Slice 15: how a post or a reply went out, one `posted` field instead of five optional ones.

### Slice 16: a forum as a fifth platform (operator, 2026-10-23)

The operator asked to take part on product forums such as the n8n and Zapier communities, as a full platform rather than a signal source only.

- [x] `forum` platform: an account is the operator's username on one forum, found at setup from any of its addresses. Its links, its handle and its utm_medium (the forum's host) are read against that forum (ADR 0003 amended).
- [x] A forum's categories are its communities, placed, weighed and swept like subreddits; drafts are rewritten in the operator's words, as on Reddit.
- [x] The Discourse reader: search, the account's topics and replies, the comments under them, their reads, likes and replies, the account's likes, and each category's rules from the forum's guidelines. A forum on other software reads nothing.
- [x] The match finds a reply to a topic posted under any post of it; a comment is said where its item was when the reader does not say.
- [x] Studio: the platform chip and the forum address in setup, the forum named on every page that has the account.

### Slice 17: a new operator knows what to do first (operator, 2026-10-23)

The operator asked whether a new user knows what to do. The read found the setup clear and the days after it thin: a new Reddit or forum account planned no post for up to two weeks without a word, Today had nothing to say on day one, the welcome sent the operator to a Providers page field that does not exist, and a missing key reached the screen as "Server Error".

- [x] A Reddit or Discourse forum account's first plan, which waits for a community the listener has met, is made once a sweep (or a pasted thread) has stored the communities it met, and again once the operator looks at the only community that removed something. Where an account's posts can go is one shared rule (`postPlacingOf`): anywhere from the start, only in a met community, or nowhere on a forum Influstep cannot read. The writer's plan, Plan this week, the account page and the setup say why an account plans no post. Today's Plan this week plans every account that can in one request and counts the ones that do not.
- [x] A new account's first checklist items: its bio on its profile, with the page that edits it, and its voice where its own posts can come in, closed once the voice is learned and opened again when Clear history takes it.
- [x] A next step, and so the morning digest, asks for a new account's first post while nothing of it has gone out.
- [x] The welcome says where keys go and which one real mode lacks; a missing key is refused by name; the setup's hints say what the handle, the pillars, the bio, the affiliation line and the sponsor dial do.

### Slice 18: what worked in the niche (operator, 2026-10-23)

The operator asked for posts that repeat what did well ("someone asks anything and gets nice engagement: Influstep checks it and proposes an experiment to post similar things") and for one post that gathers similar questions and answers them, on Reddit, X and the rest.

- [x] Standouts: among the unused thread signals, the ones that moved at least twice the median of the others of their source. Round-ups: at least four questions whose topics name one pillar. A thread that names the sponsor is in neither: it is one to answer.
- [x] A post's basis: the standout it is modeled on, or the questions it rounds up, kept on the post. The writer takes a standout's topic and shape, never its words (a draft that repeats more than half of it goes back), and answers a round-up's questions from the account's own work, naming no one who asked.
- [x] The Post model dimension: As planned against Modeled on what worked. It starts only once something stood out; under a test a modeled post takes the next standout, and with none left the turn goes to the control. A post counts under the variant it is, and the analyst stops a test whose modeled variant got nothing for 14 days. Today proposes the test while the account is free to run one.
- [x] A weekly round-up in the first evergreen full post that answers, tells or shares (on X a thread), never on Hacker News. Only evergreen posts are drawn from what worked: a reactive post keeps its signal.
- [x] The post page shows what a post is drawn from.

Not built, by the ground rules: two of the operator's accounts staging a conversation, one asking and another answering with the sponsor (rules 2 and 5; Reddit and X ban it as coordinated inauthentic behavior). The honest form already exists: an account asks a real question in its own name and answers it later with its affiliation line.

### Slices 19 to 21: guiding toward more users (operator, 2026-10-23)

The operator asked for every idea that brings engagement or exposure, and that Influstep always guide toward more users: "posting consistently, analytics focused, experiments". Built in three slices, on the mechanisms already there.

Slice 19, what the numbers say next:
- [x] Consistency: each account's posts due this week (at their hour) against the ones that went out; a next step once it fell behind, the week on the account page, four weeks on the report.
- [x] The leak: the funnel step whose rate fell under 60% of the 28 days before, or let nothing through, read against the account's own previous window, since reach is counted differently on each platform and most workspaces have one account per platform. The click step reads only posts with a tracked link. Today and the report say whose it is to fix; a click leak aims the strategy review at a hook or call to action test it can decide past reach.
- [x] The growth line: each account's signups and paid of the last seven days against the seven before, with the test it runs, at the bottom of Today, and last calendar week in the Monday digest.

Slice 20, reach:
- [x] A push for a rising thread: kept, under two hours old, five comments or more at ten an hour.
- [x] A bio link per account, with `utm_campaign=bio`, on the bio checklist item and the account page.

Slice 21, content:
- [x] What brought users, reworked: another account's post on another platform with the most paid, then signups, reworked once a week in an evergreen post.
- [x] Open problems keep their score and do not age out, so each gets a post while it is open.
- [x] A launch: one post per account on the day the operator picks, a Show HN on Hacker News, only where community rules allow self-promotion elsewhere.

### Slice 22: the judge (operator, 2026-10-23)

The operator asked for an agent that judges each post before it goes out: "why should someone comment, like, read and follow", with good reasons for people to engage, "not why we should post it", and not from how other posts did but from "how we think human brain works".

- [x] A fourth agent, the judge, reads every written post as one of its readers would and answers why they would read on, comment, like and follow, each naming what in the post gives it, or none.
- [x] A post engages with a reason to read on and to comment, and to like or to follow. When a post's first judgment falls short, the post goes back to the writer at once with what is missing; a later judgment only says so.
- [x] The operator's edit is judged again and never sent back; a judgment that fails leaves the draft as it was.
- [x] The post page shows each answer and the fix; the post card says what readers have no reason to do.

### Later

- [ ] The X real reader, once the tier is chosen (decision 3 stands, operator, 2026-10-23).
- [ ] The Chrome extension (its own ADR); still not needed (operator, 2026-10-23).

Roughly a quarter of today's code is deleted. Most of the rest is renamed or generalized: signals, research, the listener and replies, experiments, strategy, memory, the journal, chat, the checklist, attribution, PostHog and the reports carry over.

## Decisions (operator, 2026-10-22)

1. **Notifications are web push** from the studio, to the phone and the laptop.
2. **Only the operator's own accounts**, and any of them can be connected: several platforms, and several accounts on one platform. There are no other people in the workspace.
3. **X runs by hand in v1**, like LinkedIn, until an X API tier is chosen.
4. **No discount codes.** The codes, Polar and redemptions go.
5. **An account shows as its platform's logo and its handle.** The mascot and the persona colors go.
6. **Short links stay:** `/go/:slug` on X and LinkedIn, and direct UTM links on Reddit and HN.

## Progress

- Before slice 0: done (7978fcd).
- Slice 0: done (206397f). Docs only, so `$cleanup` and the review had no TypeScript to read.
- Slice 1: done (fd41168 video, the runner and discount codes out; cfeaa64 the mascot and persona colors out; 802571b the cleanup; 7e37d16 the review). Tests went from 539 to 336: the video, runner, discount-code and mascot suites left with their code, as did the tests of the dead goal-metric and publish-hour helpers. Smoke-tested on the seed: a draft and a reply each marked posted, edited and with an X link, a non-X link refused as typed, and Skip from the post page.
- Slice 2: done (81de8a3 a post's parts flattened; ded4f4d persona to account and episode to post; 30d597a one platform per account; 2e9f6aa `internal/agents.ts` split into researcher, writer, analyst and chat; 094453f the copy; c26641c the cleanup; d7f79cb and d913ee7 the review: a job's weekStart and topic became typed columns in place of its payload, and each agent module owns the reads only it uses). Tests went from 336 to 335: the beat URL helper's test left with the helper. Smoke-tested on a reseeded backend: plan_week, poll_signals, poll_comments, pull_metrics, review_strategy and a rewrite's write_post ran to done, a research brief asked in the chat came back, and the onboarding cadence fields and the voice page render.

- Slice 3: done (d759da6 four platforms; 3fd0195 the setup asks for the operator's own account; e5dccdb one platform reader per platform; 87fe8b1 the Hacker News reader; 449b0a8 the Reddit connection; 681a9ba the connected Reddit reader; 7f0f6f1 the classifier; 45786c5 the cleanup; 2f31b14 the review). Tests went from 335 to 364 (449b0a8 and 681a9ba say 365 and 370 in their messages; they had 353 and 356). Smoke-tested on a reseeded backend: a Hacker News and a Reddit account created through the setup, a dotted handle refused for Hacker News, Reddit's connect item without a checkbox and Connect in mock mode, the history import and the comment poll through the readers, a listener sweep with the classifier's read on each reply, and the Providers page's reader rows. The Hacker News reader read a public account live once.
- Slice 4: done (e427013 a reply answers a thread on any platform; ed80fe5 the listener searches Reddit and Hacker News; 79246f6 communities and their rules; 97eacae a connected Reddit account's mentions; b3fd1b0 each platform's draft shape under the ground rules in `core/disclosure.ts`; 16a6a30 paste a thread; 89bc4a6 the drafts with Open thread and Copy; ae8b570 the copy; cad0262 the cleanup; c390e6e, edb53fb, a243505 and 9a37569 the review). The review found the dial passed when one sweep wrote several drafts naming the sponsor, a pasted thread waited behind the day's budget and was written without its community's rules, a pasted Reddit comment link answered the post above it, and a pasted thread was stored as written by "someone" with no reach and the paste's time. Tests went from 364 to 382. Smoke-tested on the local backend in mock mode: a Hacker News sweep that read the guidelines once and wrote talking points, a Reddit sweep that read its communities' rules, a LinkedIn paste, a pasted Hacker News thread shown without an author or a time and first under Waiting for you, and an X sweep within the day's budget.
- Slice 5: done (85ff33a a reader's items say what they answer, their link and community, and since when; 0828c0e the match rules; 5ae68eb the match job; e6b1443 the writers read what went out; a354e37 the cleanup; 6848d74 the review). The review found that a reply marked posted without a link went back to waiting on a check the schedule never reached, and over replies the match had never looked for; that a post matched any post of the operator's planned day; that an item could be stored both on a draft and as posted without one; and that the match could overwrite a link the operator gave meanwhile. So, against the plan's words: only a draft waits again (a reply marked posted stays posted, and the match fills in its id when it sees the comment); a draft the operator opened asks for its link after two days and goes stale after a week, one never opened after a day; a post is found by its link only; every item a reader lists joins `accountPosts`, and a reply or post points at its item by id, so "posted without a draft" is an item no draft points at; the job reads the platform, then one mutation matches and stores. A reply's and a post's text stay "the draft, then what went out" instead of a separate `postedText`. Tests went from 382 to 396. Smoke-tested on the local backend in mock mode: the match ran from the cron and by hand on the Hacker News and X accounts without errors; the mock reader cannot know what the operator posted, so no draft is matched there, and the integration tests drive the rules with chosen items.
- Slice 6: done (c29c175 the comment poll and its answers; 2eb8a48 the notifier, notifications, quiet hours and the digest; 3558316 the installable studio, the button, the devices and the list; 09e4cb8 the cleanup; b0af814, 0136e26 and b3b2536 the review). The review found that a comment could lose its answer for good when the pass that first stored it failed, that comments under the operator's own posts lost their community, that a night's comments woke the operator with one push per poll, that the digest went out at 06:30 UTC whatever the timezone, and that a device removed during a push sent it again to every device. So: every poll drafts answers for each waiting comment that has none, from the stored rows; a comment keeps the community the platform names; a comment notification held in the quiet hours takes in the later ones; the digest goes out at 07:00 in each account's timezone. Against the plan's words, a comment is new, answered or dismissed: its status follows its answer (a draft passed on or gone stale lets it go), there is no "seen", and one first read after it is too old to answer is let go at once. The listener only searches; mentions come with the comments. A thread under the account's own post that asks about the sponsor is answered under the ground rules instead of being passed on. The local Convex container calls itself back through the host's port (`docker-compose.yml`), since a Node action reaches the backend at its public origin. Tests went from 396 to 407. Smoke-tested on the local backend in mock mode: the comment poll from the cron, answer drafts written first, the digest recorded without a push, quiet hours set and turned off on Providers, `/sw.js` served, the notification list on the calendar. No push reached a real device: the web-push path is tested with the push service stubbed (a device that takes it, one gone, one failing, a missing key).
- Slice 7: done (8b66c5d one reply editor; c5529d4 Today's query and Let it go; 97621d0 Today replaces the calendar; 4ed35d3 the sidebar by handle; 9297f24 an account's handle and platform fixed, the demo's X handles valid; da60260 the cleanup; e9c22ad and 3c93fed the review). The review found that a comment let go while a poll judged it came back with a draft, that Today picked its drafts by origin (missing a mention's draft with no comment row, showing a pasted reply to a waiting comment twice), that a comment no answer reached waited forever, and that Today read every post of every account to find the failed ones. So: a pass stores no answer for a comment that no longer waits; every draft shows once, an answer with its comment; a comment past its freshness with no answer is let go at the next poll; Today reads the failed posts and the checklist by status. A waiting comment says where its answer stands, the ones closest to going cold first. Tests went from 407 to 410. Smoke-tested in the studio on the local backend in mock mode: Today with its comments, drafts, posts due, notifications, the week strip and the overview, and the account settings saved without the handle and the platform. The local data keeps its dotted X handles until a reseed.
- Slice 8: done (b68dfdf each post planned where it goes, under that place's rules; 480fc0c each post written in its platform's shape and limits; 53f7c14 a post card says where the post goes; 421ea73 a post found without a link; a32cbf6 the cleanup; 36ef393, 90e4408, 6dee89e, 03df2c6 and 15b3fcc the review). The review found that the plan chose the sponsored slots before placing them, so a sponsored slot on Ask HN or in a subreddit that forbids self-promotion lost the sponsor and the week fell short of the dial; that the talking-points rule held the words the operator posted on Hacker News; that a subreddit whose rules were read again after the plan still got the sponsor; that the sponsor check read the title on X and LinkedIn, where no title is posted; that a post found on X kept the drafted words; that the match never ran on an account with only a post draft waiting, and read every draft in the workspace; that "Waiting on you" told the operator to post Reddit bodies and talking points as they stand; and that the settings form hid a thread listed on a platform other than X, then refused to save it. So: each slot is placed first and the sponsor goes to the slots whose place allows it, shows first; the writer is held to its shape and what is posted to the platform's rules; the writer checks the place again before it names the sponsor; the match stores a single X or LinkedIn post's posted words, and looks while a post draft waits. Against the plan's words, a Reddit post goes only to a subreddit the listener has met, so a new Reddit account plans nothing until its first sweep, and says why. Tests went from 410 to 420. Smoke-tested on the local backend in mock mode: a week planned for an X account, 6 of 14 slots with the sponsor and none on a question or a one-liner; a Hacker News idea written as an Ask HN title with talking points; the post page with its place, its title, the talking points and what to do with them.
- Slice 9: done (bbb7851 each platform's numbers for what went out, and the account's karma or followers; e3cc2a6 the reach line, the funnel from reach and the Posted page; 4ad1648 Today on the studio's clock; d2bc6d2 the cleanup; bbcdc29 and cd0fe20 the review). The review found that Today asked again every minute and unmounted the drafts being edited while the answer loaded, that the post page read every snapshot of the account since the post went out, that every screen with a funnel read four weeks of snapshots it threw away, that a number nothing read showed as zero (LinkedIn's reach, a Hacker News comment's points, an account's comments), that the trend counted the whole reach of items posted before the window on its first day, that the mock read numbers the real readers cannot, and that a comment notification opened the Posted page without scrolling to its item. So: a post or reply keeps its last read with when and whether it was mock, and only the account report reads snapshots; a number not read is null and shows as a dash, with why; the trend counts only the window's items; Today moves its clock by the hour and keeps its last answer. Against the plan's words, the report counts posts and replies, and what the operator posted without a draft is listed on the Posted page but not measured. Tests went from 420 to 428. Smoke-tested on a reseeded backend in mock mode: a metrics pull on an X account read five items and its followers, and the account report, the workspace report, the Posted page and Today rendered; the Hacker News and Reddit paths are proven by the integration and reader tests, not in the browser, since the seed has X accounts only, and Hacker News's public API was read once to check the shapes the reader expects.
- Slice 10: done (2ec32cc the dimension catalog and the goal metric ladder; 0c47198 community weights, removals and the next steps; 108af06 every waiting draft makes room in the sponsor dial; 8ddb2e7 the cleanup; 0ba30c4 the review). The review found that a test could be decided on items still in their window, on clicks that came weeks after, or on a lucky early lead read every hour; that a reply test on Hacker News, where a comment shows no points, would never end; that a hook test could put every sponsored slot in one variant; that a post kind variant could be planned into a place that changed its kind; that a second decided post kind undid the first's swap; that ideas kept an ended experiment's variant; that community weights were reviewed on platforms whose planner never reads them, and scored on replies, which bring no clicks; that a removal took a community away for good, while the listener kept answering there; that "taking off" read every snapshot of the account for each reply; that an experiment was "near a decision" while its other variants were far short; and that three accounts with comments left the digest no next step. So: only measured items within their window count, a test is read once at its floor with a two-sided Welch t test and a minimum of events, and one with no clear winner stops; reply dimensions and post kinds are decided on reach; hook and call-to-action variants are balanced within the sponsored and the plain slots; a post read keeps the counts of the read before. Against the plan's words, a removal marks its community removed instead of zeroing its weight: the plan and the listener leave it out until the operator ticks off the checklist item, which takes it back; community weights are reviewed on Reddit only, over posts. Tests went from 428 to 443. Smoke-tested on the local backend in mock mode: Today lists the next steps, the experiments page's query lists the running reply test, and a second metrics pull on an X account stores the counts of the read before.
- Slice 11: done (09e6fa2 a sponsored post carries its link; 8004145 no clicks counted where a post links directly, and subreddits weighed by signups; 8619e75 probable conversions; d15cd8b `heard_about_us` and ADR 0003 amended; 64d9d02 the cleanup; f4ec95d, 5ba569d and e9ac16f the review). The review found that the workspace report read all accounts' signups as a share of only X's and LinkedIn's clicks; that the PostHog reader stopped at 1000 rows, oldest first, so a busy product's newest conversions were dropped without a word; that every account read its platform's probable conversions again, each read fetching every platform's; that where a link goes was inferred from the draft shape, and the writer's brief held the sponsor twice; and that the "what works" ranking and the pillar review broke ties on clicks a Reddit or Hacker News post never has. So: rates from clicks show only where every click is counted; the reader pages through every row and fails past 50,000; one `pull_probable` job reads the workspace's probable conversions a day; shared `SPONSOR_LINKS` names each platform's link kind and placement, and the brief carries `sponsor: { link }`; ties break on signups per post, and clicks per reach counts only counted clicks. Against the plan's words: the UTM keys stay ADR 0003's (the account's handle as `utm_source`, the platform as `utm_medium`, the post's slug as `utm_campaign`, its variant as `utm_content`) rather than `utm_source=reddit`, `utm_medium=community`; only a post that names the sponsor carries a link, and replies none, so reply tests stay on reach; a Reddit or Hacker News post's clicks show as not counted, a click test there is refused, and the Reddit community weights score signups per post; probable conversions are stored by platform, never an account, read once a day for the workspace. Tests went from 443 to 449. Smoke-tested on a reseeded backend in mock mode: the seeded sponsored X posts carry their `/go/` links, a click redirects with the account, platform and post in the UTM parameters, a written post kept no link when its slot carried no sponsor, the daily pull queued one `pull_probable` job, and the account and workspace reports show "Probably from X" apart from the funnel; the post page shows the link with Copy. The Reddit and Hacker News link paths are proven by the integration tests, since the seed has X accounts only.
- Slice 12: done (c4ea197 the form offers only what a dimension can be decided on; 719b343 each sponsored post its own mock conversions; b4d5f07 a platform's name with a one-letter typo; 071c676 half a Reddit sweep in the account's subreddits; 14ae74b and f259f3f the seed; 4f4720f, 089533e, bdb2385, 380aea1 and fad7607 the review). The review found that the one rule for what a dimension is decided on covered clicks but not reach, so the form still offered reach on a Hacker News reply test and on LinkedIn; that the metrics pull read the mock's visits in real mode for PostHog to throw away; that the platform names sat in two tables; that the sweep's two searches ran one after the other with the split rule in an action; and that the seed's tracked link skipped the platform's rule. So: core `measurableMetrics` says what a dimension can be decided on for the account, and the form reads it through a query; the visits are read only in mock mode; the long names are read with a typo, the short ones only as written; `mixSweep` is pure and tested in core; `sponsorLinkOf` returns a tracked link with its row or a direct one. The listener's sweep keeps half its threads to the account's subreddits weighted above zero and reads all of Reddit for the rest, so it still meets new communities.
- Slice 13: done (4955a4d; 07da7e8 and 8770b39 the review). Conversions are an account's by its handle as `utm_source` and its platform as `utm_medium` together, so a handle is taken only on its own platform, in any case; ADR 0003 records it. Smoke-tested: `ada_automates` on Hacker News was made beside the X account of that handle.
- Slice 14: done (e118536; fcc1d76, 902583a and 6768f27 the review). The review found that a post moved out of the day left its variant's turn uncounted, so one daily post at 22:00 never gave "later" an item and the test never ended; that a winner moved the hour even where the slots then slid back; that ideas kept the moved hour after a stop; that on a platform with no reader of the account's posts the window measured when the operator marked a post; that 90 minutes around variants two hours apart counted one post for either; that the review would test the losing hour again under another name; and that chat and a move kept a moved hour out of the test. So: a whole day moves by one variant, the variants taking the days in turn; a test starts only where every variant keeps every post in the day and the account's posts can be read, and the hours, the posts per day and the timezone stay put while it runs; a post counts only when the match found it within 45 minutes of its hour, and the page says apart how many went out off their hour and how many have no known hour; a stop or a decision puts the ideas back at their slot, moved by the winner; a decided posting time is not tested again within 180 days. Against the plan's words: a decided test moves the account's hour and keeps no default (CONTEXT.md, "Posting time"), and the variants are two hours either way, not three, since a day's posts are three hours apart. Smoke-tested on the local backend: a test on Max planned the week alternating 17:00 and 19:00, moving the hour was refused, and the stop put every idea back at 17:00.
- Slice 15: done (03699ff; 6768f27 the review). A posted post or reply keeps one `posted` field: said with no link, linked, or found by the match, each with the edit share where one was read; the indexes read `posted.at`. The review found no reader left on the old fields; it narrowed `postedItemOf` to the linked or found shape, moved the kept edit share into the match, took out the match time nothing read, and put `wentOutAt` where readers fell back to another time. The post page now names the account's platform in its link. Tests went from 449 to 466 over slices 12 to 15. The local backend was reset and reseeded for the schema change, and the post, replies, Posted and experiments pages render without console errors; a refusal listing three metrics came back worded by `Intl.ListFormat` on the Convex runtime.
- Slice 16: done (545c5f5 a forum account and the mock forum reader; b4a5ba2 the Discourse reader; c28d343 the match and the comments on a forum; d30df03 the review). A forum account is the operator's username on one forum, found at setup from any of its addresses: a public Discourse forum is read through its JSON with no key, a private one is refused, and any other software (the Zapier Community) is run by hand like LinkedIn. The account keeps its forum beside its platform, read as one place (shared `placeOf`), so links, handles and the utm_medium (the forum's host, ADR 0003 amended) are the forum's own. Categories are communities, placed, weighed and half-swept like subreddits. The review found that every sentence about one account still named a forum "Forum", that a pasted topic was drafted without its category's rules (its link names none), that the Discourse id scheme sat in core/match.ts and only one way round, that two queries listed the forums, that the reader read the categories and guidelines on every call and the guidelines outside the rate-limit wait, and that a tracked link's platform was no longer read. So: `PLATFORM_LABELS` names only one-site platforms and a sentence reads the place, the kind or the platform in words; a reader can say where a thread was said; shared `sameThread` reads a topic as one thread both ways; one forums query; one request path; the link column is gone. Against the plan's words: Discourse shows a visitor no mentions, so a forum hears none; a found topic's reach is its first post's likes, a posted item's how many read it. Tests went from 466 to 492. Read live once against the n8n Community (search, the account's posts, their numbers, its likes, the rules of Questions); the first try hit its rate limit, which is why the reader waits and retries once. Smoke-tested on a reseeded backend in mock mode: a forum account made through the setup (the address checked, a handle taken on that forum refused), Listen now drafting replies in categories, a pasted topic drafted under "Questions", the post page naming the forum, the Providers row, no console errors.
- Slice 17: done (5291c48 a Reddit or forum account's first plan once the listener meets a community; afb1806 the first checklist items and the first post's next step; f747da0 where keys go, a missing key by name, and the setup's hints; d25d982 Today's Plan this week in one request; c08e933 the setup's copy for Reddit and forums; 273853f the review). The operator asked whether a new user knows what to do; the read found the setup clear and the days after it thin. The review found that the plan a first community set off would have run while the sweep still read the others' rules, sending two weeks of posts to the first subreddit; that an account on a forum Influstep cannot read was promised a plan that never comes; that a removal the operator looked at ended the wait without a plan; that Clear history left the voice item done; and that a missing Reddit key had its own sentence. The `learn_voice` item stays ticked off by hand, unlike the connect item, since an account with no posts of its own could never close it. Tests went from 492 to 497. Smoke-tested on the seed: a Reddit account added from the sidebar said why it planned nothing, and Listen now met r/n8n and planned its two weeks.
- Slice 18: done (759cdca standouts, round-ups and the writer; 078ccc6 the post model test; a9fff9f the weekly round-up; 55455be Today's proposal and the post page; e915699 the mock's comments; edb1a66 the module path; 01d6948 no thread that names the sponsor; e2a6d4a the review; 5190e7f a test that hung on the hour). The operator asked for posts that repeat what did well in the niche and for one post that answers similar questions together. A push of the backend found that Convex takes no hyphen in a module path, which convex-test does not check, and planning a week in the demo modeled a post on "Has anyone here tried Formstep?", which would have planted the question ground rule 5 forbids. The review found that a round-up's questions were held back even in weeks no post could hold one, so on Hacker News they aged out unused; that the standouts and the round-up took the reactive posts and dropped their signals; that once "modeled" won, the review counted every later post as modeled; that a replaced modeled post kept its variant; that the planner acted on keys a post model test did not have to carry; that a test with no standouts left would hold the account's one test for good; that questions found by the niche alone were filed under the first pillar; and that the prompt asked for the standout's kind of post and the post's intent at once. Tests went from 497 to 516; the seeded report's test had been failing every afternoon, as it counted a post at the edge of its window by the hour it ran. Smoke-tested on the seed: a post model test for Max planned three modeled posts of seven, and the post page shows the thread.
- Slice 19: done (11289f9 consistency, the leak and the growth line; ccfc680 the review). The review found that a click leak aimed the strategy review at a post kind test, which is decided on reach; that a post counted as due before its hour; that the growth line read each span through the report's whole funnel instead of its own rows, once; that clicks were counted by when they came instead of by the window of the post they came from; and that the Monday digest went out with every count at zero. Seen in the studio: Today's Last 7 days and the report's Posted as planned. The leak and the Monday digest are checked by tests only.
- Slices 20 and 21: done (cd6f366 the rising push and the bio link; 7d19ff2 reworked posts, open problems and launches; 752e2dd the review). The review found that a reworked post handed the writer the product's name and the tracked link of the post it came from; that a launch could sit beside the day's idea, go out on an account whose dial is 0, or twice on one day; that a launch whose community stopped allowing the product would be written without it; that the bio link kept the website as it was when the link was made; and that a rising thread found in the quiet hours was pushed at their end, when it no longer rose. The bio link is now its own kind of tracked link; the local backend's links were given their kind in place, without a reset. Seen in the studio: the launch form (an X account planned, a Reddit and a forum account left out with why) and a bio link made on the account page. The rising push and reworked posts are checked by tests only.
- Slice 22: done (16fa38d the judge; ce08d8d and 665cbe5 the review). The review found that the job runner failed the post of every failed job but the judge's; it now fails a post only when its write fails. It also found that a draft with no reading yet (written before the judge, or whose reading failed or was dropped by an edit) had its first reading from the operator's edit, which sent the operator's words back; a judge job now says whose words it reads, and only the writer's are sent back. Checked by tests only: in mock mode the judge's reasons come from rules on the words (a question gives a reason to comment, a number or several parts one to like, a post that teaches, informs or shows one to follow).
- The studio's redesign (operator, 2026-10-23: "the UI is generally confusing… hard to see what belongs together"): done (ae1251f Today and the grouping vocabulary; e0796b7 one frame for every account page and the overview; 149c049 replies; 198b21a posted; ede3d9b the account's report; 0a9e946 strategy; 192ca9e memory; 9b15f28 voice; 00c6ea1 the post page; 000f290 the workspace report; 72940d0 experiments; ba4d084 signals; bd95aed agents; 0a95dd6 the checklist and the accounts; b16aedc providers; 9ffe234 setup and onboarding; 1b611ce the post editor on a phone; 752c360 the review: empty slots, one card band, one card table). Every page now sits on a canvas with what belongs together on one card: alerts first (what failed, what waits on the operator), the work in tabs or cards, the rest in collapsibles. An account's seven pages share one frame with tabs, and the Report moved into it. Tabs are links, kept in the address, and their panels stay mounted, so a half-edited draft survives a switch. Seen in the studio at 1440px: every page; at phone width (390px, in a frame): Today, the account overview, the post page and the reports. Not seen: the first run's setup (the local workspace exists), onboarding's later parts and Done, the real-mode alert, a failed post's alert and a weak judgment's alert, for want of local data.

#### Left for later

- Slice 6: the comment poll reads `accountPosts` for items posted without a draft; that is what their `url` and `community` are kept for. A reader's `activity` takes the niche, the pillars and the time only for the mock history; the readers, once they take an account, can carry them instead.
- Later: the code's post `intent` (ask, inform, share, teach, show) is the glossary's post kind, and its `kind` (text, thread) is the post's format; renaming them to the glossary takes a migration, and they do not map one to one (the glossary's story is not the code's share, and inform has no counterpart). The post writer and the reply writer share their retry (`internal/drafting.ts`), but each still builds the account, workspace, directives and memory fields of its brief. A post's kind follows from its length (a thread is always long), yet both are stored and checked against each other. `XCadence` holds every platform's cadence. A matched X thread keeps its drafted parts, since only its first part is the item. A Reddit or Hacker News post matched by its link keeps the parts the operator typed, not the platform's title and body.
- Slice 10: A ban is not read: only a removal of a post or a reply is, and Reddit's removal is read from its fields without a live removed item to check against; a comment its moderators removed may not look removed to the operator's own token at all. A community whose rules cannot be read keeps its threads out of the sweep, and the next sweep hears them again; nothing yet tells the operator besides the job's result. A dimension's description is one text for replies and posts alike. A sponsor mention test counts every reply, though a thread whose community forbids the sponsor gets the control either way, which dilutes the difference.
- Later: in mock mode an X or connected Reddit account hears a new mention every hour, so Today and the digest keep growing there. The Providers page builds Reddit's reader with a placeholder grant to say what a connected one reads. The platform is held twice while an account is set up, in `AccountIdentity` and in its `PlatformFormat`. `HeardComment` and the reader's `HeardMention` are two narrowings of a heard thread, a notification's claim is an optional `claimedAt` beside its status rather than part of a union, and Reddit's comment reader reads the inbox whatever items it is asked about. A link the operator gives is matched only when the reader lists its item within the match's two days and newest hundred; a reader that reads one item by id would match the rest. A pasted LinkedIn link to a comment answers the post it is under.
- Later (from slice 9): a posted reply's or post's text means the draft before it went out and the posted words after. Only posts and replies are measured: what the operator posted without a draft is listed on the Posted page but has no numbers, which would take numbers on `accountPosts` items. A comment under an item older than the Posted page's week (an answer in a Reddit inbox) opens the page at an item it does not list. LinkedIn's followers are not typed in, so a LinkedIn account has no reach line. The studio derives a reply row's type from the replies page's query and a post card's from the week's, though Today feeds both from its own: the backend exports only its generated API. `XCadence` holds every platform's cadence.
- Slice 11: The PostHog queries for probable conversions and the paging are unproven against a live project. A `heard_about_us` answer is read by its words: a long platform name one letter off still counts, a platform it names in other words does not. On Reddit and Hacker News the visits a direct link brings (PostHog page views with the post's `utm_campaign`) could stand in for the clicks no one counts. The writer's `sponsorLink` mutation reads the post and the account again on purpose: a mutation reads its own rows, so the link is made from what is stored.
- Slices 12 to 15: the mock analytics' contract carries `mockVisits`, which only the mock reads, like a reader's `activity` taking the niche for the mock history. A posting time test cannot run in real mode on X and LinkedIn, where nothing reads the account's own posts, and a draft (not an idea) under a test keeps its moved hour when the test ends. A handle is compared without case on every platform, Hacker News included, though Hacker News reads a username as spelled. The mock comment poll answers every comment under every posted item, so on the seed's account Today fills with comment drafts past its reply budget within minutes. The researcher's poll still searches everywhere, as niche research should.
- Slice 16: a forum on other software hears nothing, and a topic pasted from it has no category, so its rules are never read; the `site:` web search through the suggestions provider, the operator's first option for the Zapier Community, is not built. A forum's mentions are not heard. A Discourse forum installed under a path (example.com/forum) is read as other software, and a topic slug of digits only would misread a link. The guidelines are read from the page Discourse serves without JavaScript, so a forum that changes that template leaves them unread. Every match reads a cut-short excerpt whole, post by post, within its window. The mock forum lists X-shaped history items, so mock mode never meets Discourse ids; the tests do. An answer to "where did you hear about us" that names a forum by its name ("the n8n community") is no probable conversion; only "forum" is read. An account keeps its forum as an optional column beside its platform, read through `placeOf`, as a notification keeps `claimedAt`; the writer's briefs carry the place's name beside the platform; the Hacker News and Discourse readers each decode HTML entities.
- Slice 17: an account with replies off never listens, so on Reddit or a Discourse forum its plan waits until a pasted thread meets a community. The bio item quotes the bio as the account was made; a bio changed in settings later is not followed. The profile edit links are each platform's settings page as of 2026-10, LinkedIn's the profile itself. The account settings' sponsor dial keeps its bare "0 to 1" hint. In a workspace with many comments waiting, a new account's first post falls below the three next steps Today shows. The `noMetCommunity` sentence names removals even to an account that has met nothing yet.
- Slice 18: on X a thread's reach is its author's followers, so a big author's quiet post can stand out; nothing reads X for real yet. A source with fewer than three threads found has no standout, so in mock mode only Hacker News has one. A round-up goes where the planner places any post of the account, not where its questions were asked. A post model test needs 15 measured modeled posts, one per evergreen post with a standout left, so it runs long on an account with few. The review still meets the post model dimension last; only Today proposes it. A replaced modeled post leaving its test has no test of its own.
- Slices 19 to 21: on Reddit and Hacker News, where posts link to the sponsor directly, no clicks are counted, so the click step never leaks there and the bio link's visits are not counted. The leak reads an account against its own 28 days before, so a new account has none until it has a window behind it. A rising thread found in the quiet hours is never pushed; it waits on the replies page. A reworked post comes only from another platform's account, never on Hacker News, and its source keeps a sentence that names the product in other words. Planning a launch again for the same day adds the accounts made since and leaves out the ones that hold it.
- Slice 22: replies are not judged. The judge reads the post's words, its place and its audience, not the community's rules or the account's numbers. A post the operator asks to rewrite after its first judgment is never sent back again, only judged.
- The redesign: an account's settings card ends with its buttons in the form, not on an action band; the seven account tabs scroll sideways on a phone with no sign that more follow; the replies, strategy, memory, voice, experiments and providers pages were checked at phone width only through the shared one-column grids, not in a browser.

## Risks worth knowing

- **Community rules and moderation.** Subreddits set their own self-promotion rules. Hacker News's guidelines discourage using the site mainly for promotion. The disclosure guard, the sponsor dial and community weights reduce the risk; they don't remove it. A removed comment is a signal to listen to.
- **Generated text.** HN and many subreddits dislike machine-written text. Draft shapes and the edit share exist for this. The operator's own words are the product there.
- **API access and cost.** Reddit's free tier and its terms for commercial use, X's prices, and LinkedIn's partner-only read access are all checked when the keys are set up, not assumed here.
- **Dark attribution.** Most readers on Reddit and HN search for the product rather than click a link. UTM counts undercount more than they did on video. Probable conversions are reported as probable.
- **Reddit fuzzes scores.** Read them as a trend, never as an exact count.
- **Web push on iPhone** works only from a studio added to the Home Screen. A browser that blocks notifications gets none. Today's in-app list is the backstop, so nothing depends on a push arriving.
- **Tokens in the database.** Reddit refresh tokens live in Convex, read only by internal functions. That is fine for one operator. A multi-tenant Influstep would encrypt them.
