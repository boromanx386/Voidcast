/**
 * Shared spawn env + stdio wiring for coding `execute_command`.
 * Kept out of Electron main so unit tests can verify background capture.
 */
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { ChunkThrottle } from './chunkThrottle'

/** Env helpers so piped Python (and similar) don't block-buffer forever. */
export function codingCommandSpawnEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return {
    ...base,
    PYTHONUNBUFFERED: base.PYTHONUNBUFFERED || '1',
    // Piped Python on Windows otherwise encodes to the ANSI code page, which we decode as UTF-8.
    PYTHONIOENCODING: base.PYTHONIOENCODING || 'utf-8',
  }
}

/**
 * Shell command line for `spawn(..., { shell: true })`. On Windows the hidden console starts
 * on the OEM code page (437, 852, …), and programs that encode piped output with it (.NET
 * tools, nested cmd) produced mojibake once decoded as UTF-8. chcp fixes those; cmd's own
 * builtins (dir, echo) keep the code page cmd started with. `&` (not `&&`) so the command
 * still runs if chcp is unavailable.
 */
export function codingShellCommandLine(
  command: string,
  platform: NodeJS.Platform = process.platform,
): string {
  return platform === 'win32' ? `chcp 65001 >nul 2>&1 & ${command}` : command
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
 *
 * Callers that return captured stdout/stderr to the agent MUST `flush()` before
 * reading those accumulators. Otherwise a process that exits within `throttleMs`
 * leaves bytes in the buffer: the UI still gets them on a late flush, but the
 * tool result can be empty (`(no output)`).
 */
export function attachCodingProcessStdio(
  child: Pick<ChildProcessWithoutNullStreams, 'stdout' | 'stderr'>,
  onChunk: (stream: 'stdout' | 'stderr', text: string) => void,
  throttleMs = 50,
): CodingStdioAttachResult {
  const throttle = new ChunkThrottle((stream, text) => {
    onChunk(stream, text)
  }, throttleMs)

  // A string decoder keeps multi-byte UTF-8 characters intact across chunk boundaries;
  // String(buffer) per chunk turned a split character into U+FFFD.
  child.stdout?.setEncoding?.('utf8')
  child.stderr?.setEncoding?.('utf8')
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
