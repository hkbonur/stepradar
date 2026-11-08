---
title: No `any`, No Casual Assertions
impact: HIGH
tags: typescript, types, safety
---

Avoid `any`, `as Foo`, and `!` non-null assertions except at clearly-marked system boundaries (parsing, third-party untyped APIs). Inside the project, model the value correctly instead.

## Why It Matters

- `any` disables type-checking transitively — one `any` poisons every downstream signature
- Assertions hide invariants from the compiler instead of expressing them
- Future readers can't tell whether an assertion is load-bearing or a leftover

## ❌ Incorrect

```ts
function processForm(data: any) {
  return data.fields.map((f: any) => f.value as string)
}

const user = users.find((u) => u.id === id)!
console.log(user.name)
```

## ✅ Correct

```ts
function processForm(data: FormSubmission) {
  return data.fields.map((f) => f.value)
}

const user = users.find((u) => u.id === id)
if (!user) throw new Error(`user ${id} not found`)
console.log(user.name)
```

## Additional Notes

- Boundary parsing (e.g. `JSON.parse` results, `fetch().json()`) is the right place for `unknown` + a schema validator
- `as const` and `as never` are not the same as `as Foo` — those narrow, they don't claim
- If you must assert, comment WHY in one line: invariant, recently-checked, or reason the compiler can't see it
- Not linted: `typescript/no-explicit-any` and `no-non-null-assertion` would flag ~750 and ~1,000 existing sites. Don't add new ones

## Allowed: Restating a Shape the Code Already Guarantees

A local cast that re-states what the surrounding code has already established is fine, and reads better than a type-guard chain whose first half can never be false. Slate is the common case: code walking `editor.children` knows it holds elements.

```ts
// ❌ The guard is dead code, and it pushes the condition toward a 3-guard chain
if (Element.isElement(node) && node.type === 'paragraph' && Editor.string(editor, path) === '') {
}

// ✅
if ((node as Element).type === 'paragraph' && Editor.string(editor, path) === '') {
}
```

Keep the runtime guard when the value crosses a boundary (network, user input, untyped third-party API) or the discriminant can really be missing (partial test mocks). Long term, narrow the shared type so the cast goes away ([`ts-narrow-types`](./ts-narrow-types.md)).
