---
title: Component & Folder Organization
impact: CONSISTENCY
tags: react, organization, structure
---

Two layers of organization: **inside a file** (what comes first) and **across the tree** (where a file lives).

## Inside a Component

Order: imports → `Props` → component body in the order below.

```tsx
import React from 'react'
import { useQuery } from 'convex/react'              // external

import { Button } from '@/components/ui/button'      // internal absolute
import { cn } from '@/lib/utils'

import { LocalChild } from './local-child'           // relative

import type { User } from '@/types'                  // type imports last

interface Props {
  user: User
  onSave: (user: User) => void
}

export function UserCard(props: Props) {
  // 1. State
  const [isEditing, setIsEditing] = React.useState(false)

  // 2. Derived values (inline — React Compiler caches them)
  const fullName = `${props.user.firstName} ${props.user.lastName}`

  // 3. Callbacks (plain functions — no React.useCallback, see rerender-memo)
  const handleSave = () => {
    props.onSave(props.user)
  }

  // 4. Effects (keep minimal — see rerender-derive-over-effect)
  React.useEffect(() => { /* side effects only */ }, [])

  // 5. Early returns
  if (!props.user) return null

  // 6. Render
  return <div>{fullName}</div>
}
```

## Folder Structure

```
apps/<app>/src/
  components/
    features/                # Domain features — each folder is one cohesive surface
      form-editor/
        form-editor.tsx
        form-editor-toolbar.tsx
        use-form-editor.ts
        hooks/                       # group local hooks if >3 files
      form-submissions/              # group-of-features when multiple folders share a domain
        submission-tabs-toolbar/
        question-summary-card/
          views/                     # sub-group inside a feature
          pagination/
    shared/                  # Primitives — zero domain knowledge, widely imported
      card-action-rail.tsx
      dialog/                        # related primitives → subfolder
        alert-dialog.tsx
        index.ts                     # barrel OK for cohesive primitive set
    layout/                  # App shell / chrome
    providers/               # Cross-cutting context providers (≥5 consumers)
  pages/                     # Page-level components, one folder per route
  hooks/                     # Cross-feature hooks
  routes/                    # TanStack Router — filenames define URLs, DO NOT rename
  lib/  utils/  types/
```

### Where does a new file go?

- **Domain-aware**, used by one area → `features/<feature>/`
- **Domain-aware**, used by two adjacent areas → parent feature group (`features/form-submissions/` wraps siblings)
- **Zero domain knowledge**, >3 consumers across features → `shared/`
- **App shell** → `layout/`
- **Context provider** with >5 consumers across unrelated features → `providers/`
- **Route** → `routes/` (filename matters)

### Subfolders inside a feature

Add one per coherent sub-domain once the feature has **10+ files** and a natural cluster exists (`charts/`, `filters/`, `views/`). A single file doesn't justify a subfolder.

### Barrels (`index.ts`)

Avoid barrels — they encourage circular imports and complicate tree-shaking. Keep existing ones where the set is truly cohesive (e.g. `shared/dialog/index.ts`). For features, prefer explicit imports.

## Additional Notes

- One component per file
- Extract reusable logic into custom hooks (with tests)
- Keep components focused on one responsibility
