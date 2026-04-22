export type ChatRole = 'user' | 'assistant'

export type UiMessage = {
  id: string
  role: ChatRole
  content: string
  /** Raw base64 for Ollama `images` (no data-URL prefix). User messages only. */
  images?: string[]
  /** Parallel MIME types for rendering (e.g. image/png). Not persisted (see chatSessionsStorage). */
  imageMimes?: string[]
  /** Optional original image file names, parallel with `images`. */
  imageNames?: string[]
  /** Optional original absolute file paths (when available), parallel with `images`. */
  imagePaths?: string[]
}

export type ChatSessionMessage = UiMessage

export type ChatSession = {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: ChatSessionMessage[]
  /**
   * Internal compressed memory for long chats.
   * Never rendered as a visible chat message.
   */
  hiddenContextSummary?: string
}

export type ChatSessionsState = {
  sessions: ChatSession[]
  activeSessionId: string | null
}