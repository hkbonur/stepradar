---
name: gh-issue
description: Explicit-only workflow for writing, rewriting, or explaining GitHub issues so a junior developer can understand them — plain words, a concrete example, why it matters, and what to do. Invoke only as `/gh-issue` or `$gh-issue`; do not trigger from ordinary reviews, commits, or bug fixes unless they explicitly ask for it.
---

# /gh-issue

Write GitHub issues that a junior developer on their first week can read once and understand. The reader knows programming but not this codebase, its history, or its jargon.

## Arguments

- `/gh-issue <description>` — draft and create a new issue from the description and the current conversation.
- `/gh-issue <N>` — explain issue #N in chat in junior-friendly terms. Do not edit the issue.
- `/gh-issue rewrite <N>` — rewrite issue #N's body in this style and update it with `gh issue edit`. Keep every fact from the original body. Show the new body in the reply.
- No argument — create issues for the follow-ups identified in the current conversation, one issue per independent topic.

## Step 1 — Gather facts

Run in parallel when relevant:

- `gh issue list --state all --search "<keywords>" --limit 10` to find duplicates. If a duplicate exists, comment on it or report it instead of opening a new issue.
- `gh label list` and reuse existing labels (`bug`, `enhancement`, `design-pass`, `requests`, ...). Never invent labels.
- Read the code the issue is about. Every claim in the issue must be something you verified, not something you guessed.

## Step 2 — Pick the issue type

| Type | Use when | Label |
|---|---|---|
| Bug | Something behaves wrong today | `bug` |
| Enhancement | New behavior or a small improvement | `enhancement` |
| Decision | A trade-off the owner must choose (keep vs. change a design) | `enhancement` |
| Follow-up | Cleanup left over from a commit or review | `enhancement` |

## Step 3 — Write the body

Use this skeleton. Drop a section only if it truly has nothing to say.

```markdown
## In one sentence
<What is wrong or what we want, in plain words. No file names.>

## How it works today
<Explain the current behavior as if to a new teammate. Define every
project term the first time you use it ("slot", "normalizer", "share link").
Use an analogy if the idea is abstract.>

<Concrete example: a data snapshot, a UI sketch, or numbered repro steps.>

## Why this is a problem
<Numbered list. Each item: the cost, plus a small real example of it
happening — ideally a bug or commit that already hit it.>

## What we propose / what to do
<The change in plain words, with a before/after example.>

**What gets simpler or fixed:** <bullets>
**What it costs:** <bullets — be honest about trade-offs>

## Decision needed / Done when
<For a Decision: the exact question and the two outcomes
("If yes: ... If no: close this and note why in ADR 00XX").
For a Bug/Enhancement: a checklist a reviewer can tick.>

## Pointers
<Files, functions, ADRs, related issues and commits. Code references go
HERE, at the bottom, not in the explanation above.>
```

## Writing rules

- **Plain words first, code names last.** Explain the idea before naming the function that implements it. A reader should understand the whole issue without opening any file.
- **One idea per sentence.** Short sentences, active voice, about 20 words max.
- **Define jargon once.** First use of a project term gets a short definition: "the *default value* (text pre-filled for the respondent)".
- **Always show an example.** Pick the kind that fits:
  - *Data shape*: a JSON snapshot of the node or record, before and after.
  - *UI*: a small ASCII mockup of the screen, before and after.
  - *Bug*: numbered repro steps, then "Actual" and "Expected".
  - *Code smell*: a 3–6 line excerpt of the real code showing the pattern.
- **Use an analogy for abstract design problems.** One or two sentences, then return to the real code. Example: "One whiteboard, two notebooks: after every change you copy the whiteboard into whichever notebook is active."
- **Say why it matters.** Tie each problem to a consequence: a real bug, extra code every feature must write, a user-visible failure.
- **Be honest about costs.** A proposal without its downsides is not reviewable.
- **End with an action.** The reader must know what to do next: fix, decide, or close.
- No em-dash chains, no marketing tone, no "simply/just/obviously".
- Title: `Area: plain description of the problem or decision`, under ~80 characters. Example: `Editor: should the input box stop doing two jobs at once? (ADR 0008)`.

## Good vs. bad opening

Bad — correct, but only readable if you already know the code:

> ADR 0008 made a text-style input's Slate children mirror one of two slots: the default value (`value` or `defaultValueFieldRef`) while `isEditingDefault` is set, otherwise the placeholder.

Good — same fact, readable by a junior:

> In the editor, each text input question has one editable line of text. That line has to hold two different things: the **placeholder** (grey hint text like "e.g. Oslo") and the **default value** (text pre-filled for the respondent, like "Norway"). Because there is only one line, it shows one of them at a time, and ⌘D switches between them.
>
> ```json
> { "placeholder": "e.g. Oslo", "value": "Norway", "isEditingDefault": false,
>   "children": [{ "text": "e.g. Oslo" }] }
> ```

## Step 4 — Create or update

- Create with a heredoc so formatting survives:

  ```bash
  gh issue create --label enhancement --title "Area: ..." --body-file - <<'EOF'
  ...
  EOF
  ```

- Rewrite with `gh issue edit <N> --body-file - <<'EOF' ... EOF`.
- Issue text is persisted for other humans: write normal full English even if the chat uses a terse style.
- Never add AI attribution lines.

## Step 5 — Report

One line per issue: number, title, URL. For `/gh-issue <N>` explain mode, the explanation itself is the reply.
