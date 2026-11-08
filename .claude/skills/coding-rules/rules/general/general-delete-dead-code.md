---
title: Delete Dead Code and Legacy Branches
impact: MEDIUM
tags: typescript, refactor, cleanup
---

Unused exports, unreachable branches, compatibility shims for migrations that finished, and `// removed` placeholders should be deleted, not preserved.

## Why It Matters

- Dead code grows: every reader spends attention deciding if it's load-bearing
- Compatibility shims invite re-adoption of the thing you migrated away from
- Git history is the right place for archived code, not the working tree

## ❌ Incorrect

```ts
// Old API kept for backwards compat — TODO remove after Q3 migration
export function legacyGetUser(id: string) {
  return findUser(id)
}

function classify(input: Status) {
  if (input === 'active') return 'a'
  if (input === 'pending') return 'p'
  if (input === 'archived') return 'x' // 'archived' removed from Status type
  return 'unknown' // unreachable now
}

// const oldHelper = ... — kept for reference
```

## ✅ Correct

```ts
function classify(input: Status) {
  switch (input) {
    case 'active':
      return 'a'
    case 'pending':
      return 'p'
  }
}
```

Delete `legacyGetUser`, the unreachable branch, and the commented-out helper.

## Additional Notes

- The mechanical cases are caught for you: `pnpm knip` (unused files, exports, dependencies), oxlint `no-unused-vars` and `no-unreachable`. What stays manual is code that is still referenced but no longer needed — shims, fallback branches for removed states, commented-out blocks
- Use the type system: an exhaustive `switch` over a union catches removed variants automatically
- Trust git — if you might want it back, the SHA is enough
- Tests for deleted features go too. A test that exercises only the shim isn't load-bearing
