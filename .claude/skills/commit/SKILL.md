---
name: commit
description: Explicit-only workflow for committing staged or working-tree changes in this repository's commit style (Conventional Commits with a product-language subject and a prose body). Invoke only as `/commit` or `$commit`; do not trigger from ordinary implementation, review, or other workflows unless they explicitly ask for it.
---

# /commit

Commit the current changes the way this repository's history reads. If the user passed an argument, treat it as a hint: an issue number, a scope, a split instruction, or the intent to describe.

## Step 1 — Inspect

Run in parallel:

- `git status --short`
- `git diff --staged` and `git diff` (read the real change, not just file names)
- `git log --no-merges -15 --format='%s'` to match nearby scopes and issue numbers

Rules:

- Commit to `main`: this repository has one branch (see CLAUDE.md). Never create another branch unless the user asks.
- Never `git stash`, `git reset --hard`, or `git checkout -- <path>`: other agents share this working tree.
- Stage explicit file paths only. Never `git add .`, `git add -A`, or `git add <directory>`.
- Leave unrelated changes (other agents' work, deleted plan docs, lockfile noise) unstaged unless the user says otherwise. Mention what was left out.
- If changes span unrelated intents, split them into separate commits, one intent each. Ask only when the split is genuinely ambiguous.
- Do not commit files that look like secrets (`.env*`, keys, tokens).

## Step 2 — Subject line

Format: `type(scope): subject` or `type(scope): subject (#N)`.

**Types** (by frequency in history): `feat`, `fix`, `refactor`, `docs`, `test`, `i18n`, `style`, `chore`, `perf`, `polish`.

- `feat` — new behavior a user or API caller can see.
- `fix` — wrong behavior made right, including UI polish that corrects something off.
- `refactor` — same behavior, better structure (review follow-ups, simplification).
- `polish` — small UX refinements of a feature in progress (focus states, copy, thumbnails).
- `docs` — `docs(user-docs)`, `docs(requests)`, `docs(external-api)`, or bare `docs:` for cross-cutting references.
- `i18n` — translation-only commits (`i18n(share): translate the Manual tab into all nine locales`).
- `style` — formatter-only changes (`style(convex): reformat two files the formatter had drifted on`).
- `test` — test-only changes. `chore` — generated files, deps, tooling (`chore(convex): regenerate api.d.ts for ...`).

**Scope**: product area or package, lowercase kebab-case: `accounts`, `posts`, `replies`, `experiments`, `signals`, `checklist`, `calendar`, `report`, `links`, `providers`, `convex`, `worker`, `ui`, `docs`. Reuse a scope already in `git log` before inventing one. Two areas: `fix(requests,ui): ...`. Omit the scope only for truly cross-cutting changes.

**Subject**:

- Lowercase first word, imperative verb, no trailing period.
- Describe the behavior in product language, from the user's point of view, not the code mechanics. Plain verbs: add, drop, keep, show, hide, let, give, name, open, strip, stop, take, send, offer.
- Aim for ~60 characters; hard cap 72 before the issue suffix.
- A comma or "and" may join two closely related effects; an em dash may introduce a short list.
- Append `(#N)` when the work belongs to a GitHub issue (from the argument, the branch of work, or recent commits in the same series).

Good, from history:

```
fix(scheduler): let an optional appointment submit unbooked
feat(share): create the public link on publish, drop the empty state
fix(submissions): sort "Submitted at" by timestamp, not by its label
fix(email): keep bearer links out of click tracking, and greet by name
feat(requests): per-request documents via documents.create (#45)
refactor(documents): simplify the Documents block after review (#45)
test(e2e): bring the Playwright suite back to green
```

Bad: `fix: bug`, `feat(requests): Added new DocumentsService class.`, `update files`, `WIP`.

## Step 3 — Body

Skip the body only for self-explanatory one-liners (formatting, regenerated files, tiny copy fixes). Otherwise:

- Blank line after the subject, wrap at ~72 columns.
- Plain prose paragraphs. Open with the problem or the reason ("Guests could not see Requests anywhere in /try."), then what changed and how it behaves now.
- Name concrete identifiers exactly as they appear in code and API, as plain text without backticks (requests.create, fields.list, DOCUMENT_KEY_TAKEN, ?download=<name>).
- Mention follow-on effects briefly: "Docs across ten locales and the glossary follow.", "Also from the dev smoke: ...".
- For commits touching several independent areas, use `- Area: what changed.` bullets after a one-paragraph summary, and state verification results when relevant ("Full suite: 131 passed, 0 skipped.").
- No marketing tone, no file-by-file changelog, no restating the diff line by line.
- **Never** add `Co-Authored-By`, `Claude-Session`, "Generated with", or any attribution trailer.

## Step 4 — Commit

- Pass the message with a heredoc so wrapping survives:

  ```bash
  git commit -F - <<'EOF'
  type(scope): subject

  Body paragraph.
  EOF
  ```

- If a pre-commit hook fails, fix the cause, re-stage, and create a new commit. Never `--no-verify`, never `--amend` unless the user asks.
- Do not push unless the user asks.

## Step 5 — Report

One line per commit: short hash and subject. Then list anything left uncommitted and why.
