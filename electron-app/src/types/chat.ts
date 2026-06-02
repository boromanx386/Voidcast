export type ChatRole = 'user' | 'assistant'

export type FileAttachmentSnapshot = {
  id: string
  name: string
  path: string
  mime: string
  size: number
  ext: string
  content?: string
  truncated?: boolean
}

export type UiMessage = {
  id: string
  role: ChatRole
  content: string
  /**
   * Assistant only: streamed model reasoning (Ollama `thinking` / OpenRouter `reasoning`).
   * Shown above the main reply when non-empty.
   */
  thinking?: string
  /** Raw base64 for Ollama `images` (no data-URL prefix). User messages only. */
  images?: string[]
  /** Parallel MIME types for rendering (e.g. image/png). Not persisted (see chatSessionsStorage). */
  imageMimes?: string[]
  /** Optional original image file names, parallel with `images`. */
  imageNames?: string[]
  /** Optional original absolute file paths (when available), parallel with `images`. */
  imagePaths?: string[]
  /** Persisted file attachments for user messages. */
  fileAttachments?: FileAttachmentSnapshot[]
  /** Assistant-generated image URLs (persisted for chat history rendering/fallback). */
  generatedImageUrls?: string[]
  /** Assistant-generated local image file paths (desktop source-of-truth). */
  generatedImagePaths?: string[]
}

import type { CodingContextMemo } from '@/lib/codingContextMemo'
import type { ImageVisionCache } from '@/lib/imageVisionCache'

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
  /**
   * Messages before this index are omitted from the LLM payload when
   * hiddenContextSummary is set (still visible in the chat UI).
   */
  contextCompressedThroughIndex?: number
  /** Coding tool context for this session (files read, failures, commands, etc.). */
  codingContextMemo?: CodingContextMemo
  /** Project path this memo was built against; invalidated when settings path changes. */
  codingProjectPath?: string
  /** Sub-agent vision descriptions keyed by image catalog key (path or base64 prefix). */
  imageVisionCache?: ImageVisionCache
}

export type ChatSessionsState = {
  sessions: ChatSession[]
  activeSessionId: string | null
}