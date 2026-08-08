export type ChatRole = 'user' | 'assistant'

/** Composer / turn mode: Agent implements; Plan explores read-only then proposes steps. */
export type AgentChatMode = 'agent' | 'plan' | 'team'

/** Normalize stored/settings values; unknown → agent. */
export function normalizeAgentChatMode(value: unknown): AgentChatMode {
  if (value === 'plan') return 'plan'
  if (value === 'team') return 'team'
  return 'agent'
}

/** Plan mode is read-only; agent and team share mutating tools. */
export function isPlanChatMode(mode: AgentChatMode | string | undefined | null): boolean {
  return mode === 'plan'
}

export function isTeamChatMode(mode: AgentChatMode | string | undefined | null): boolean {
  return mode === 'team'
}

export type SystemPromptPreset = 'default' | 'code' | 'creative' | 'teacher'

export type PlanStep = {
  id: string
  text: string
  done?: boolean
}

/** Competing approaches (A/B/C, optional D) — user picks one before Approve & Build. */
export type PlanApproach = {
  id: string
  label: string
  summary?: string
  steps: PlanStep[]
}

/** Compact Plan-mode findings carried into Approve & Build so Build skips re-exploration. */
export type PlanResearch = {
  keyFiles: string[]
  findings: string
  searches?: string[]
}

export type PlanArtifact = {
  title: string
  summary?: string
  steps: PlanStep[]
  status: 'draft' | 'approved' | 'built'
  /** Alternative approaches when the model offers A/B/C (+ optional D). */
  approaches?: PlanApproach[]
  /** Selected approach id (A/B/C/D); steps mirror that approach once chosen. */
  selectedApproachId?: string
  /** Research snapshot from Plan exploration (model-authored and/or tool-harvested). */
  research?: PlanResearch
}

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
  /**
   * Assistant only: this reply was the agent-mode answer that triggered a plan-mode
   * escalation. Kept on screen (not discarded) as context before the plan turn.
   */
  planHandoffDraft?: boolean
  /** Raw base64 for Ollama `images` (no data-URL prefix). User messages only. */
  images?: string[]
  /** Parallel MIME types for rendering (e.g. image/png). Not persisted (see chatSessionsStorage strip). */
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
  /** Assistant only: structured plan from Plan mode (editable until approved/built). */
  plan?: PlanArtifact
  /**
   * Assistant only: collapsible sub-agent activity card for this turn
   * (vision / explore / coding workers). Anchored to the reply so it stays
   * in timeline order after later user prompts.
   */
  subAgentActivity?: SubAgentPanelState
}

import type { CodingContextMemo } from '@/lib/codingContextMemo'
import type { ImageVisionCache } from '@/lib/imageVisionCache'
import type { SubAgentPanelState } from '@/lib/subAgentPanelState'

export type ChatSessionMessage = UiMessage

export type ChatSession = {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: ChatSessionMessage[]
  /** System prompt preset used by this chat. Missing legacy values resolve to default. */
  systemPromptPreset?: SystemPromptPreset
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
  /**
   * Sticky multi-session id while auto-save is off: lives in memory/sidebar so you can
   * return after switching chats; omitted from IndexedDB until the user hits Save.
   */
  unsaved?: boolean
}

export type ChatSessionsState = {
  sessions: ChatSession[]
  activeSessionId: string | null
}