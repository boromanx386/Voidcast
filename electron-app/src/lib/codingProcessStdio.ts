/**
 * Shared spawn env + stdio wiring for coding `execute_command`.
 * Kept out of Electron main so unit tests can verify background capture.
 */
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { ChunkThrottle } from './chunkThrottle'

/** Env helpers so piped Python (and similar) don't block-buffer forever. */
export function codingCommandSpawnEnv(
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return {
    ...base,
    PYTHONUNBUFFERED: base.PYTHONUNBUFFERED || '1',
  }
}

/**
 * Background means "return to the agent without waiting for exit".
 * Do NOT detach: on Windows, detached children often get their own console
 * and stop writing to our stdout/stderr pipes — empty read_process_output.
 */
export const CODING_COMMAND_SPAWN_DETACHED = false

export type CodingStdioAttachResult = {
  flush: () => void
}

/**
 * Wire stdout/stderr → throttled onChunk. Same path for foreground and background.
 */
export function attachCodingProcessStdio(
  child: Pick<ChildProcessWithoutNullStreams, 'stdout' | 'stderr'>,
  onChunk: (stream: 'stdout' | 'stderr', text: string) => void,
  throttleMs = 50,
): CodingStdioAttachResult {
  const throttle = new ChunkThrottle((stream, text) => {
    onChunk(stream, text)
  }, throttleMs)

  child.stdout?.on('data', (chunk: Buffer | string) => {
    throttle.push('stdout', String(chunk))
  })
  child.stderr?.on('data', (chunk: Buffer | string) => {
    throttle.push('stderr', String(chunk))
  })
  // Ensure flowing mode if a prior pause occurred.
  child.stdout?.resume()
  child.stderr?.resume()

  return { flush: () => throttle.flush() }
}
