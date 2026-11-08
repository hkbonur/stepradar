/** `items` in runs of `size`, in order; the last run holds what is left. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new Error(`cannot chunk by ${size}`)
  const runs: T[][] = []
  for (let from = 0; from < items.length; from += size) runs.push(items.slice(from, from + size))
  return runs
}
