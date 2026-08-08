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
  stream: 'stdout' | 'stderr' | 'system'
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
