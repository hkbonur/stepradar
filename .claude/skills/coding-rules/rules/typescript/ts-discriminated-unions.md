---
title: Model Valid States with Discriminated Unions
impact: HIGH
tags: typescript, types, modeling, state
---

Replace boolean-flag soup and loosely-related option bags with discriminated unions when invalid combinations exist.

## Why It Matters

- Encodes "these states cannot coexist" in the type system, not in runtime asserts
- Eliminates `if (loading && error)` style impossible branches
- Compiler narrows automatically — no manual type guards
- Reviewers see the full state space in one definition

## ❌ Incorrect

```ts
interface FetchState<T> {
  loading: boolean
  data: T | null
  error: Error | null
}
```

Allows `{ loading: true, data: someData, error: someError }` — which the runtime never produces but every consumer must guard against.

## ✅ Correct

```ts
type FetchState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; error: Error }

function render(state: FetchState<User>) {
  switch (state.status) {
    case 'idle': return null
    case 'loading': return <Spinner />
    case 'success': return <UserCard user={state.data} />  // narrowed
    case 'error': return <Error message={state.error.message} />
  }
}
```

## Additional Notes

- Pick a discriminator name and use it consistently across the codebase (`status`, `kind`, `type`)
- String discriminators read better in logs than numeric ones
- If only two states exist with no shared fields, a plain union is fine — discriminants pay off at 3+ variants
