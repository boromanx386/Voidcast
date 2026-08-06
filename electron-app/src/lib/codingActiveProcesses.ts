/** Active coding shell processes (foreground + background) for CTX hints. */

export type ActiveCodingProcessKind = 'foreground' | 'background'

export type ActiveCodingProcess = {
  runId: string
  pid: number
  command: string
  kind: ActiveCodingProcessKind
  startedAt: number
  lastLines: string[]
  /**
   * Chat runtime key that started this process (session id or draft).
   * Used so Stop/list/CTX can isolate concurrent multi-chat agents.
   */
  ownerId?: string
  /** Absolute project root where the shell was spawned. */
  projectPath?: string
}

/** Normalize paths for ownership compare (Windows-safe, no trailing slash). */
export function normalizeCodingPathKey(path: string): string {
  return path
    .trim()
    .toLowerCase()
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
}

/**
 * Processes visible to an agent turn: same owner, and/or same project root.
 * (Same folder must share the list so two chats do not start duplicate servers.)
 * Untagged legacy processes remain visible until they exit.
 */
export function filterProcessesForAgent(
  procs: ActiveCodingProcess[],
  opts: { ownerId?: string; projectPath?: string },
): ActiveCodingProcess[] {
  const owner = (opts.ownerId || '').trim()
  const path = normalizeCodingPathKey(opts.projectPath || '')
  return procs.filter((p) => {
    const pOwner = (p.ownerId || '').trim()
    const pPath = normalizeCodingPathKey(p.projectPath || '')
    if (!pOwner && !pPath) return true
    if (path && pPath && path === pPath) return true
    if (owner && pOwner && owner === pOwner) return true
    return false
  })
}

/**
 * Whether this agent may stop a process: same owner, same project, or legacy untagged.
 */
export function canControlCodingProcess(
  proc: Pick<ActiveCodingProcess, 'ownerId' | 'projectPath'> | undefined,
  opts: { ownerId?: string; projectPath?: string },
): boolean {
  if (!proc) return false
  const owner = (opts.ownerId || '').trim()
  const path = normalizeCodingPathKey(opts.projectPath || '')
  const pOwner = (proc.ownerId || '').trim()
  const pPath = normalizeCodingPathKey(proc.projectPath || '')
  if (!pOwner && !pPath) return true
  if (owner && pOwner && owner === pOwner) return true
  if (path && pPath && path === pPath) return true
  return false
}

export const ACTIVE_PROCESS_MAX_LINES = 8
export const ACTIVE_PROCESS_HINT_MAX = 4
export const ACTIVE_PROCESS_LAST_MAX_CHARS = 120

/** Ring buffer size for agent `read_process_output` (main process). */
export const ACTIVE_PROCESS_OUTPUT_BUFFER_MAX_CHARS = 64_000

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

/** Append to a capped output ring; returns updated buffer + absolute start offset. */
export function appendProcessOutputBuffer(
  prev: { buffer: string; startOffset: number },
  text: string,
  maxChars = ACTIVE_PROCESS_OUTPUT_BUFFER_MAX_CHARS,
): { buffer: string; startOffset: number } {
  if (!text) return prev
  let buffer = prev.buffer + text
  let startOffset = prev.startOffset
  if (buffer.length > maxChars) {
    const drop = buffer.length - maxChars
    buffer = buffer.slice(drop)
    startOffset += drop
  }
  return { buffer, startOffset }
}

export function sliceProcessOutputBuffer(
  state: { buffer: string; startOffset: number },
  offset?: number,
): { text: string; nextOffset: number; truncatedFromStart: boolean; startOffset: number } {
  const req = typeof offset === 'number' && Number.isFinite(offset) ? Math.max(0, Math.floor(offset)) : state.startOffset
  const truncatedFromStart = req < state.startOffset
  const localStart = Math.max(0, req - state.startOffset)
  const text = state.buffer.slice(localStart)
  return {
    text,
    nextOffset: state.startOffset + state.buffer.length,
    truncatedFromStart,
    startOffset: state.startOffset,
  }
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
  meta?: { ownerId?: string; projectPath?: string },
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
      ownerId: meta?.ownerId,
      projectPath: meta?.projectPath,
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
 * Includes runId so the agent can call stop_process / read_process_output.
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
      return `- [${kind}] runId=${p.runId} ${cmd} → pid ${p.pid || 'n/a'}, running ${secs}s, last: "${last}"`
    }),
  ]
  if (procs.length > ACTIVE_PROCESS_HINT_MAX) {
    lines.push(`- …and ${procs.length - ACTIVE_PROCESS_HINT_MAX} more`)
  }
  lines.push(
    'Use list_processes / read_process_output(runId) to inspect logs; stop_process(runId) to stop. Do not start a duplicate server.',
  )
  return lines.join('\n')
}
