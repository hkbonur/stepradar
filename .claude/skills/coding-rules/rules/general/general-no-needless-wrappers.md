---
title: Inline Needless Wrappers
impact: MEDIUM
tags: typescript, refactor, abstractions
---

Pass-through utilities, single-call mappers, and one-line helpers that exist only to give a name to a trivial expression should be inlined.

## Why It Matters

- Each abstraction costs a jump-to-definition for readers
- Single-use helpers usually leak the call site's context into a "general" signature
- Inlining surfaces what the code actually does at the call site

## ❌ Incorrect

```ts
function getUserName(user: User): string {
  return user.name
}

function isLoggedIn(user: User | null): boolean {
  return user !== null
}

function mapUsers(users: User[]) {
  return users.map(getUserName)
}
```

## ✅ Correct

```ts
const names = users.map(u => u.name)

if (user) { /* ... */ }
```

## Additional Notes

- A helper earns its name when (a) used in ≥ 2 places, OR (b) the body is non-trivial enough that the name is genuinely clearer than the expression
- Don't inline a wrapper that hides a real invariant (e.g. validation, normalization) — the name is documentation
- Re-exports that just rename without adding value are wrappers too
