---
title: Stable Unique Keys for Lists
impact: MEDIUM
tags: react, lists, keys, correctness
---

Use a stable, item-identifying key when rendering arrays. Never use the array index for lists that can reorder, filter, or splice — React reuses DOM nodes by key, and an index key causes input state, animations, and refs to attach to the wrong row.

## Why It Matters

- Index keys silently corrupt local state in list children (form inputs lose values on reorder)
- A stable key lets React match items across renders even when the list reorders
- Animation and transition libraries rely on key stability

## ❌ Incorrect

```tsx
{items.map((item, index) => (
  <Item key={index} data={item} />          // breaks on reorder/filter
))}

{items.map((item) => (
  <Item key={Math.random()} data={item} />  // never matches across renders
))}
```

## ✅ Correct

```tsx
{items.map((item) => (
  <Item key={item.id} data={item} />
))}
```

## Additional Notes

- Index keys are only safe for static, append-only, never-reordered lists — and even then, prefer a real id
- If items lack ids, generate stable ones once at creation (e.g. `crypto.randomUUID()`), don't compute per render
- Composite keys are fine: `key={`${userId}-${tab}`}`
