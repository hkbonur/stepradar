---
name: coding-rules
description: Passive repository guidance for general code clarity (control flow, naming, dead code), TypeScript type modeling, and React performance, React Compiler compatibility, re-render hygiene, and code style. Use implicitly while writing, reviewing, or refactoring relevant code, or when another skill requests a rule. This is not a process workflow; it never requires TDD, cleanup, commits, or worktrees.
---

# Coding Rules

Knowledge base of small, self-contained rule files for this React + TypeScript + Convex monorepo. Each rule describes _what good looks like_; process skills (`cleanup`, `tdd`) describe _when to apply them_.

## When to Use

- Writing or reviewing new code — open the rule for the pattern at hand
- Loaded by [`cleanup`](../cleanup/SKILL.md) during a post-change pass
- Standalone lookup ("how do we model state machines here?")

Rules don't run on their own. Read the file directly when applying — don't paraphrase from this index.

## Enforced by oxlint

The linter checks these, so they have no rule file: fix what it reports. Errors fail CI and `pnpm quality:check`. Config: `.oxlintrc.json`; repo-specific rules: `scripts/oxlint-plugin-studio.mjs`.

| Convention                                                                       | Lint rule                                           | Scope notes                                                                                                                         |
| -------------------------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| No `useMemo` / `useCallback` / `React.memo` in compiled code                     | `no-restricted-properties`, `no-restricted-imports` | Off in tests and the Astro apps; a kept one needs a disable comment with the reason ([rerender-memo](rules/react/rerender-memo.md)) |
| `import React from 'react'`, hooks as `React.useState`                           | `no-restricted-imports`                             | Off in tests and the Astro apps                                                                                                     |
| `props.x`, never destructure the props parameter                                 | `studio/no-destructure-props`                     | `.tsx` only; off in `packages/ui` (shadcn-style primitives) and tests                                                               |
| `cn()` conditionals as objects: `cn('base', { 'class': cond }, props.className)` | `studio/cn-object-syntax`                         | Flags `cond && 'class'` and ternaries with an empty branch; a two-class ternary is fine                                             |
| JSX render: `cond && <X />`, never `cond ? <X /> : null`                        | `studio/no-jsx-ternary-null`                      | Flags a ternary with a JSX branch and a `null` branch, either order; a ternary between two elements is fine                         |
| Kebab-case filenames                                                             | `unicorn/filename-case`                             | Off in `packages/convex`, `src/routes/**`, i18n catalogs and locales                                                                |
| Hooks unconditional; `useEffectEvent` results called only from effects           | `react/rules-of-hooks`                              |                                                                                                                                     |
| No state synced from props in an effect                                          | `react/no-deriving-state-in-effects`                | Fix pattern in [rerender-derive-over-effect](rules/react/rerender-derive-over-effect.md)                                            |
| No `else` after `return`; no lone `if` inside `else`                             | `no-else-return`, `no-lonely-if`                    |                                                                                                                                     |
| No ref access, mutation, or impure calls in render                               | `react/refs`, `react/immutability`, `react/purity`  | Warnings: the existing backlog is not fixed yet. Don't add to it                                                                    |

Considered and not enabled, because the backlog is too large to fix in one pass: `unicorn/no-nested-ternary` (~110 sites), `react/no-array-index-key` (~70), `typescript/no-explicit-any` (~750), `typescript/no-non-null-assertion` (~1,000). The rule files still cover them.

## Rule File Shape

1. Frontmatter: `title`, `impact`, `tags`
2. One-paragraph statement
3. **Why It Matters** — bullet reasons
4. **❌ Incorrect** + **✅ Correct** — code examples
5. **Additional Notes** — edge cases, exceptions, related rules

## General

Language-agnostic: control flow, naming, single source of truth, dead code. Apply higher-impact rules first.

| Impact | Rule                                                                                              | Topic                                                               |
| ------ | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| HIGH   | [general-no-silent-fallbacks](rules/general/general-no-silent-fallbacks.md)                       | Throw or return typed errors; never stub-on-failure                 |
| HIGH   | [general-one-source-of-truth](rules/general/general-one-source-of-truth.md)                       | Hoist shared constraints, statuses, magic numbers                   |
| MEDIUM | [general-honest-names](rules/general/general-honest-names.md)                                     | `find*` vs `get*`, `try*` vs `parse*` — names match contract        |
| MEDIUM | [general-early-returns](rules/general/general-early-returns.md)                                   | Guard clauses over nested ternaries and if/else trees               |
| MEDIUM | [general-guard-function-over-bool-chain](rules/general/general-guard-function-over-bool-chain.md) | 3+ guards (2+ in a predicate callback) → one early return per guard |
| MEDIUM | [general-no-needless-wrappers](rules/general/general-no-needless-wrappers.md)                     | Inline single-use pass-through helpers                              |
| MEDIUM | [general-delete-dead-code](rules/general/general-delete-dead-code.md)                             | Remove legacy shims, stale branches, commented-out code             |

## TypeScript

Type system only: what a declared type promises.

| Impact | Rule                                                                   | Topic                                                                                     |
| ------ | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| HIGH   | [ts-narrow-types](rules/typescript/ts-narrow-types.md)                 | Declared types match runtime states only                                                  |
| HIGH   | [ts-discriminated-unions](rules/typescript/ts-discriminated-unions.md) | Model state machines with tagged unions                                                   |
| HIGH   | [ts-no-any-no-assertions](rules/typescript/ts-no-any-no-assertions.md) | Avoid `any`, `as Foo`, and `!` outside boundaries; a cast restating a known shape is fine |
| MEDIUM | [ts-derive-from-schemas](rules/typescript/ts-derive-from-schemas.md)   | `z.infer` / Convex `Doc` over hand-written interfaces                                     |

## React

Priority ladder: compiler > async > re-render > style. React Compiler runs in both Vite apps and in Vitest, so rules assume compiled code.

| Impact      | Rule                                                                                    | Topic                                                                                                        |
| ----------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| HIGH        | [compiler-keep-functions-compilable](rules/react/compiler-keep-functions-compilable.md) | No refs in render, no lint suppressions, no `try/finally`, no mutation — or the function is silently skipped |
| CRITICAL    | [async-parallel](rules/react/async-parallel.md)                                         | `Promise.all()` for independent operations                                                                   |
| HIGH        | [async-defer-await](rules/react/async-defer-await.md)                                   | Move `await` into branches that actually use it                                                              |
| MEDIUM      | [rerender-derive-over-effect](rules/react/rerender-derive-over-effect.md)               | Derive in render; subscribe to booleans; narrow effect deps                                                  |
| MEDIUM      | [rerender-memo](rules/react/rerender-memo.md)                                           | Compiler memoizes; inline prop literals; extract for early returns; manual memo only with a reason           |
| MEDIUM      | [rerender-functional-setstate](rules/react/rerender-functional-setstate.md)             | `setX(curr => ...)` so handlers never read stale state                                                       |
| MEDIUM      | [rerender-lazy-state-init](rules/react/rerender-lazy-state-init.md)                     | Function form of `useState` for expensive initial values                                                     |
| MEDIUM      | [rerender-move-effect-to-event](rules/react/rerender-move-effect-to-event.md)           | User-action side effects belong in handlers                                                                  |
| MEDIUM      | [rerender-use-ref-transient-values](rules/react/rerender-use-ref-transient-values.md)   | `useRef` for high-frequency non-render values                                                                |
| MEDIUM      | [style-list-keys](rules/react/style-list-keys.md)                                       | Stable unique keys; never index keys for reorderable lists                                                   |
| CONSISTENCY | [style-naming-conventions](rules/react/style-naming-conventions.md)                     | `Props`, handlers, booleans, hooks, files                                                                    |
| CONSISTENCY | [style-component-organization](rules/react/style-component-organization.md)             | Internal order, import order, folder structure                                                               |
| CONSISTENCY | [style-component-decomposition](rules/react/style-component-decomposition.md)           | Named JSX child sub-components, not render-node props                                                        |

## Layout

```
rules/
├── general/       control flow, naming, single source of truth, dead code
├── typescript/    type modeling
└── react/         compiler, async, re-render, style
```
