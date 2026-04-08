export type ChatRole = 'user' | 'assistant'

export type UiMessage = {
  id: string
  role: ChatRole
  content: string
}

export type ChatSessionMessage = UiMessage

export type ChatSession = {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: ChatSessionMessage[]
}

export type ChatSessionsState = {
  sessions: ChatSession[]
  activeSessionId: string | null
}