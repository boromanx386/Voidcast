import type { TerminalLine } from '../types/coding'
import { MAX_TERMINAL_ROWS } from './terminalChunks'
import { ChunkThrottle } from './chunkThrottle'

export { ChunkThrottle }

/** IPC payload for live `execute_command` / manual RUN output. */
export type CodingCommandOutputEvent = {
  runId: string
  stream?: 'stdout' | 'stderr' | 'system'
  text?: string
  done?: boolean
  code?: number
  timedOut?: boolean
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
  if (event.done || !event.text) return prev
  const stream = event.stream ?? 'stdout'
  seqRef.n += 1
  return [
    ...prev,
    {
      id: `stream-${event.runId}-${seqRef.n}`,
      stream,
      text: event.text,
      ts: Date.now(),
    },
  ].slice(-MAX_TERMINAL_ROWS)
}
