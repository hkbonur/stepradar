---
title: Early Returns Over Nested Conditionals
impact: MEDIUM
tags: typescript, react, control-flow, readability
---

When a function or component has guard conditions, return early. Don't pile branches into a nested ternary or nested `if`/`else` when an early return makes the null/loading/error path explicit. Applies equally to plain functions, hooks, and component bodies.

oxlint enforces the mechanical part (`no-else-return`, `no-lonely-if`). Nested ternaries are not linted yet; they are on you.

## Why It Matters

- The reader doesn't have to track which branch they're in
- Each guard reads as a precondition, not a side path
- Type narrowing is automatic — the rest of the function operates on the narrowed type

## ❌ Incorrect

```ts
function format(user: User | null, status: Status) {
  return user
    ? status === 'active'
      ? `${user.name} (active)`
      : status === 'pending'
        ? `${user.name} (pending)`
        : user.name
    : 'unknown'
}
```

```tsx
function SubmissionList(props: Props) {
  return props.isLoading ? <Spinner /> : props.items.length === 0 ? <Empty /> : <List items={props.items} />
}
```

## ✅ Correct

```ts
function format(user: User | null, status: Status) {
  if (!user) return 'unknown'
  if (status === 'active') return `${user.name} (active)`
  if (status === 'pending') return `${user.name} (pending)`
  return user.name
}
```

```tsx
function SubmissionList(props: Props) {
  if (props.isLoading) return <Spinner />
  if (props.items.length === 0) return <Empty />
  return <List items={props.items} />
}
```

## Additional Notes

- Preserve the declared return type — don't change `T | null` to `T` just because every branch happens to return `T`
- Early returns + `switch` on discriminated unions is the cleanest combo for state-machine code
- One-level ternaries are fine; the issue is _nested_ ones
- In components, handle `loading` / `error` / `empty` with early returns before the main render — but after every hook call (`react/rules-of-hooks`)
