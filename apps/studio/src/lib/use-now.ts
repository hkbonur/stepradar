import React from 'react'

/**
 * The clock, read again every `intervalMs`. A duration on screen ("for 2
 * min") is computed from it, so it keeps counting between the backend's
 * pushes, which only come when a job changes.
 */
export function useNow(intervalMs: number): number {
  const [now, setNow] = React.useState(() => Date.now())
  React.useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(timer)
  }, [intervalMs])
  return now
}
