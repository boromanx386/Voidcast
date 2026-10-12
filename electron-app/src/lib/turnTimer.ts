/**
 * Human-readable durations for the chat UI (turn bubbles + busy strip).
 * Kept dependency-free so both the message list and the tool strip can share it.
 */

/** "4.2s" | "12s" | "1m 03s" | "1h 07m" — compact, glanceable. */
export function formatDurationMs(ms: number): string {
  const clamped = Math.max(0, Math.round(ms))
  if (clamped < 10_000) return `${(clamped / 1000).toFixed(1)}s`
  if (clamped < 60_000) return `${Math.round(clamped / 1000)}s`
  const totalSec = Math.round(clamped / 1000)
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  if (min < 60) return `${min}m ${sec.toString().padStart(2, '0')}s`
  const hr = Math.floor(min / 60)
  const remMin = min % 60
  return `${hr}h ${remMin.toString().padStart(2, '0')}m`
}

function formatClock(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000))
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  return `${min}:${sec.toString().padStart(2, '0')}`
}

/** Countdown for a tool with a known timeout, e.g. "0:42 / 2:00". */
export function formatCountdown(elapsedMs: number, timeoutSec: number): string {
  return `${formatClock(elapsedMs)} / ${formatClock(timeoutSec * 1000)}`
}

/**
 * Timeout (in seconds) declared in a tool's args, when the tool exposes one.
 * `execute_command` uses `timeout_sec`; the browser wait tool uses `timeout_ms`.
 */
export function readToolTimeoutSec(args?: Record<string, unknown>): number | undefined {
  if (!args) return undefined
  const sec = args.timeout_sec
  if (typeof sec === 'number' && sec > 0) return sec
  const ms = args.timeout_ms
  if (typeof ms === 'number' && ms > 0) return Math.round(ms / 1000)
  return undefined
}

/**
 * True when a tool result reports a timeout. Electron's spawn wrappers emit
 * "… timed out after Ns." and coding tools reuse the same wording, so we match
 * only that phrase to avoid flagging unrelated text that mentions "timeout".
 */
export function isToolTimeoutResult(result: string): boolean {
  return /\btimed out\b/i.test(result)
}
