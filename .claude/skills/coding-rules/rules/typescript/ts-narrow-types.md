---
title: Narrow Types Over Broad
impact: HIGH
tags: typescript, types, modeling
---

Declared types should describe only states the runtime can actually reach. If the type allows `null` but the function never returns `null`, the type is wrong.

## Why It Matters

- Callers stop writing defensive branches for impossible states
- The compiler catches misuse instead of letting it surface as a runtime bug
- The type signature documents real behavior — no need to read the body

## ❌ Incorrect

```ts
function getUser(id: string): User | null | undefined {
  const user = db.users.find(id)
  if (!user) throw new Error('not found')
  return user
}
```

Returns `User | null | undefined`, but the body only ever returns `User` or throws. Every caller writes a useless null check.

## ✅ Correct

```ts
function getUser(id: string): User {
  const user = db.users.find(id)
  if (!user) throw new Error('not found')
  return user
}
```

## Additional Notes

- Narrow inputs too — accept `UserId` (branded) instead of `string` when only IDs are valid
- Optional fields that are always set in practice are a code smell — either model the variants or remove the optional
- If you need `T | undefined`, name *why* (e.g. `Loading<T>`) instead of leaking the union to every caller
