export type CodingFileNode = {
  name: string
  path: string
  type: 'file' | 'directory'
  size?: number
  /** True for heavy / generated dirs (node_modules, dist, …) — shown dimmed in the tree. */
  ignored?: boolean
}

export type TerminalLine = {
  id: string
  /**
   * `stderr` is an app-side failure (commit, save, …). `stderr-output` is a running process's
   * stderr, which many tools use for plain logs, so it is not painted as an error.
   */
  stream: 'stdout' | 'stderr' | 'stderr-output' | 'system'
  text: string
  ts: number
  /** Command run that produced the row; only rows of the same run merge. */
  runId?: string
  /** `manual` = typed in the RUN row (SHELL tab); anything else is the agent's (AGENT tab). */
  source?: 'agent' | 'manual'
  /** Feed only: the run is a background process, shown in its own tab. */
  background?: boolean
  /** Feed only: the run's exit line. */
  done?: boolean
  /** The row has no newline yet; the next chunk of the same run continues it. */
  partial?: boolean
  /** A trailing `\r` was seen: the next text replaces the row instead of extending it. */
  pendingCr?: boolean
}

export type CodingToolResult = {
  ok: boolean
  text: string
  /** True when stdout/stderr were already streamed to the terminal panel via IPC. */
  streamed?: boolean
  code?: number
  runId?: string
}
