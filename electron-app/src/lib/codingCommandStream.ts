import type { TerminalLine } from '../types/coding'
import { MAX_TERMINAL_ROWS } from './terminalChunks'
import { ChunkThrottle } from './chunkThrottle'

export { ChunkThrottle }

/** IPC payload for live `execute_command` / manual RUN output. */
export type CodingCommandOutputEvent = {
  runId: string
  /** Chat runtime that started this shell (for multi-session terminal isolation). */
  ownerId?: string
  projectPath?: string
  /** `manual` = started from the panel's RUN row. */
  source?: 'agent' | 'manual'
  /** Started with run_in_background, or handed back to the agent after going quiet. */
  background?: boolean
  stream?: 'stdout' | 'stderr' | 'system'
  text?: string
  done?: boolean
  code?: number
  timedOut?: boolean
  killed?: boolean
}

/** Human-readable exit line for the terminal panel. */
export function formatCodingCommandExitLine(opts: {
  code?: number
  timedOut?: boolean
  killed?: boolean
}): string {
  if (opts.killed) return '[stopped]'
  if (opts.timedOut) return '[timed out]'
  if (typeof opts.code === 'number') return `[exit ${opts.code}]`
  return '[done]'
}

/**
 * Status line for the model. It goes last so head+tail trimming of noisy output keeps it;
 * without it a failing build or test run looked exactly like a passing one.
 */
export function formatExecuteCommandStatusLine(opts: {
  code?: number
  timedOut?: boolean
  killed?: boolean
}): string {
  const exit = typeof opts.code === 'number' ? `, exit ${opts.code}` : ''
  if (opts.killed) return `[stopped${exit}]`
  if (opts.timedOut) return `[timed out${exit}]`
  if (typeof opts.code === 'number') return `[exit ${opts.code}]`
  return ''
}

const EXECUTE_STATUS_LINE_RE = /^\[(?:(stopped|timed out)(?:, exit (-?\d+))?|exit (-?\d+))\]$/

/** True when an execute_command result ends in a non-zero exit, a timeout, or a stop. */
export function isFailedExecuteCommandStatus(result: string): boolean {
  const lines = result.trimEnd().split(/\r?\n/)
  const m = lines[lines.length - 1]?.trim().match(EXECUTE_STATUS_LINE_RE)
  if (!m) return false
  if (m[1]) return true
  return Number(m[3]) !== 0
}

/** Set when a foreground coding command used IPC streaming (anti-dup for applyAgentToolResult). */
let lastForegroundExecuteWasStreamed = false

export function markLastExecuteCommandStreamed(streamed: boolean): void {
  lastForegroundExecuteWasStreamed = streamed
}

export function consumeLastExecuteCommandStreamed(): boolean {
  const v = lastForegroundExecuteWasStreamed
  lastForegroundExecuteWasStreamed = false
  return v
}

/** Clear feed + stream id counter at a chat/session boundary. */
export function resetCodingTerminalFeedState(seqRef: { n: number }): TerminalLine[] {
  seqRef.n = 0
  return []
}

/** Append one stream event into the agent terminal feed (raw lines; UI expands). */
export function appendCodingCommandEventToFeed(
  prev: TerminalLine[],
  event: CodingCommandOutputEvent,
  seqRef: { n: number },
): TerminalLine[] {
  if (event.done) {
    const text = formatCodingCommandExitLine({
      code: event.code,
      timedOut: event.timedOut,
      killed: event.killed,
    })
    seqRef.n += 1
    return [
      ...prev,
      {
        id: `stream-${event.runId}-${seqRef.n}`,
        stream: 'system' as const,
        text,
        ts: Date.now(),
        runId: event.runId,
        source: event.source,
        background: event.background,
        done: true,
      },
    ].slice(-MAX_TERMINAL_ROWS)
  }
  if (!event.text) return prev
  const stream: TerminalLine['stream'] =
    event.stream === 'stderr' ? 'stderr-output' : (event.stream ?? 'stdout')
  seqRef.n += 1
  return [
    ...prev,
    {
      id: `stream-${event.runId}-${seqRef.n}`,
      stream,
      text: event.text,
      ts: Date.now(),
      runId: event.runId,
      source: event.source,
      background: event.background,
    },
  ].slice(-MAX_TERMINAL_ROWS)
}
