---
title: Use Functional setState Updates
impact: MEDIUM
impactDescription: prevents stale closures and unnecessary callback recreations
tags: react, hooks, useState, callbacks, closures
---

## Use Functional setState Updates

When updating state based on the current state value, use the functional update form of setState instead of directly referencing the state variable. This prevents stale closures, eliminates unnecessary dependencies, and creates stable callback references.

**Incorrect (reads state captured at render time):**

```tsx
function TodoList() {
  const [items, setItems] = React.useState(initialItems)

  const addItems = (newItems: Item[]) => {
    setItems([...items, ...newItems]) // ❌ two calls in one tick: second overwrites first
  }

  const removeItem = async (id: string) => {
    await api.remove(id)
    setItems(items.filter((item) => item.id !== id)) // ❌ `items` is stale after the await
  }

  return <ItemsEditor items={items} onAdd={addItems} onRemove={removeItem} />
}
```

Both handlers close over the `items` of the render that created them. Batched calls and anything after an `await` work from an old list and drop updates.

**Correct (always the current state):**

```tsx
function TodoList() {
  const [items, setItems] = React.useState(initialItems)

  const addItems = (newItems: Item[]) => {
    setItems((curr) => [...curr, ...newItems])
  }

  const removeItem = async (id: string) => {
    await api.remove(id)
    setItems((curr) => curr.filter((item) => item.id !== id))
  }

  return <ItemsEditor items={items} onAdd={addItems} onRemove={removeItem} />
}
```

No `React.useCallback`: React Compiler caches the handlers, and because they no longer read `items` they keep one identity for the life of the component. The functional update is still required under the compiler — it is about reading the current state, not about re-renders.

**When to use functional updates:**

- Any setState that depends on the current state value
- Event handlers that reference state
- Async operations that update state

**When direct updates are fine:**

- Setting state to a static value: `setCount(0)`
- Setting state from props/arguments only: `setName(newName)`
- State doesn't depend on previous value
