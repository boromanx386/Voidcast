import { useEffect, useState } from 'react'

/**
 * Live elapsed milliseconds between `startedAt` and `endedAt`.
 *
 * Ticks on a coarse interval only while the range is open AND `live` is true,
 * so historical/background turns never spin a timer. Returns null without a start.
 */
export function useElapsedMs(startedAt?: number, endedAt?: number, live = false): number | null {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!live || endedAt != null || startedAt == null) return
    const id = window.setInterval(() => setNow(Date.now()), 200)
    return () => window.clearInterval(id)
  }, [live, endedAt, startedAt])

  if (startedAt == null) return null
  const end = endedAt ?? (live ? now : undefined)
  if (end == null) return null
  return Math.max(0, end - startedAt)
}
