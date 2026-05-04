export type CodingFileNode = {
  name: string
  path: string
  type: 'file' | 'directory'
  size?: number
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
}
