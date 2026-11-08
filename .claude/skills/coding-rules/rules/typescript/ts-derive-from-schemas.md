---
title: Derive Types from Schemas
impact: MEDIUM
tags: typescript, types, schemas, zod, convex
---

When a schema (Zod, Convex validator, OpenAPI spec) defines the shape, derive the TS type from it instead of hand-writing a parallel interface.

## Why It Matters

- Schema and type cannot drift — one source defines both
- Refactors update both layers automatically
- Validation and types stay aligned at runtime + compile time

## ❌ Incorrect

```ts
const userSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  role: z.enum(['admin', 'member']),
})

interface User {
  id: string
  email: string
  role: 'admin' | 'member'
}
```

Two definitions of the same shape. Add a field, forget the other side, get a runtime mismatch.

## ✅ Correct

```ts
const userSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  role: z.enum(['admin', 'member']),
})

type User = z.infer<typeof userSchema>
```

## Additional Notes

- Convex: types come from `v.*` validators in `schema.ts` — use `Doc<'tableName'>` and `Infer<typeof v.*>`
- Don't derive types from a schema that's only used in tests — that's tail-wagging-dog
- Discriminated unions in schemas (`z.discriminatedUnion`) infer cleanly — prefer them over `z.union`
