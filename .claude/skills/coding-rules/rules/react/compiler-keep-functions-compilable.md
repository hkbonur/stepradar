---
title: Keep Components and Hooks Compilable
impact: HIGH
tags: compiler, react-compiler, refs, hooks, optimization
---

React Compiler memoizes every component and hook in both Vite apps and in Vitest. It never fails a build: a function it cannot prove safe is left as written, unmemoized, and nothing is printed. Write code the compiler can take, and check the skip report when touching a hot path.

```bash
node --experimental-strip-types scripts/react-compiler-report.ts --list
```

oxlint runs the compiler's own checks: `react/refs`, `react/immutability`, `react/purity` and `react/preserve-manual-memoization` warn, and `react/rules-of-hooks` is an error (conditional hooks, and a `useEffectEvent` function called outside an effect). A warning on a function you touch usually means the compiler skips it; fix it. The `try/finally` case below is not linted.

## Why It Matters

- A skipped function loses all memoization, and so does everything it passes down — no manual `useMemo` is there to catch it any more
- The skip is silent; only the report shows it
- Every skip reason below is also a real React rule violation or a stale-closure risk

## ❌ Incorrect

```tsx
// (1) Ref read or written during render — the largest skip reason in this repo
function Editor(props: Props) {
  const latest = React.useRef(props.value)
  latest.current = props.value // write during render
  const width = containerRef.current?.offsetWidth ?? 0 // read during render
}

// (2) A lint suppression opts the whole function out
React.useEffect(() => {
  setOpen(shouldBeOpen())
  // oxlint-disable-next-line react-hooks/exhaustive-deps
}, [routerState])

// (3) try/finally inside the component or hook body
async function handleSave() {
  setSaving(true)
  try {
    await save(props.form)
  } finally {
    setSaving(false)
  }
}

// (4) Mutating props, state, or a hook return value
props.items.sort(byOrder)
form.settings.title = title
```

## ✅ Correct

```tsx
// (1) Touch refs only in effects and handlers; measured values go in state
function Editor(props: Props) {
  const [width, setWidth] = React.useState(0)
  React.useLayoutEffect(() => {
    setWidth(containerRef.current?.offsetWidth ?? 0)
  }, [])
  const onChange = React.useEffectEvent(props.onChange) // latest value, no ref
}

// (2) List the real dependencies; reach for useEffectEvent when a value must not re-trigger
const syncOpen = React.useEffectEvent(() => setOpen(shouldBeOpen()))
React.useEffect(() => {
  syncOpen()
}, [routerState])

// (3) Move the try/finally to a module-level function
async function withFlag(setFlag: (on: boolean) => void, run: () => Promise<void>) {
  setFlag(true)
  try {
    await run()
  } finally {
    setFlag(false)
  }
}
const handleSave = () => withFlag(setSaving, () => save(props.form))

// (4) Copy, then change
const sorted = props.items.toSorted(byOrder)
const next = { ...form, settings: { ...form.settings, title } }
```

## Additional Notes

- A suppression that cannot be removed yet needs a comment saying why, and costs that function its memoization — keep the function small so the loss stays local
- Manual `useMemo`/`useCallback` with dependencies the compiler disagrees with is also a skip ("Existing memoization could not be preserved"); see [rerender-memo](./rerender-memo.md)
- Reading a ref inside an effect, an event handler, or a `useEffectEvent` callback is fine
- An effect that subscribes once but must call the latest handler wraps the handler in `React.useEffectEvent` — never mirror it into a ref by hand. Call the result only from effects: an event handler or a JSX prop calls the prop directly
- Test files are not compiled (`vitest.react-compiler.mts`); code under test is
- The Slate `editor` is one object that changes in place. A component or hook that reads it during render (`queryActiveMarks(editor)`, `ReactEditor.findPath(editor, element)`) must start its file with `'use no memo'`, or the compiler caches the first answer for as long as the editor lives. Those files keep manual memoization (ADR 0028)
- Call a prop through a local (`const onChange = props.onChange`, then `onChange(x)`): inside a closure the compiler treats `props.onChange(x)` as a dependency on all of `props`, which is new on every parent render
- `React.useMemo`, `React.useCallback` and `React.memo` are lint errors. One that has to stay says why on the line above: `// oxlint-disable-next-line no-restricted-properties -- <reason>`
- A compiled function can still leave one value unmemoized: the compiler drops a memo scope that would have to span a hook call (a value created before `useState(...)` and still "possibly mutated" after it, for example by a helper that receives it). When the identity of such a value matters (content handed to the form renderer, a list handed to an effect), keep a `React.useMemo` with a reason. Check the compiled output when in doubt: a memoized value reads `const x = t12`, an unmemoized one keeps its call, `const x = parse(props.content)`. The Preview tab lost focus on every keystroke this way
