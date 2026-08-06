/**
 * Per-session composer draft (input + attachments) so switching chats
 * does not lose unsent text / files.
 */
import type { PendingChatImage } from '@/lib/chatImageCatalog'
import type { FileAttachmentSnapshot } from '@/types/chat'
import { DRAFT_RUNTIME_KEY, runtimeKeyForSession } from '@/lib/sessionAgentStore'

export type ComposerDraft = {
  input: string
  pendingImages: PendingChatImage[]
  pendingFiles: FileAttachmentSnapshot[]
}

const drafts = new Map<string, ComposerDraft>()

function emptyDraft(): ComposerDraft {
  return { input: '', pendingImages: [], pendingFiles: [] }
}

export function composerKeyForSession(sessionId: string | null | undefined): string {
  return runtimeKeyForSession(sessionId)
}

export function stashComposerDraft(key: string, draft: ComposerDraft): void {
  const k = key.trim() || DRAFT_RUNTIME_KEY
  const hasContent =
    draft.input.trim().length > 0 ||
    draft.pendingImages.length > 0 ||
    draft.pendingFiles.length > 0
  if (!hasContent) {
    drafts.delete(k)
    return
  }
  drafts.set(k, {
    input: draft.input,
    pendingImages: [...draft.pendingImages],
    pendingFiles: [...draft.pendingFiles],
  })
}

export function loadComposerDraft(key: string): ComposerDraft {
  const k = key.trim() || DRAFT_RUNTIME_KEY
  const found = drafts.get(k)
  if (!found) return emptyDraft()
  return {
    input: found.input,
    pendingImages: [...found.pendingImages],
    pendingFiles: [...found.pendingFiles],
  }
}

/** Move draft when draft runtime rekeys to a real session id. */
export function rekeyComposerDraft(from: string, to: string): void {
  if (!from || !to || from === to) return
  const d = drafts.get(from)
  if (!d) return
  drafts.set(to, d)
  drafts.delete(from)
}

export function clearComposerDraft(key: string): void {
  drafts.delete(key.trim() || DRAFT_RUNTIME_KEY)
}
