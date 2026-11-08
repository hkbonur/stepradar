---
title: One Source of Truth
impact: HIGH
tags: typescript, dry, constants, schemas, magic-numbers
---

Constraints, status values, error strings, limits, durations, and enums live in exactly one place. When the same literal appears in two files — or the same magic number in two `setTimeout`s — hoist it to a named constant.

## Why It Matters

- Prevents drift between modules that all encode the same constraint
- Validation, UI, and persistence layers stay aligned automatically
- Renames and limit changes happen in one place
- Magic numbers and inline status codes obscure intent — names document it

## ❌ Incorrect

```ts
// Same 254 + same error string in three places
// validators/email.ts
export function validateEmail(input: string) {
  if (input.length > 254) throw new Error('Email too long')
}
// components/EmailInput.tsx
<input maxLength={254} />
// api/users.ts
if (req.body.email.length > 254) return res.status(400).send('Email too long')

// Magic numbers and statuses
if (status === 2) { /* ... */ }
setTimeout(fn, 300)
```

## ✅ Correct

```ts
// domain/email.ts
export const EMAIL_MAX_LENGTH = 254
export const EMAIL_TOO_LONG_ERROR = 'Email too long'

// validators/email.ts
import { EMAIL_MAX_LENGTH, EMAIL_TOO_LONG_ERROR } from '@/domain/email'
export function validateEmail(input: string) {
  if (input.length > EMAIL_MAX_LENGTH) throw new Error(EMAIL_TOO_LONG_ERROR)
}

// Named constants for magic values
const STATUS = { PENDING: 1, APPROVED: 2, REJECTED: 3 } as const
const ANIMATION_DURATION_MS = 300

if (status === STATUS.APPROVED) { /* ... */ }
setTimeout(fn, ANIMATION_DURATION_MS)
```

## Additional Notes

- A schema (Zod, Convex validator) is often the right home — derive types and limits from one definition
- Don't hoist single-use values; the rule applies when ≥ 2 call sites share the literal, or when the literal hides intent
- Status enums and discriminator strings are prime candidates
- Use SCREAMING_SNAKE_CASE for module-level constants
