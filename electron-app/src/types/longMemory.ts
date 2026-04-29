export type LongMemoryKind = 'preference' | 'project' | 'fact' | 'constraint' | 'task'

export type LongMemoryItem = {
  id: string
  kind: LongMemoryKind
  text: string
  tags: string[]
  importance: number
  confidence: number
  createdAt: number
  updatedAt: number
  lastUsedAt: number
  sourceSessionId: string
}

export type LongMemoryCandidate = {
  kind: LongMemoryKind
  text: string
  tags?: string[]
  importance?: number
  confidence?: number
}
