/** Active coding shell processes (foreground + background) for CTX hints. */

export type ActiveCodingProcessKind = 'foreground' | 'background'

export type ActiveCodingProcess = {
  runId: string
  pid: number
  command: string
  kind: ActiveCodingProcessKind
  startedAt: number
  lastLines: string[]
}

export const ACTIVE_PROCESS_MAX_LINES = 8
export const ACTIVE_PROCESS_HINT_MAX = 4
export const ACTIVE_PROCESS_LAST_MAX_CHARS = 120

/** Merge a stdout/stderr chunk into a rolling last-lines buffer.
 *  The last element is the current (possibly incomplete) line; a trailing `''`
 *  means the previous chunk ended with a newline.
 */
export function mergeActiveProcessOutputLines(
  prev: string[],
  text: string,
  maxLines = ACTIVE_PROCESS_MAX_LINES,
): string[] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  if (!normalized) return prev.slice(-(maxLines + 1))

  const out = prev.length > 0 ? [...prev] : ['']
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i]!
    if (ch === '\n') {
      out.push('')
    } else {
      out[out.length - 1] = `${out[out.length - 1]}${ch}`
    }
  }
  // Keep at most maxLines completed lines + one incomplete trailing slot.
  return out.slice(-(maxLines + 1))
}

export function upsertActiveProcess(
  list: ActiveCodingProcess[],
  next: ActiveCodingProcess,
): ActiveCodingProcess[] {
  const existing = list.find((p) => p.runId === next.runId)
  const merged: ActiveCodingProcess =
    existing && next.lastLines.length === 0 && existing.lastLines.length > 0
      ? { ...next, lastLines: existing.lastLines }
      : next
  const without = list.filter((p) => p.runId !== merged.runId)
  return [...without, merged]
}

export function removeActiveProcess(
  list: ActiveCodingProcess[],
  runId: string,
): ActiveCodingProcess[] {
  return list.filter((p) => p.runId !== runId)
}

export function applyOutputToActiveProcess(
  list: ActiveCodingProcess[],
  runId: string,
  text: string,
): ActiveCodingProcess[] {
  if (!text) return list
  const idx = list.findIndex((p) => p.runId === runId)
  if (idx < 0) {
    // Stream can beat the start upsert across IPC channels — keep a stub.
    return upsertActiveProcess(list, {
      runId,
      pid: 0,
      command: '(running)',
      kind: 'foreground',
      startedAt: Date.now(),
      lastLines: mergeActiveProcessOutputLines([], text),
    })
  }
  const cur = list[idx]!
  const next = [...list]
  next[idx] = {
    ...cur,
    lastLines: mergeActiveProcessOutputLines(cur.lastLines, text),
  }
  return next
}

function formatLastSnippet(lines: string[]): string {
  const joined = lines
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(-2)
    .join(' | ')
  if (!joined) return '(no output yet)'
  if (joined.length <= ACTIVE_PROCESS_LAST_MAX_CHARS) return joined
  return `${joined.slice(0, ACTIVE_PROCESS_LAST_MAX_CHARS - 1)}…`
}

/**
 * Compact CTX block. Empty list → empty string (omit from prompt).
 */
export function buildActiveProcessesHint(
  procs: ActiveCodingProcess[],
  nowMs: number = Date.now(),
): string {
  if (!procs.length) return ''
  const shown = procs.slice(0, ACTIVE_PROCESS_HINT_MAX)
  const lines = [
    'Active coding processes:',
    ...shown.map((p) => {
      const kind = p.kind === 'background' ? 'bg' : 'fg'
      const secs = Math.max(0, Math.round((nowMs - p.startedAt) / 1000))
      const cmd = p.command.trim() || '(empty)'
      const last = formatLastSnippet(p.lastLines)
      return `- [${kind}] ${cmd} → pid ${p.pid || 'n/a'}, running ${secs}s, last: "${last}"`
    }),
  ]
  if (procs.length > ACTIVE_PROCESS_HINT_MAX) {
    lines.push(`- …and ${procs.length - ACTIVE_PROCESS_HINT_MAX} more`)
  }
  return lines.join('\n')
}
