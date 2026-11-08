---
title: Naming Conventions
impact: CONSISTENCY
tags: react, naming, conventions, props
---

Consistent names for components, hooks, handlers, props, and files.

## Quick Reference

| Type                | Convention           | Example                                                  |
| ------------------- | -------------------- | -------------------------------------------------------- |
| Components          | PascalCase           | `UserProfileCard`                                        |
| Props interface     | `Props`              | `interface Props { ... }`, not `UserProfileCardProps`    |
| Hooks               | camelCase, `use*`    | `useUserData`                                            |
| Internal handlers   | `handle*` prefix     | `handleClick`                                            |
| Callback props      | `on*` prefix         | `onClick`, `onSave`                                      |
| Boolean state/props | `is/has/should*`     | `isLoading`, `hasError`                                  |
| Files & folders     | kebab-case           | `user-profile-card.tsx` (oxlint `unicorn/filename-case`) |
| Constants           | SCREAMING_SNAKE_CASE | `MAX_RETRY_COUNT` (see `general-one-source-of-truth`)    |

## Props Interface

A file with one component names its props `Props`: renaming the component doesn't rename the interface, and every file reads the same. Don't export it. A file with several components gives the secondary ones descriptive names, or types them inline when small.

```tsx
interface Props {
  user: User
  onSave: (user: User) => void
}

export function UserCard(props: Props) {
  // ...
}
```

## Handlers vs Callback Props

```tsx
interface Props {
  onClick?: () => void // 'on' prefix — caller-facing
}

function Button(props: Props) {
  const handleClick = () => {
    // 'handle' prefix — internal
    props.onClick?.()
  }
  return <button onClick={handleClick} />
}
```

## Boolean Names

```tsx
// ✅
const [isLoading, setIsLoading] = React.useState(false)
<Modal isOpen={isOpen} />

// ❌ — bare nouns/adjectives without is/has/should
const [loading, setLoading] = React.useState(false)
<Modal open={open} />
```

## Filenames

Linted outside Convex (camelCase modules), `src/routes/**` (TanStack Router derives URLs from filenames) and the i18n catalogs. What the linter can't see: a multi-letter acronym stays one kebab token — `useOAuthPopup` → `use-oauth-popup.ts`, not `use-o-auth-popup.ts`.
