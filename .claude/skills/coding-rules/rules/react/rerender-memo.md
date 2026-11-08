---
title: Let the Compiler Memo (And Know When It Cannot)
impact: MEDIUM
tags: rerender, memo, useMemo, useCallback, references, compiler, optimization
---

React Compiler memoizes values, callbacks, JSX, and inline prop literals in every compiled component and hook. `React.useMemo`, `React.useCallback` and `React.memo` are oxlint errors outside tests and the Astro apps. What is left for the author is the shape of the component:

1. **Extract** expensive subtrees so an early return runs before the work.
2. **Write props inline** — an inline `{}`, `[]`, or arrow keeps its identity until its inputs change. Hoist only what is truly static.
3. **Memo by hand only** where the compiler is not running: a skipped function, or a value whose identity is part of a contract.

## ❌ Incorrect

```tsx
// (1) Expensive work sits above an early return — memoized or not, it still runs
function Profile(props: { user: User; isLoading: boolean }) {
  const avatarId = computeAvatarId(props.user)
  if (props.isLoading) return <Skeleton />
  return <Avatar id={avatarId} />
}

// (2) Manual memo around props — noise, and a wrong dependency list makes the compiler skip the function
function Parent(props: { items: Item[]; onPick: (id: string) => void }) {
  const filters = React.useMemo(() => ({ active: true }), [])
  const handleSelect = React.useCallback((id: string) => props.onPick(id), [props.onPick])
  return <SubmissionList items={props.items} filters={filters} onSelect={handleSelect} sortKeys={['name', 'date']} />
}
```

## ✅ Correct

```tsx
// (1) Extract so the early return runs first
function UserAvatar(props: { user: User }) {
  return <Avatar id={computeAvatarId(props.user)} />
}
function Profile(props: { user: User; isLoading: boolean }) {
  if (props.isLoading) return <Skeleton />
  return <UserAvatar user={props.user} />
}

// (2) Inline literals; statics at module scope
const SORT_KEYS = ['name', 'date'] as const

function Parent(props: { items: Item[]; onPick: (id: string) => void }) {
  return <SubmissionList items={props.items} filters={{ active: true }} onSelect={(id) => props.onPick(id)} sortKeys={SORT_KEYS} />
}
```

## When Manual Memo Stays

Keep it, with the reason on the line above (`// oxlint-disable-next-line no-restricted-properties -- <reason>`), when:

- the function is on the skip list (`scripts/react-compiler-report.ts`) and cannot be fixed yet — in a skipped function every inline literal is a new reference each render
- identity is a contract: a value handed to non-React code (a Slate plugin list, DnD sensors, `addEventListener`), or a context value consumed outside compiled code
- the compiler leaves one value unmemoized inside a compiled function; see [compiler-keep-functions-compilable](./compiler-keep-functions-compilable.md)

Existing manual memo goes when the file is touched for another reason; confirm with the report that the function still compiles.

The compiler memoizes per component. It does not stop a child re-rendering because its props really changed; see [rerender-derive-over-effect](./rerender-derive-over-effect.md).
