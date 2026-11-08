---
name: cleanup
description: Explicit-only post-change simplification workflow for changed TypeScript and React files. Invoke only as `$cleanup`; do not trigger automatically after ordinary implementation, review, testing, or refactoring.
---

# Cleanup

Post-change simplification pass. Use after a feature or fix is working but before it merges. Two passes, run in order, scoped to recently-changed files.

This skill describes the **process** — what to inspect, what questions to ask, when to stop. It delegates the _patterns_ (what good code looks like) to [`../coding-rules/SKILL.md`](../coding-rules/SKILL.md). Open the rule files while applying this skill.

## When to Use

- Right after finishing an ad-hoc feature or fix, before opening a PR
- During code review when the diff smells over-complicated

Do not run on:

- Unrelated old code — scope to what changed in this branch
- Pure refactors that already are the cleanup
- One-line typo fixes

## How to Run It

### Step 1 — Identify the change scope

```bash
git diff --name-only main...HEAD          # branch diff
git diff --name-only HEAD~1               # last commit
git diff --name-only --staged             # staged work
```

Pick whichever matches the cleanup window. Discard test snapshots, lockfiles, generated code.

### Step 2 — Decide which passes to run

| Files changed                                        | Run                                               |
| ---------------------------------------------------- | ------------------------------------------------- |
| Only `.ts` (no `.tsx`, no UI components)             | TypeScript pass only                              |
| `.tsx` or files in `components/` / `app/` / `pages/` | TypeScript pass, then React pass                  |
| Mixed                                                | TypeScript pass, then React pass on the UI subset |

Skipping the TS pass is never correct when UI changed — type-shape and data-model issues drag through React unchanged otherwise.

### Step 3 — TypeScript pass

Inspect every changed `.ts` and `.tsx` file. For each, walk the **focus areas** and **required checks** below. When a check fires, open the matching rule under `../coding-rules/rules/general/` or `../coding-rules/rules/typescript/` and apply.

**Focus areas**

- One source of truth for constants, validation, and derived values
- Narrow or shared types over broad / duplicated ones
- Dead branches, unused helpers, expired compatibility layers — gone
- Plain data shapes over encoded composites or boolean-flag combinations
- Wrappers, pass-through utilities, and intermediate transforms — collapsed
- Early returns where they make null/loading paths explicit
- Names, return values, and error handling honest to actual behavior
- Shared constants or schemas for any literal appearing ≥ 2 places

**Required checks** — answer each per changed file

1. Are constraints, status values, or error strings duplicated where one shared definition would do? → [`general-one-source-of-truth`](../coding-rules/rules/general/general-one-source-of-truth.md)
2. Do declared types allow states the runtime rejects? → [`ts-narrow-types`](../coding-rules/rules/typescript/ts-narrow-types.md), [`ts-discriminated-unions`](../coding-rules/rules/typescript/ts-discriminated-unions.md)
3. Is any optional, nullable, or assertion hiding an invariant that should be modeled? → [`ts-no-any-no-assertions`](../coding-rules/rules/typescript/ts-no-any-no-assertions.md), [`ts-narrow-types`](../coding-rules/rules/typescript/ts-narrow-types.md)
4. Can a wrapper, mapper, or helper be inlined without losing reuse or readability? → [`general-no-needless-wrappers`](../coding-rules/rules/general/general-no-needless-wrappers.md)
5. Do names, return shapes, and error semantics match what the code does? → [`general-honest-names`](../coding-rules/rules/general/general-honest-names.md), [`general-no-silent-fallbacks`](../coding-rules/rules/general/general-no-silent-fallbacks.md)
6. Any legacy code, unreachable branches, or `// removed`-style placeholders still present? → [`general-delete-dead-code`](../coding-rules/rules/general/general-delete-dead-code.md)
7. Could a nested conditional become an early-return chain without changing semantics? → [`general-early-returns`](../coding-rules/rules/general/general-early-returns.md)
8. Is a derived boolean built from 3+ guards joined by `&&`/`||`? Extract to a named guard function with one early return per guard. → [`general-guard-function-over-bool-chain`](../coding-rules/rules/general/general-guard-function-over-bool-chain.md)
9. Is a hand-written interface duplicating a schema definition? → [`ts-derive-from-schemas`](../coding-rules/rules/typescript/ts-derive-from-schemas.md)

After applying suggestions:

- Re-run type-check (`pnpm tsc:check` or repo equivalent)
- Re-run unit tests for the affected modules
- Commit cleanups separately from the original feature commit (`refactor(<scope>): simplify ...`)

### Step 4 — React pass (only if UI changed)

Inspect every changed `.tsx` and component file. The TS pass covered data shapes; this pass covers component, state, and UI behavior.

**Focus areas**

- One source of truth for UI copy, interaction rules, displayed state
- Mirrored props, duplicated local state, effect-driven derived state — gone
- Interaction-only logic out of effects, into render or event handlers
- Dead state, unused hooks, render-only wrappers — gone
- Component boundaries, prop flows, local state — each component has a clear job
- Legacy or compatibility UI branches — gone unless explicitly required

**Required checks** — answer each per changed component

1. Is local state duplicating props, server data, form state, or URL state? → [`rerender-derive-over-effect`](../coding-rules/rules/react/rerender-derive-over-effect.md)
2. Can any effect be removed by deriving in render or moving into an event handler? → [`rerender-derive-over-effect`](../coding-rules/rules/react/rerender-derive-over-effect.md), [`rerender-move-effect-to-event`](../coding-rules/rules/react/rerender-move-effect-to-event.md)
3. Do loading, empty, success, disabled, error states all reflect runtime conditions? → [`general-early-returns`](../coding-rules/rules/general/general-early-returns.md)
4. Is UI copy duplicated across branches when it should be one shared source? → [`general-one-source-of-truth`](../coding-rules/rules/general/general-one-source-of-truth.md)
5. Does this component boundary remove complexity or just shuffle JSX/state? → [`style-component-decomposition`](../coding-rules/rules/react/style-component-decomposition.md), [`style-component-organization`](../coding-rules/rules/react/style-component-organization.md)
6. Is JSX deeply nested, or a component taking render-node props? → [`style-component-decomposition`](../coding-rules/rules/react/style-component-decomposition.md). Destructured props and `cn()` conditionals are lint errors; `pnpm quality:check` reports them
7. Manual `useMemo`/`useCallback`/`React.memo` added in compiled code, or a ref read in render, lint suppression, or `try/finally` that makes React Compiler skip the function? → [`rerender-memo`](../coding-rules/rules/react/rerender-memo.md), [`compiler-keep-functions-compilable`](../coding-rules/rules/react/compiler-keep-functions-compilable.md)
8. Async work serialized when independent? → [`async-parallel`](../coding-rules/rules/react/async-parallel.md), [`async-defer-await`](../coding-rules/rules/react/async-defer-await.md)

After applying:

- Re-run unit + component tests
- For visible UI changes: start the dev server, exercise the golden path + one edge case in a browser
- Commit cleanups separately

### Step 5 — Stop conditions

Stop the cleanup pass when **any** is true:

- Every required check passes for every changed file
- Two consecutive passes find nothing to fix (avoid sanding past polish)
- A suggested change would require expanding scope beyond the diff — note it for a follow-up commit, do not chase it now
- A test breaks under a "simplification" — revert the change; the test is the spec

## Hard Rules

- **Never accept a cleanup that deletes a test.** The test exists for a reason; if it's wrong, the fix is to fix the test, not delete it.
- **Never expand scope beyond the diff.** Found old crud in unrelated files? File a separate task. Cleanup pass is bounded.
- **Never bundle cleanup with feature work.** Separate commits, separate diffs.
- **Re-run type-check + tests** after every change. Confirm green before moving on.

## Anti-Patterns

- "Cleanup" pass that adds new abstractions
- Memoization added without a measurement showing it matters
- Refactor that swaps clarity for cleverness
- Renames that aren't load-bearing — pure churn
- Splitting a working component into three tiny ones "for separation"

## Composition

This skill is invoked explicitly by users. It delegates patterns to [`coding-rules`](../coding-rules/SKILL.md). Treat the rule files as the source of truth for _how_ to fix something — this skill only tells you _what to look for_ and _when to stop_.
