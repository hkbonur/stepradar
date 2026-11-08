---
title: No Silent Fallbacks
impact: HIGH
tags: typescript, errors, correctness
---

When a function can't perform its job, throw or return a typed error — never return a stub, empty object, or `undefined` that the caller will treat as success.

## Why It Matters

- Silent fallbacks turn bugs into silent data corruption
- Callers can't distinguish "no result" from "operation failed"
- Errors stay close to the cause, not three layers downstream

## ❌ Incorrect

```ts
function parseConfig(raw: string): Config {
  try {
    return JSON.parse(raw)
  } catch {
    return {} as Config  // pretends to succeed
  }
}

function findUser(id: string): User {
  const u = db.find(id)
  return u ?? { id: '', name: '', email: '' }  // fake user
}
```

## ✅ Correct

```ts
function parseConfig(raw: string): Config {
  return JSON.parse(raw)  // let it throw
}

function findUser(id: string): User {
  const u = db.find(id)
  if (!u) throw new Error(`user ${id} not found`)
  return u
}

// or, if "not found" is a valid state:
function findUser(id: string): User | null {
  return db.find(id) ?? null
}
```

## Additional Notes

- "Not found" is a valid domain state — model it (`User | null`, `Result<User>`). That's not a silent fallback
- A silent fallback is when the type *says* you got a result but you didn't
- `??` and `||` for default values are fine when the default is a *real* default, not a stub
