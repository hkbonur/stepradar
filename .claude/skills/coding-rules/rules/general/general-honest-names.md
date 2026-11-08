---
title: Names Match Behavior
impact: MEDIUM
tags: typescript, naming, readability
---

Function names, return values, and error semantics describe what the code actually does. If `getUser` can return `null`, it's `findUser`. If `save` can mutate but also throw, the name says nothing about the throw — fix the name or the contract.

## Why It Matters

- Readers trust names and skim code based on them — dishonest names cause bugs
- Mis-named helpers leak misuse into call sites
- A rename is the cheapest refactor; do it as soon as the mismatch appears

## ❌ Incorrect

```ts
function getUser(id: string): User | null { /* ... */ }   // get-prefix implies presence
function validateEmail(email: string): boolean { /* throws on bad input */ }  // returns + throws
function loadConfig(): Config { /* uses cache */ }  // load implies fresh read
```

## ✅ Correct

```ts
function findUser(id: string): User | null { /* ... */ }
function isValidEmail(email: string): boolean { /* never throws */ }
function getCachedConfig(): Config { /* honest */ }
```

## Additional Notes

- Conventional prefixes carry meaning: `get*` = present, `find*` = maybe, `is/has/can*` = boolean, `assert*` = throws, `try*` = returns Result
- A `Promise<T>` return implies async — don't wrap synchronous code in `async` just to "future-proof"
- Error variants are part of the name's promise: `parseStrict` vs `parseLoose` is honest, `parse` (which sometimes throws sometimes returns null) is not
