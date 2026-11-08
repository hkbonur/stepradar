---
title: Component Decomposition Pattern
description: Use this skill whenever you are writing or refactoring React components that should be decomposed into named JSX child sub-components instead of render-node props.
metadata:
  tags: [react, components, decomposition, jsx]
---

# Component Decomposition Pattern

## The Problem

A common React anti-pattern is passing renderable content via props:

```tsx
// ❌ Anti-pattern: render-node props
<OptionRow
  leftAdornment={<span>A</span>}
  rightAdornment={<CheckIcon />}
  hint="correct"
  hideHint={false}
>
  Paris
</OptionRow>
```

This looks convenient but causes several problems:

- The component's internal layout is invisible at the call site
- Props like `hideHint` are tightly coupled to `hint` — two props controlling one thing
- Adding new slots requires new props and touching the component internals
- It's hard to conditionally reorder, wrap, or style individual parts

## The Solution: Component Decomposition

Split the monolithic component into a **family of named sub-components**. Each sub-component owns one visual responsibility and is composed via JSX children.

```tsx
// ✅ Decomposed pattern
<OptionRow>
  <OptionRowBody>
    <OptionAdornment align="left">A</OptionAdornment>
    <OptionRowLabel>Paris</OptionRowLabel>
    <OptionAdornment align="right">
      <CheckIcon />
    </OptionAdornment>
  </OptionRowBody>
  <OptionHint hidden={false}>correct</OptionHint>
</OptionRow>
```

The structure of the UI is now **readable at the call site**.

---

## Rules of Decomposition

### 1. Root = layout only

The root component owns spacing, alignment, and the outer container. Nothing else.

```tsx
function Card({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-2 p-4 rounded border">{children}</div>
}
```

### 2. Named slots replace node props

Every `React.ReactNode` prop becomes its own sub-component.

```tsx
// Before
<Card header={<h2>Title</h2>} footer={<Button>Save</Button>} />

// After
<Card>
  <CardHeader>Title</CardHeader>
  <CardBody>...</CardBody>
  <CardFooter><Button>Save</Button></CardFooter>
</Card>
```

### 3. Variants use props, not separate components

When a slot has visual variants (left vs right, primary vs secondary), use a **single component with a prop** rather than two separate components.

```tsx
// ✅ One component, two variants
<OptionAdornment align="left">A</OptionAdornment>
<OptionAdornment align="right"><CheckIcon /></OptionAdornment>

// ❌ Avoid: LeftAdornment / RightAdornment as separate components
```

### 4. Behaviour props stay on the sub-component that owns the behaviour

Don't hoist behaviour props up to the root.

```tsx
// ❌ Root owns the hint's visibility — wrong
<OptionRow hideHint={true} hint="correct" />

// ✅ OptionHint owns its own visibility
<OptionHint hidden={true}>correct</OptionHint>
```

### 5. Keep the `className` / `style` escape hatch on every sub-component

Each sub-component should accept `className?: string` so consumers can adjust one part without forking the whole family.

---

## Simple Before / After Examples

### Example 1 — List Row

```tsx
// ❌ Before
<ListRow
  icon={<Avatar src={user.avatar} />}
  title={user.name}
  subtitle={user.email}
  action={<Button>Follow</Button>}
/>

// ✅ After
<ListRow>
  <ListRowIcon><Avatar src={user.avatar} /></ListRowIcon>
  <ListRowContent>
    <ListRowTitle>{user.name}</ListRowTitle>
    <ListRowSubtitle>{user.email}</ListRowSubtitle>
  </ListRowContent>
  <ListRowAction><Button>Follow</Button></ListRowAction>
</ListRow>
```

### Example 2 — Alert / Banner

```tsx
// ❌ Before
<Alert icon={<WarningIcon />} title="Watch out" description="This cannot be undone." />

// ✅ After
<Alert>
  <AlertIcon><WarningIcon /></AlertIcon>
  <AlertBody>
    <AlertTitle>Watch out</AlertTitle>
    <AlertDescription>This cannot be undone.</AlertDescription>
  </AlertBody>
</Alert>
```

### Example 3 — Form Field

```tsx
// ❌ Before
<Field
  label="Email"
  hint="We'll never share your email."
  leftIcon={<MailIcon />}
  error="Invalid address"
/>

// ✅ After
<Field>
  <FieldLabel>Email</FieldLabel>
  <FieldInputWrapper>
    <FieldIcon align="left"><MailIcon /></FieldIcon>
    <FieldInput type="email" />
  </FieldInputWrapper>
  <FieldHint>We'll never share your email.</FieldHint>
  <FieldError>Invalid address</FieldError>
</Field>
```

---

## Implementation Checklist

When decomposing a component, follow this order:

1. **Identify slots** — List every `React.ReactNode` prop. Each becomes a sub-component.
2. **Identify behaviour props** — Things like `hideHint`, `isHidden`, `isDisabled`. Move them to the sub-component they belong to.
3. **Name sub-components clearly** — Use `<Root><Part>` naming: `OptionRow` → `OptionRowBody`, `OptionRowLabel`, `OptionAdornment`, `OptionHint`.
4. **Root owns layout** — Outer container, flex/grid, gap, padding.
5. **Body owns visual shell** — Border, background, radius, shadow.
6. **Leaf components own content** — Typography, icons, colours, their own visibility logic.
7. **Add `className` to each** — Always provide an escape hatch.
8. **Export all sub-components** — The consumer should be able to import any part individually.

---

## Naming Conventions

| Role                | Example names                                       |
| ------------------- | --------------------------------------------------- |
| Root container      | `Card`, `OptionRow`, `ListItem`                     |
| Visual shell / body | `CardBody`, `OptionRowBody`, `ListItemBody`         |
| Primary text        | `CardTitle`, `OptionRowLabel`, `ListItemTitle`      |
| Secondary text      | `CardDescription`, `OptionHint`, `ListItemSubtitle` |
| Icon / adornment    | `CardIcon`, `OptionAdornment`, `ListRowIcon`        |
| Actions             | `CardFooter`, `ListRowAction`                       |
| Status / badge      | `CardBadge`, `FieldError`, `FieldHint`              |
