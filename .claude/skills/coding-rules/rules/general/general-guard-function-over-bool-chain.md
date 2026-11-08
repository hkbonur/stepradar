---
title: Guard Function Over Boolean Chain
impact: MEDIUM
tags: typescript, react, control-flow, readability, predicates
---

When a derived boolean is the AND of three or more guard conditions, extract a small named function that returns the boolean via early returns — one guard per line. Don't pile guards into a single `&&` chain that the reader has to parse left-to-right and mentally invert.

A predicate **callback** (`filter` / `find` / `some` / `every` / a route `match`) follows the same rule from two conditions up: the callback already is the named boundary, so give it a block body with one early return per condition.

This complements [`general-early-returns`](./general-early-returns.md), which targets nested ternaries and if/else trees.

## Why It Matters

- Each guard reads as an independent precondition — the reader can stop at the first one that matters
- Adding or removing a guard is a one-line diff, not a re-balancing of `&&`/`||` precedence
- Mixed-polarity chains (`a && !b && c && d !== 'x'`) become uniform — every guard returns `false` (or `true`) explicitly

## ❌ Incorrect

```ts
const showEmptyLanding = childFolders.length === 0 && forms.length === 0 && !hasActiveFilters && formsStatus !== 'LoadingFirstPage'

const dangling = refs.filter((r) => r.fieldId != null && !liveIds.has(r.fieldId))
```

## ✅ Correct

```ts
function shouldShowEmptyLanding() {
  if (formsStatus === 'LoadingFirstPage') return false
  if (hasActiveFilters) return false
  if (childFolders.length > 0) return false
  if (forms.length > 0) return false
  return true
}

const dangling = refs.filter((r) => {
  if (r.fieldId == null) return false
  return !liveIds.has(r.fieldId)
})
```

## When It Doesn't Apply

- Two guards outside a callback: `if (a && b) return x` is fine
- Uniform-polarity predicates that read like math: `x > 0 && x < 100`
- Calls to helpers that are already named: `isReady() && isAuthorized()`
- A single-condition callback: `(x) => x.active`
- A null guard on a value the type already says is non-null — drop the guard, don't expand it

## Naming

- `shouldX()` / `canX()` / `isX()` — the verb prefix signals a predicate, and the name replaces the comment you would otherwise write above the chain
- Call it at the use site: `{shouldShowEmptyLanding() ? <Landing /> : <List />}` — no intermediate `const`
- The name must match what it returns: [`general-honest-names`](./general-honest-names.md)
