# Influstep

The ubiquitous language of Influstep. Influstep is the operator's engagement desk: it listens on Reddit, Hacker News, X, LinkedIn and product forums for the conversations where the operator's future customers talk, drafts replies and posts in the operator's voice, and the operator posts them by hand from their own accounts. Influstep then matches what went out, measures it, notifies the operator about comments, runs experiments and recommends what to do next, so the operator's product, the sponsor, gets attention and customers.

This file is a glossary only: it defines what each term _is_, not how it is implemented. When several words exist for one concept, the canonical word is the heading and the rejected ones are listed under _Avoid_.

## People

**Operator**:
The person who owns an Influstep workspace, connects their own accounts, posts the drafts they like by hand, and does the few things only a human can (connect an account, set a key, paste a link where a platform has no API). Anyone who runs Influstep for their own product; no login yet, one workspace per backend.
_Avoid_: user (ambiguous with the readers), admin, owner.

**Reader**:
Someone who reads the operator's post or reply on a platform. A reader who follows the account is a **follower**; a reader who signs up for the sponsor is a **conversion**.
_Avoid_: viewer, customer (that is the sponsor's relationship), audience (fine for the group, not the individual), lead.

**Sponsor**:
The product the operator builds and promotes, set up on the first run (**Setup**) and kept on the workspace: its name, its website (where tracked links send readers), its **pitch** (what it does, in one sentence the writer says in its own words, never as an ad read), and what one paying customer is worth. A draft either names the sponsor, with the affiliation line, or leaves it out so the account helps on its own. The demo seed's sponsor is Formstep.
_Avoid_: client, advertiser, brand.

## Accounts

**Account**:
One of the operator's own accounts on one platform: its platform, its handle, its niche and audience, its content pillars, its communities, its affiliation line, its sponsor dial, its reply budget and cadence, its voice and its strategy. An account owns its signals, drafts, posts, replies, comments, experiments, memory, chat and report, and it is the unit the operator compares in reports. The operator connects as many as they have, several on one platform if they like. It shows as its platform's logo and its handle.
_Avoid_: persona, profile, bot, channel (fine casually for a platform account, never as the term).

**Platform**:
Where an account lives: `reddit`, `hackernews`, `x`, `linkedin` or `forum`. Each has its own platform reader, its own draft shape and its own numbers.
_Avoid_: network, site, channel.

**Forum**:
A product's community forum, such as the n8n Community, where an account is the operator's username: the `forum` platform. Every forum is its own site, so a forum account names its forum, and its links, its handle and the medium its sponsor links name are read against that forum: one username on two forums is two accounts. A forum on Discourse is read the way any visitor reads it; a forum on other software, such as the Zapier Community, is run by hand, like LinkedIn. A forum's categories are its communities.
_Avoid_: board, community (that is one of its categories), Discourse (that is the software).

**Connection**:
What lets Influstep read an account on a platform that needs the operator's permission: on Reddit, the operator's consent through Reddit's own page. A connection can expire or be revoked; then a checklist item asks to connect again. Hacker News, X and LinkedIn accounts need only their handle in v1.
_Avoid_: integration, login, OAuth (fine as the mechanism).

**Setup**:
The first run (`/setup`): what Influstep does, the product, what one paying customer is worth, then the operator's accounts. "Add account" in the sidebar runs the account step again.
_Avoid_: wizard, onboarding (that was the persona roster), signup.

**Agent**:
A worker of the workspace with one role, serving every account. Four agents: the **researcher** finds signals, listens for threads worth answering, reads the comments under the operator's posted items and writes each account's morning brief and problem log; the **writer** turns a heard post, a comment or an idea into a draft; the **judge** reads each written post as a reader would before it waits for the operator (Judgment); the **analyst** matches what the operator posted, pulls metrics, decides experiments, reviews each account's strategy every week and names the next steps. Each takes jobs from its own queue, and the Agents page shows what each is doing now, what waits in its queue and what it did last.
_Avoid_: bot, assistant, sub-agent, worker (fine in copy; never as the term, since the Cloudflare Worker is a process).

**Directive**:
An instruction the operator gives an account in its chat ("focus on n8n error handling for two weeks", "stop mentioning pricing"). Directives are stored, dated and read by every agent run that follows, until the operator withdraws it.
_Avoid_: prompt, instruction (fine casually), note, feedback.

**Chat change**:
A change to the plan the operator asks for in an account's chat, in plain words: replace a planned post with another concept, move it to another day of its week, or drop it. The account applies it to the posts it may still change (from today through next week, not yet posted) and replies with what it did, linking the post. A change it cannot apply changes nothing, and the reply says why.
_Avoid_: command, action, edit (fine casually).

**Task**:
Something the operator asks for in an account's chat that one agent runs and answers in the same chat: a research brief (the researcher, from the account's newest signals), a comment digest (the researcher, from the last week's comments) or an analytics summary (the analyst, from the last week's numbers). It runs as a job of the role that owns it.
_Avoid_: job (that is how a task runs), todo, ticket, request (a sponsor's word for its own feature).

**Voice**:
How an account writes, learned by the analyst from the account's imported history: the language, a summary and traits the LLM writes, the length mix and the emoji and hashtag habits counted from the account's own posts, and the example posts the writer imitates. The operator edits the language, summary and traits on the account's voice page. Every draft is written in it; until it is learned the writer writes in English in the account's tone.
_Avoid_: style, tone (that is the account's tone), writing style.

**Affiliation line**:
How an account says that the operator builds the sponsor ("I'm building Formstep, so take this with salt"), set once per account. Every draft that names the sponsor carries it where it first names the sponsor.
_Avoid_: disclaimer, disclosure (fine for the practice), bio.

**Sponsor dial**:
The share of an account's posted drafts that may name the sponsor over a rolling seven days, as a number from 0 to 1 (0.1 by default). Most drafts help without the sponsor, so the account earns attention by being useful.
_Avoid_: ad ratio, promo rate, mention rate.

**Reply budget**:
How many reply drafts the writer prepares for an account a day, 0 to 20 (5 by default), counted from local midnight. Zero turns the listener off for the account. It budgets the operator's attention, not the platform's limits.
_Avoid_: quota, limit (fine casually), rate limit.

**Cadence**:
How many posts a week the planner plans for an account, and which post kinds they rotate through. A decided post kind takes the turns of the kind it beat.
_Avoid_: schedule (that is a post's day), frequency.

## Drafts

**Draft**:
Text the writer wrote for the operator to post: a post's or a reply's, in the account's voice and the platform's draft shape. A draft waits for the operator, who opens the thread, copies it or rewrites it, and posts it by hand, or skips it. Influstep never posts a draft.
_Avoid_: suggestion, template, script (that was the video's spoken text).

**Judgment**:
The judge's reading of a written post from the reader's side, before the operator sees it: why someone would read on, comment, like and follow, each answered from how people read and act (an open question invites answers, a tip worth keeping earns a like, a reason to expect more earns a follow), never from how other posts did and never why the account should post it. A post that gives a reason to read on and to comment, and to like or to follow, engages. When a post's first judgment finds too few reasons, it sends the post back to the writer at once, with what was missing and what would give it; a later judgment only says so, on the post page and the post card. An edit by the operator is judged again and never sent back. Replies are not judged.
_Avoid_: score, rating, review (that is the strategy review), critique.

**Draft shape**:
What a draft looks like on its platform. On X and LinkedIn, ready-to-post text (an X thread one part per post). On Reddit and on a forum, full text marked "rewrite in your words", since many communities remove text that reads machine-written. On Hacker News, at most three talking points with the facts or links to cite, since its moderators remove generated comments; the operator writes the comment.
_Avoid_: format (fine casually), template.

**Post**:
An original post on one account, from its idea to its numbers: a concept, a community, a title where the platform has one, its parts, the experiment variant it carries, its plan day, the draft, and once the match finds it, what the operator actually posted, its URL and its numbers. Its status is one of **idea** (planned, no words yet), **draft** (waiting for the operator), **posted** (the match found it), **measured** (its measurement window closed), **skipped** (the operator passed on it or its day passed), **killed** (the operator withdrew it) or **failed** (an agent run gave up; the error is on the post).
_Avoid_: episode, publication, content, piece, submission (Reddit's word).

**Post kind**:
What a post sets out to be: a **question** about a problem readers have (asked openly, never a planted pitch), a **how-to**, a **story** of something that happened, or a **show** (a Show HN, a demo). On X a post may also be a thread.
_Avoid_: post format, post type.

**Reply**:
A draft answer to someone else's post or comment, from the post the listener heard or the comment someone left under the operator's own item, to its numbers: the thread and the parent it answers, its community, where it came from (the listener's search, a mention, a comment, or a thread the operator pasted), the draft, the variant it carries, and once posted the operator's own text, its URL and what it brought back. Its status is one of **heard** (being written), **draft** (waiting for the operator), **posted**, **measured**, **skipped** (with the reason: the writer passed, a rule covers it, the community forbids the sponsor, the operator skipped it, or the draft went stale after a day) or **failed**.
_Avoid_: comment (that is someone's answer to the operator), engagement (the whole practice), interaction, response.

**Concept**:
The one-sentence idea of a post ("How do you retry a webhook that fails at 3 a.m.?"). A concept comes from a signal, a directive or the account's content pillars.
_Avoid_: topic (that is a signal's tag), idea (fine casually; it is a post's first status), title (that is the posted name).

**Hook**:
The first line of a post or a reply, written to keep a reader reading. It is read from the draft, never written apart from it. Hooks are a usual unit of an experiment.
_Avoid_: intro, opener, teaser.

**Just-in-time draft**:
The rule that a post's draft is written the day before it is due, not when the week is planned, so the writer reads that morning's brief and problems first. Planning leaves ideas; an idea for today or tomorrow is written at once, a later one waits for its day, and an idea whose day passed unwritten is skipped. Before writing, the researcher gives it a last check.
_Avoid_: lazy draft, late draft.

**Match**:
Finding the operator's real post or comment that came from a draft, in the account's own recent activity, or from the link the operator pasted. A reply matches by its parent and by being posted after the draft was written, and the closest text only breaks a tie; a post matches by its community, its day, being posted after the draft was written, and a title or first line close enough to the draft's. An item the operator posted without a draft is kept too. Where a platform has no API, the pasted link is the match.
_Avoid_: verify, detect, sync, confirm.

**Edit share**:
How much of a ready-to-post draft the operator changed before posting it, from 0 (posted as written) to 1 (rewrote all of it), measured on X and LinkedIn only. The writer reads it, so drafts move toward what the operator actually posts. On Reddit and Hacker News a rewrite is expected, so there is none.
_Avoid_: diff, edit distance (fine as the mechanism), accuracy.

**Measurement window**:
The seven days after an item is posted during which the analyst snapshots its numbers before marking it measured and feeding its experiment.
_Avoid_: attribution window (that is for conversions), cooldown.

## Listening and research

**Community**:
Where an account takes part: a subreddit, Hacker News (with its Ask and Show sections), a forum's category, an X topic, a LinkedIn audience. A community has its **rules** (a subreddit's rules, HN's guidelines, a forum's guidelines with its category's description), read when the listener first meets it and again every week, whether they allow self-promotion, and a weight in the account's strategy. A community whose moderators removed the operator's post or reply is marked removed: the planner sends it no posts and the listener answers nothing there until the operator ticks off the checklist item that asks them to look. A ban shows in no reader, so it is the operator's to tell.
_Avoid_: group, channel, sub (fine casually); forum names the platform, not one of its categories.

**Listener**:
The researcher's sweep, every hour, of an account's communities for posts and comments worth answering, on platforms whose reader can search (Reddit, Hacker News and forums on Discourse). It keeps at most the day's reply budget, chosen by the account's reply target, and never hears the same post twice. On X and LinkedIn in v1 the operator pastes a thread instead.
_Avoid_: monitor, scraper, crawler, social listening (fine casually).

**Heard post**:
A post or comment the listener kept for an account to answer, before the writer drafts its reply.
_Avoid_: lead, opportunity, mention (that is one origin).

**Signal**:
One thing the researcher found worth a post: a Hacker News story, a Reddit thread, a search suggestion people type into Google, a comment under one of the operator's items, or a problem from the account's problem log. A signal has a source, a title, a URL (none for a problem), a score, topics, when the source says it was posted, and the posts it fed. Every ranking reads its freshness, not its score, except the standout rule, which compares the scores of one source. Signals age out after two weeks unless a post used them or they are open problems: a problem no post drew on and the operator did not dismiss waits for its post.
_Avoid_: trend, post, item, insight, topic (that is a tag on a signal).

**Source**:
Where signals come from: `hackernews`, `reddit`, `x`, `linkedin`, `forum` (a platform's search), `search` (search suggestions), `comments`, `problems` (the problem log).
_Avoid_: feed, channel, integration.

**Freshness**:
How much a signal still matters today: its score, halved every two days since the source posted it (or since the researcher found it, when the source does not say); an open problem keeps its score, since the problem is still there. Computed when it is read, never stored. Below 25 a signal is **cold**: the planner leaves it out, and an idea built on it is swapped at its last check.
_Avoid_: recency, decay (fine for the mechanism), heat, trending score.

**Morning brief**:
The researcher's short daily note per account, written by the morning sweep: how many items each source found, the five freshest, and the open problems, or "Nothing new moved since yesterday." when nothing did. A memory entry that expires the next day. The writer reads the brief in force before every draft.
_Avoid_: digest (that is the morning digest notification), research brief (that is the chat task), report, summary.

**Problem log**:
The problems readers keep raising under the operator's items: a question asked three or more times in two weeks in the comments. Each **problem** is logged once and gathers its evidence as it repeats, becomes a signal with a high score that does not go cold or age out while the problem is open, so the planner gives it a post, and is read by the writer. A problem stays open until the operator marks it **resolved** on the Memory page.
_Avoid_: issue, bug, ticket, complaint, FAQ.

**Standout**:
A thread the researcher found that people answered far more than the others its source found with it: at least twice the median score of at least two others of the same source, since a Reddit point and a forum read are no common unit. A post can be **modeled on** a standout: it takes the standout's topic and what made people answer it, in the post's own intent, the account's own words and its own work; the writer sends back a draft that repeats more than half of the standout's title or summary (a title under six words is the topic itself). A standout is read from the unused signals, so each is drawn on once, and a thread that names the sponsor is never one: it is a thread to answer.
_Avoid_: viral post, top post, winner (that is a decision's), trend.

**Round-up**:
A post that answers together the questions people asked lately about one pillar: at least four questions among the unused signals whose topics name that pillar, the most moved first and at most eight. A week holds one, in its first evergreen full post that answers, tells or shares (on X a thread), never on Hacker News; a week where no post can hold it leaves its questions to the reactive posts. A question that names the sponsor is never in one. It says each question in the account's words, answers it from the account's own work, and names no one who asked; the sponsor comes up only as the dial and the community's rules allow.
_Avoid_: digest (that is the morning digest), FAQ, recap, summary.

**Consistency**:
Whether an account posts as planned: its week's posts due so far (a post is due once its hour came; a skipped one was due, a killed one never was) against how many went out. Once at least three were due and fewer than half went out, the account **fell behind**, which is a next step; the account page shows the week and the report the last four.
_Avoid_: streak, cadence (that is the account's plan), schedule.

**Leak**:
Where an account's funnel lets fewer through than it did: the **funnel step** (who its linked posts reached clicking through, who clicked signing up, who signed up paying) whose rate over the last 28 days fell under 60% of the 28 days before, both windows past the step's floor, or a **dry** step that let nothing through though three times its floor came to it. The click step reads only the posts that carry a tracked link; a platform whose posts link straight to the sponsor has only the paid step. Fewer clicks is the posts' to fix, and the strategy review tests how posts open and end on it; fewer signups or fewer paying is the product's page or the product, which no post fixes.
_Avoid_: drop-off (fine casually), churn, bottleneck.

**Growth line**:
What an account's last seven days brought in signups and paid conversions against the seven before, beside the test it runs now, at the bottom of Today.
_Avoid_: trend (that is the report's per-day line), KPI, stats.

**Rising thread**:
A thread the listener found and kept that is under two hours old and drew at least five comments at ten or more an hour: a reply now lands while people still read it, so the operator gets a push at once, one a sweep for the fastest, once per thread. None is pushed in the quiet hours: by their end the thread is no longer rising.
_Avoid_: viral, trending, hot, standout (that is something else).

**Reworked post**:
An account's post drawn from another of the operator's accounts' post, on another platform, that brought the most users in the last 28 days (the most paid, then the most signups): the same point, written anew in this platform's shape, one a week in an evergreen post (after the week's round-up, which takes the first one that can hold it), never on Hacker News, never one reworked already. The writer reads the source without its sentences naming the product and without its links, and names the product only as this post's sponsor rule says.
_Avoid_: cross-post, repost, syndication.

**Launch**:
When the product ships something, one post per account on the day the operator picks, announcing it and naming the product with the account's affiliation line: a thread on X where the cadence has threads, a Show HN on Hacker News, and on Reddit or a forum only in a community the listener met whose rules allow self-promotion. It takes the place and the hour of the day's idea not yet written. An account where it cannot go is left out, with why: its sponsor dial is 0, the day holds a launch already or a post already written, the day's posting hour has passed, or no community lets it name the product. A launch is the operator's explicit call, so it is planned outside the sponsor dial's ramp; if its community stops allowing the product before it is written, it is skipped.
_Avoid_: announcement (fine casually), campaign, blast.

**Last check**:
The researcher's look at an idea just before its draft is written: if the signal it reacts to went cold, the idea's concept is swapped for the account's strongest fresh signal (freshness 60 or more), and the journal says so with both freshness numbers.
_Avoid_: recheck, validation, refresh.

**Content pillar**:
One of three to five recurring subjects an account always returns to ("n8n tutorials", "AI agent workflows", "automation fails"). Pillars keep an account consistent; the listener searches for them, and the planner shares the week out by the pillar weights in the account's strategy.
_Avoid_: category, theme, niche (that is the account's whole field), series.

## Comments and notifications

**Comment**:
Someone's answer under one of the operator's posted posts or replies, or a mention of the account. Its status is one of **new**, **answered** (the operator's reply under it went out) or **dismissed** (the operator let it go, or no answer reached it in time). Every new comment gets a drafted answer, a reply that came from a comment, and a notification.
_Avoid_: reply (that is the operator's), message, response, feedback.

**Notification**:
A web push to the operator's devices: a comment (several within ten minutes go as one), the morning digest, or a rising thread the listener found. Each one is logged, and Today's in-app list shows the same, so nothing depends on a push arriving.
_Avoid_: alert, ping, toast (that is in-app UI).

**Morning digest**:
The notification each morning that says how many drafts are ready, which posts are due and the next steps; on Monday it also says what last week, Monday to Sunday, brought in signups and paid conversions against the week before, and says nothing of it when neither week brought anyone.
_Avoid_: brief (that is the researcher's note), summary, newsletter.

**Quiet hours**:
The workspace's window in which no notification is pushed; what arrives in it waits in Today's list and goes out as one when the window ends.
_Avoid_: do not disturb, mute, pause (that is an account's kill switch).

## Experiments

**Experiment**:
A question an account tests across its drafts ("Do one-line replies beat a paragraph on score?"): a hypothesis, a metric, two or more variants on one dimension, and a decision rule. An account runs one at a time, picked by its strategy review from the experiment catalog or set up by the operator. A reply is given a variant when it is heard, a post when it is planned; the analyst compares the variants' means per item, counting only items past their measurement window and leaving out one its community removed, once every variant has the experiment's minimum; a test with no clear winner then stops.
_Avoid_: A/B test (fine in conversation), split test, campaign, trial.

**Variant**:
One arm of an experiment, with a key and a description the writer follows. The **control** is what the account did before on that dimension: its default.
_Avoid_: option, arm (fine in statistics), treatment, version.

**Metric**:
What an experiment is decided on, per item: `paid`, `signups`, `clicks` or `reach`, the goal metric ladder. Reach comes from the platforms, clicks from tracked links, signups and paid from PostHog. A report shows these and the comments under the items.
_Avoid_: KPI, goal, stat.

**Reach**:
What an item earned on its platform before anyone clicked: its impressions on X, its points on Reddit and on a Hacker News story, how many read it on a forum. A Hacker News comment has none, since comment scores are not public there, and LinkedIn's are not read. Reach is counted the way each platform counts it, so it is never added up across platforms. An account's reach over time is its karma, its followers, or on a forum the likes it received: its reach line.
_Avoid_: engagement (the whole practice), virality, traction.

**Decision**:
The analyst's verdict on an experiment once a variant leads with enough confidence: which variant won and by how much. The winner becomes the account's default on the experiment's dimension, and the decision leaves a learning. The operator can decide a running experiment themselves instead, with their reason. An experiment is decided once.
_Avoid_: result, winner (fine in copy), outcome.

## Strategy

**Strategy**:
What an account does by default and what it tests next: a default per dimension, the weight each content pillar and each community gets, a posting hour, and the one experiment it runs. The analyst changes it in the strategy review, the listener, the planner and the writer follow it, and every change is written to the journal with its reason.
_Avoid_: plan (that is the week's posts), playbook, settings (those are the operator's), config.

**Strategy review**:
The analyst's weekly look at one account (Monday morning, before the week is planned, or when the operator asks): it shifts weight toward the communities and pillars that earn most, moves a posting hour that another hour clearly beats, re-tests a default that later data contradicts, and starts the next experiment when none runs: where the account's funnel leaks at the click step, a hook or call to action test it can decide past reach first, else the dimension it knows least about. Every rule is fixed and needs no model; a review that finds nothing to change changes nothing.
_Avoid_: audit, retro, optimization.

**Dimension**:
One thing an experiment varies. For replies: reply style, reply target, reply length and sponsor mention. For posts: post kind, hook, call to action, posting time and post model. Each has its variants in the experiment catalog and one default per account.
_Avoid_: axis, factor, lever, kind (its name in code only, `experiment.kind`).

**Reply style** (dimension):
How a reply adds something of the operator's own: one concrete tip (the control), a short question back, or what happened when they hit the same thing.
_Avoid_: reply tone, reply template.

**Reply target** (dimension):
Which threads the listener keeps: the ones that reach the most, the highest-scored threads on Reddit and Hacker News and big authors on X (the control); or only where a reply stands out, threads under two hours old with few comments on Reddit and Hacker News and authors under 10,000 followers on X.
_Avoid_: audience, segment, niche.

**Reply length** (dimension):
One or two sentences (the control) or a paragraph or more.
_Avoid_: size, verbosity.

**Sponsor mention** (dimension):
Whether a reply names the sponsor where the community allows it and the sponsor dial has room, with the affiliation line, when it truly helps the reader (the control), or never.
_Avoid_: plug, promo, placement.

**Call to action** (dimension):
How a post ends: without asking the readers anything (the control), or on a question they can answer in a comment.
_Avoid_: CTA (fine in conversation), closer.

**Hook** (dimension):
How a post opens: a plain statement of what it gives (the control), a question the reader has asked themselves, or a number from the operator's own work.
_Avoid_: opener, headline.

**Posting time** (dimension):
When a post is due against the account's usual hour: at it, two hours earlier or two hours later. A test moves a whole day's posts by one variant, so they stay three hours apart, and starts only where every variant keeps them within the day; while it runs the account's hours stay as they are. The operator posts by hand, so a post counts for its variant only if the match found it within 45 minutes of the hour it was planned for; a platform whose own posts Influstep cannot read cannot run the test. A decided test moves the account's posting hour and keeps no default, and the strategy review does not test the posting time again within 180 days.
_Avoid_: schedule, slot.

**Post model** (dimension):
Whether a post is planned from the pillars and the news as usual, or modeled on a standout. Only an evergreen post can be modeled: a reactive one keeps its signal. Under a test the posts take the variants in turn, and a modeled post takes the next standout, the most out of line first; where none is left, or the post is reactive, the turn goes to the control, and a round-up or a reworked post leaves the test. A post counts as modeled only when it was modeled on a standout. The test starts only once something stood out, takes only the catalog's two variants, and the analyst stops it when its modeled variant got no post for 14 days with nothing standing out. A decided "Modeled on what worked" has every evergreen post take a standout while one is left. Today proposes the test while the account is free to run one and has not tested it within 180 days, since the strategy review would reach it last.
_Avoid_: copy test, remix.

**Experiment catalog**:
The variants an account can test on each dimension, each with the instruction the writer follows. The first variant of each dimension is its control. The strategy review picks experiments from it, the dimension the account knows least about first.
_Avoid_: library, menu, templates, playbook.

**Default**:
What an account does on one dimension when no experiment varies it: the winning variant of the last experiment decided on that dimension, or the catalog's control until one is. A default that later data contradicts is tested again.
_Avoid_: preference, setting, baseline (that is the control), winner (fine in copy).

**Goal metric**:
The metric the strategy review gives a new experiment: on posts, the one closest to paying customers that the posts brought enough of in four weeks, down the ladder paid, signups, clicks, then the platform's reach; on replies, which carry no link, and on post kinds, which decide where a post goes, reach. No test aims at reach where no reader reads it, nor a reply test where a reply shows no reach (Hacker News).
_Avoid_: KPI, north star, objective, target.

**Journal**:
An account's dated record of every change to its strategy, and of every concept a last check swapped: what changed, the reason with its numbers, the evidence, and who made it (the analyst, the researcher or the operator). Never edited.
_Avoid_: log (that is the jobs), history (that is the imported posts), changelog, audit trail.

**Memory**:
What an account keeps knowing from one draft to the next: short entries, each with a kind, who wrote it, the evidence it rests on and a status (active, superseded or retired). Six kinds: a fact and a rule from the operator, a learning and a goal note from the analyst, the morning brief and a problem from the researcher. Nothing is deleted. The writer reads the goal note, the rules, the facts, the learnings, the brief and the open problems before every draft.
_Avoid_: notes, knowledge base, context (that is what one agent run reads).

**Fact**:
Something true the operator tells an account to keep ("readers on r/n8n hate the word 'guys'"), in the chat ("remember that …") or on the Memory page.
_Avoid_: note, info, knowledge.

**Rule**:
Something the writer must always or never do, from the operator ("never name a customer"), in the chat ("remember to …") or on the Memory page. The writer never breaks one; a heard post a rule covers is skipped with the rule as its reason.
_Avoid_: constraint, guideline, policy, directive (that is a focus for a while).

**Goal**:
The one thing every account works toward: paying customers of the sponsor ("Paying Formstep customers").
_Avoid_: objective, target, north star, KPI.

**Goal note**:
The memory entry every strategy review leaves: the account's paid customers in the last 28 days with what they are worth, the trend, and what it tries next.
_Avoid_: status report, scorecard, progress note.

**Learning**:
The memory entry a decision or a review's change leaves: on which dimension which variant beat which, on which metric, by how much and how surely, or what a review moved and why.
_Avoid_: insight, lesson, finding, takeaway.

**Next step**:
One of at most three recommendations on Today, derived by rules from the accounts' state and each with its numbers and where it is done, in this order: comments waiting, a new account's first post while no draft of it has gone out, an account that fell behind its posts this week (consistency), a thread the operator took part in that is taking off, a draft about to go stale, where an account's funnel leaks, an experiment one item short of a decision, what the latest decision changes, or a test of posts modeled on a standout. The morning digest leads with the first after the comments.
_Avoid_: tip, suggestion, insight, action item.

## Attribution

**Tracked link**:
A short link (`/go/<slug>`) a sponsored post on X or LinkedIn carries. The worker counts each click and redirects to the sponsor's website with UTM parameters naming the account, the post, its variant and the platform, so PostHog can tie a signup back to it. On Reddit, Hacker News and forums a sponsored post links to the sponsor's website directly with the same UTM parameters, since those communities distrust redirect domains, so its clicks are not counted; on Hacker News that link is the submission's URL. A reply carries no link. Each account also has one **bio link**, which names no post, for the operator to put on its profile: a tracked link where its posts carry them, sending readers on with `utm_campaign=bio`, else the sponsor's website with the UTM parameters, so what the profile brings counts for the account.
_Avoid_: affiliate link, short URL, redirect.

**Conversion**:
A sponsor's event tied to an account by UTM: a demo started, a signup, a trial or a paid subscription, read from PostHog.
_Avoid_: sale, lead, goal (that is the workspace's goal).

**Probable conversion**:
A conversion with no UTM whose person answered the sponsor's "where did you hear about us" with a platform, or else first arrived from a platform's domain (reddit.com, news.ycombinator.com, t.co, x.com, twitter.com, linkedin.com, lnkd.in, or one of the workspace's forums). It names the platform, never an account or a post: reported apart from conversions, labeled probable, and read by no experiment.
_Avoid_: assisted conversion, dark conversion (fine casually), estimate.

**Report**:
The page that answers "is this working?": per account, its reach line (karma or followers), the funnel from reach to replies, clicks (its bio link's among them), signups and paid with where it leaks, how it posted as planned over the last four weeks, its posted items and its open experiments; across accounts, the same added up with one row per account and what works. Every number says where it comes from.
_Avoid_: dashboard (fine casually), analytics (that is the data), insights.

**What works**:
Ranked lists on the workspace report over the last 28 days' measured items: by community, by pillar and by reply style, each ranked by value per item, then clicks, then reach.
_Avoid_: insights, best practices, leaderboard.

## Operations

**Checklist item**:
Something only the operator can do, created by an agent when it is blocked: connect an account again, set a key, paste the link of a draft on a platform without an API, or look at a community that removed a comment. A new account opens its first ones: put its bio and its bio link on its profile, and where its own posts can come in, have its voice learned. An item that asks for a step Influstep sees (connecting, learning the voice) closes once the step is taken. Done items unblock what they name.
_Avoid_: todo, task (that is a chat request), ticket.

**Job**:
One unit of work a cron, an agent or the operator queued: a kind, a payload, the role that owns it, and a status (`queued`, `running`, `done`, `failed`). Every job runs on the backend. Jobs are the audit trail of what an account's agents did.
_Avoid_: task (that is the chat request), action, run, step.

**Provider**:
An external capability behind an interface with a mock and a real adapter: `llm`, the `classifier` (a fast model that reads every heard post for whether it is on topic and worth an answer), a **platform reader** per platform, the search `suggestions` (Google's autocomplete), `analytics` (PostHog) and the `notifier` (web push). The mode is chosen explicitly per deployment; nothing falls back to mock when a key is missing.
_Avoid_: integration, service, plugin, connector.

**Platform reader**:
The provider for one platform, read only: search (for the listener and the researcher), the account's own activity (for the match and the history import), the comments under an item, an item's numbers, and the account's karma, followers or likes. A reader says which of these it can do; what it cannot do is a manual step the operator sees.
_Avoid_: scraper, client, API (fine as the mechanism).

**Plan**:
An account's posts for the coming week: which ideas on which days, which variant each carries. The planner job writes it; the operator edits it on Today's week or with a chat change.
_Avoid_: schedule, roadmap, queue.

**Pause**:
The operator's kill switch on an account: nothing listens, drafts or notifies for it until it is resumed. Nothing is lost.
_Avoid_: disable, stop, archive, mute (that is quiet hours).
