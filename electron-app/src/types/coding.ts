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
}

export type CodingToolResult = {
  ok: boolean
  text: string
  /** True when stdout/stderr were already streamed to the terminal panel via IPC. */
  streamed?: boolean
  code?: number
  runId?: string
}
