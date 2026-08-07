import {
  useCallback,
  useEffect,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react'
import { resolveContextCompressedThroughIndex } from '@/lib/chatMessages'
import {
  deleteSessionById,
  loadChatSessions,
  scheduleSaveChatSessions,
  upsertSession,
} from '@/lib/chatSessionsStorage'
import {
  emptyCodingContextMemo,
  getCodingProjectPath,
  mergeCodingProjectPathIntoSettings,
  normalizeCodingContextMemo,
  resolveMemoForSession,
  sessionCodingProjectPath,
  type CodingContextMemo,
} from '@/lib/codingContextMemo'
import { deriveSessionTitle } from '@/lib/chatHints'
import { uid } from '@/lib/chatUid'
import {
  normalizeImageVisionCache,
  type ImageVisionCache,
} from '@/lib/imageVisionCache'
import {
  loadSettings,
  normalizeSystemPromptPreset,
  type AppSettings,
} from '@/lib/settings'
import type { ContextUsageInfo } from '@/lib/contextUsage'
import type { PendingChatImage } from '@/lib/chatImageCatalog'
import {
  clearComposerDraft,
  loadComposerDraft,
  rekeyComposerDraft,
  stashComposerDraft,
} from '@/lib/chatComposerDrafts'
import {
  DRAFT_RUNTIME_KEY,
  runtimeKeyForSession,
  sessionAgentStore,
} from '@/lib/sessionAgentStore'
import { cancelActiveMcpCalls } from '@/lib/mcpTools'
import type { ChatSession, FileAttachmentSnapshot, SystemPromptPreset, UiMessage } from '@/types/chat'

function resolveAction<T>(prev: T, action: SetStateAction<T>): T {
  return typeof action === 'function' ? (action as (p: T) => T)(prev) : action
}

export type ChatSessionsDeps = {
  settings: AppSettings
  setSettings: Dispatch<SetStateAction<AppSettings>>
  messages: UiMessage[]
  setMessages: Dispatch<SetStateAction<UiMessage[]>>
  codingContextMemo: CodingContextMemo
  setCodingContextMemo: Dispatch<SetStateAction<CodingContextMemo>>
  imageVisionCache: ImageVisionCache
  setImageVisionCache: Dispatch<SetStateAction<ImageVisionCache>>
  codingProjectPathForMemoRef: MutableRefObject<string>
  contextOverflowLatchRef: MutableRefObject<boolean>
  resetAssistantMediaState: () => void
  restoreCodingContextForSession: (
    session: ChatSession,
    options?: { flushActiveSessionId?: string | null },
  ) => void
  resetCodingTerminal: () => void
  /** Switch terminal buffer without killing other chats' shells. */
  switchCodingTerminalOwner?: (ownerKey: string) => void
  /** Move terminal feed when draft rekeys to a session id. */
  rekeyCodingTerminalOwner?: (fromKey: string, toKey: string) => void
  /** Stop only the currently visible agent (used on delete of active / new draft reset). */
  abortActiveRuns: () => void
  cancelMessageEdit?: () => void
  setInput: Dispatch<SetStateAction<string>>
  /** Live composer values for stash/restore on session switch. */
  input: string
  pendingImages: PendingChatImage[]
  setPendingImages: Dispatch<SetStateAction<PendingChatImage[]>>
  pendingFiles: FileAttachmentSnapshot[]
  setPendingFiles: Dispatch<SetStateAction<FileAttachmentSnapshot[]>>
  setError: Dispatch<SetStateAction<string | null>>
  setToolResultBanner: Dispatch<SetStateAction<{ kind: 'pdf'; text: string } | null>>
  setContextUsageInfo: Dispatch<SetStateAction<ContextUsageInfo | null>>
  setContextWarnDismissed: Dispatch<SetStateAction<boolean>>
  busy: boolean
  hiddenContextSummary: string
  setHiddenContextSummary: Dispatch<SetStateAction<string>>
  contextCompressedThroughIndex: number
  setContextCompressedThroughIndex: Dispatch<SetStateAction<number>>
}

export function useChatSessions(deps: ChatSessionsDeps) {
  const {
    settings,
    setSettings,
    messages,
    setMessages,
    codingContextMemo,
    setCodingContextMemo,
    imageVisionCache,
    setImageVisionCache,
    codingProjectPathForMemoRef,
    contextOverflowLatchRef,
    resetAssistantMediaState,
    restoreCodingContextForSession,
    resetCodingTerminal,
    switchCodingTerminalOwner,
    rekeyCodingTerminalOwner,
    abortActiveRuns: _abortActiveRuns,
    cancelMessageEdit,
    setInput,
    input,
    pendingImages,
    setPendingImages,
    pendingFiles,
    setPendingFiles,
    setError,
    setToolResultBanner,
    setContextUsageInfo,
    setContextWarnDismissed,
    busy,
    hiddenContextSummary,
    setHiddenContextSummary,
    contextCompressedThroughIndex,
    setContextCompressedThroughIndex,
  } = deps

  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [sessionDirty, setSessionDirty] = useState(false)
  /** Collapsed state keyed by project group key (see sessionProjectGroups). */
  const [sidebarCollapsed, setSidebarCollapsed] = useState<Record<string, boolean>>({})
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [sessionsHydrated, setSessionsHydrated] = useState(false)
  /** Preset applied when the next brand-new session is created (no active session yet). */
  const [pendingNewSessionPreset, setPendingNewSessionPreset] =
    useState<SystemPromptPreset>('default')

  // Load sessions from IndexedDB (one-time localStorage migration on first run)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const state = await loadChatSessions()
      if (cancelled) return
      let sessionsMigrated = false
      const sessions = state.sessions.map((s) => {
        // Legacy/unknown system prompt preset values resolve to 'default'.
        let next = s
        const preset = normalizeSystemPromptPreset(s.systemPromptPreset)
        if (preset !== s.systemPromptPreset) {
          sessionsMigrated = true
          next = { ...s, systemPromptPreset: preset }
        }
        if (!next.hiddenContextSummary?.trim()) return next
        const through = resolveContextCompressedThroughIndex(
          next.hiddenContextSummary,
          next.contextCompressedThroughIndex,
          next.messages.length,
        )
        if ((next.contextCompressedThroughIndex ?? 0) === through) return next
        sessionsMigrated = true
        return { ...next, contextCompressedThroughIndex: through }
      })
      setSessions(sessions)
      if (sessionsMigrated) {
        scheduleSaveChatSessions({ sessions, activeSessionId: state.activeSessionId })
      }
      setActiveSessionId(state.activeSessionId)
      const active = state.activeSessionId
        ? sessions.find((s) => s.id === state.activeSessionId)
        : null
      const runtimeKey = runtimeKeyForSession(state.activeSessionId)
      sessionAgentStore.hydrateMessages(runtimeKey, active?.messages ?? [])
      resetAssistantMediaState()
      setHiddenContextSummary(active?.hiddenContextSummary ?? '')
      setContextCompressedThroughIndex(
        resolveContextCompressedThroughIndex(
          active?.hiddenContextSummary,
          active?.contextCompressedThroughIndex,
          active?.messages.length ?? 0,
        ),
      )
      const baseSettings = loadSettings()
      // Bound path only: no active / no path → General (clear settings folder).
      const projectPath = sessionCodingProjectPath(active ?? undefined)
      setSettings(mergeCodingProjectPathIntoSettings(baseSettings, projectPath))
      codingProjectPathForMemoRef.current = projectPath
      setCodingContextMemo(resolveMemoForSession(active ?? undefined, projectPath))
      setImageVisionCache(normalizeImageVisionCache(active?.imageVisionCache))
      setContextUsageInfo(null)
      setContextWarnDismissed(false)
      setSessionDirty(false)
      setSessionsHydrated(true)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Background agent runs write messages into the store — mirror into sessions[].
  // Do not bump updatedAt / re-sort on stream deltas (only length changes = new bubble).
  useEffect(() => {
    sessionAgentStore.setMessageSync((sessionId, nextMessages) => {
      setSessions((prev) => {
        const idx = prev.findIndex((s) => s.id === sessionId)
        if (idx < 0) return prev
        if (prev[idx].messages === nextMessages) return prev
        const prevMsgs = prev[idx].messages
        const lengthChanged = prevMsgs.length !== nextMessages.length
        const placeholderTitle =
          !prev[idx].title ||
          prev[idx].title === 'New chat' ||
          prev[idx].title === 'Unsaved'
        const nextTitle = placeholderTitle
          ? deriveSessionTitle(nextMessages) || prev[idx].title
          : prev[idx].title
        const next = [...prev]
        next[idx] = {
          ...prev[idx],
          messages: nextMessages,
          title: nextTitle,
          // Streaming tokens keep position; a new bubble may lift the session once.
          updatedAt: lengthChanged ? Date.now() : prev[idx].updatedAt,
        }
        if (lengthChanged) {
          next.sort((a, b) => b.updatedAt - a.updatedAt)
        }
        return next
      })
    })
    return () => sessionAgentStore.setMessageSync(null)
  }, [])

  // Persist sessions (debounced IndexedDB write)
  useEffect(() => {
    if (!sessionsHydrated) return
    scheduleSaveChatSessions({ sessions, activeSessionId })
  }, [sessions, activeSessionId, sessionsHydrated])

  // Keep sessions[] in sync with the active chat. Sticky ids come from claimSessionIdForDraft
  // (on Send) so background multi-chat always has a sidebar row; autoSave OFF uses unsaved:true
  // (memory only until Save). AutoSave ON still creates if claim was skipped.
  useEffect(() => {
    if (!sessionsHydrated) return
    if (messages.length === 0) return

    // No sticky id yet (true empty draft before first Send).
    if (!activeSessionId) {
      if (!settings.autoSaveChat) return
      const newId = uid()
      const now = Date.now()
      const projectPath = getCodingProjectPath(settings)
      const newSession: ChatSession = {
        id: newId,
        title: deriveSessionTitle(messages),
        createdAt: now,
        updatedAt: now,
        messages,
        systemPromptPreset: pendingNewSessionPreset,
        hiddenContextSummary: hiddenContextSummary.trim() || undefined,
        contextCompressedThroughIndex: hiddenContextSummary.trim()
          ? contextCompressedThroughIndex
          : undefined,
        codingContextMemo: normalizeCodingContextMemo(codingContextMemo, projectPath),
        codingProjectPath: projectPath || undefined,
        imageVisionCache: normalizeImageVisionCache(imageVisionCache),
      }
      sessionAgentStore.rekey(DRAFT_RUNTIME_KEY, newId)
      rekeyComposerDraft(DRAFT_RUNTIME_KEY, newId)
      rekeyCodingTerminalOwner?.(DRAFT_RUNTIME_KEY, newId)
      setSessions((prev) => [...prev, newSession].sort((a, b) => b.updatedAt - a.updatedAt))
      setActiveSessionId(newId)
      setSessionDirty(false)
      return
    }

    // activeSessionId exists — update shell from claim, or create if missing
    setSessions((prev) => {
      const idx = prev.findIndex((s) => s.id === activeSessionId)
      const nextHiddenContextSummary = hiddenContextSummary.trim() || undefined
      const nextCompressedThrough = nextHiddenContextSummary
        ? contextCompressedThroughIndex
        : undefined
      const projectPath = getCodingProjectPath(settings)
      const nextMemo = normalizeCodingContextMemo(codingContextMemo, projectPath)
      const nextVisionCache = normalizeImageVisionCache(imageVisionCache)

      if (idx < 0) {
        const now = Date.now()
        const created: ChatSession = {
          id: activeSessionId!,
          title: deriveSessionTitle(messages),
          createdAt: now,
          updatedAt: now,
          messages,
          systemPromptPreset: pendingNewSessionPreset,
          hiddenContextSummary: nextHiddenContextSummary,
          contextCompressedThroughIndex: nextCompressedThrough,
          codingContextMemo: nextMemo,
          codingProjectPath: projectPath || undefined,
          imageVisionCache: nextVisionCache,
          ...(!settings.autoSaveChat ? { unsaved: true } : {}),
        }
        return [...prev, created].sort((a, b) => b.updatedAt - a.updatedAt)
      }

      const current = prev[idx]
      const sameMessagesRef = current.messages === messages
      const sameHiddenSummary =
        (current.hiddenContextSummary ?? '') === (nextHiddenContextSummary ?? '')
      const sameCompressedThrough =
        (current.contextCompressedThroughIndex ?? 0) === (nextCompressedThrough ?? 0)
      const sameMemo =
        JSON.stringify(current.codingContextMemo ?? null) === JSON.stringify(nextMemo)
      const sameCodingPath = (current.codingProjectPath ?? '') === projectPath
      const sameVisionCache =
        JSON.stringify(current.imageVisionCache ?? null) === JSON.stringify(nextVisionCache)
      if (
        sameMessagesRef &&
        sameHiddenSummary &&
        sameCompressedThrough &&
        sameMemo &&
        sameCodingPath &&
        sameVisionCache
      )
        return prev

      // New chat bubbles may re-rank once; stream/content/memo updates keep list order stable.
      const lengthChanged = current.messages.length !== messages.length
      const placeholderTitle =
        !current.title || current.title === 'New chat' || current.title === 'Unsaved'
      const next = [...prev]
      next[idx] = {
        ...current,
        updatedAt: lengthChanged ? Date.now() : current.updatedAt,
        messages,
        title: placeholderTitle ? deriveSessionTitle(messages) || current.title : current.title,
        hiddenContextSummary: nextHiddenContextSummary,
        contextCompressedThroughIndex: nextCompressedThrough,
        codingContextMemo: nextMemo,
        codingProjectPath: projectPath || undefined,
        imageVisionCache: nextVisionCache,
        // Keep sticky unsaved bit until explicit Save.
        ...(current.unsaved ? { unsaved: true } : {}),
      }
      if (lengthChanged) {
        next.sort((a, b) => b.updatedAt - a.updatedAt)
      }
      return next
    })
    // Auto-save chats stay clean after mirror. Sticky unsaved keep SAVE via `unsaved` flag.
    if (settings.autoSaveChat) setSessionDirty(false)
  }, [
    messages,
    hiddenContextSummary,
    contextCompressedThroughIndex,
    codingContextMemo,
    imageVisionCache,
    activeSessionId,
    sessionsHydrated,
    settings.coding.projectPath,
    settings.codingProjectPath,
    settings.autoSaveChat,
    pendingNewSessionPreset,
  ])

  const activeSessionUseLongMemory = settings.longMemoryDefaultEnabled

  const activeUnsaved = Boolean(
    activeSessionId && sessions.find((s) => s.id === activeSessionId)?.unsaved,
  )
  const canSaveSession =
    !settings.autoSaveChat &&
    messages.length > 0 &&
    !busy &&
    (sessionDirty || activeUnsaved)

  const applyComposerDraft = (key: string) => {
    const draft = loadComposerDraft(key)
    setInput(draft.input)
    setPendingImages(draft.pendingImages)
    setPendingFiles(draft.pendingFiles)
  }

  const stashActiveComposer = () => {
    stashComposerDraft(runtimeKeyForSession(activeSessionId), {
      input,
      pendingImages,
      pendingFiles,
    })
  }

  /**
   * Claim a real session id for the draft before the first agent turn.
   * Always assigns a sticky id (sidebar row) so multi-session works with auto-save off;
   * those rows are marked `unsaved` and stay out of IndexedDB until Save.
   */
  const claimSessionIdForDraft = useCallback((): string | null => {
    if (activeSessionId) return activeSessionId
    const newId = uid()
    const now = Date.now()
    const projectPath = getCodingProjectPath(settings)
    const stickyUnsaved = !settings.autoSaveChat
    sessionAgentStore.rekey(DRAFT_RUNTIME_KEY, newId)
    rekeyComposerDraft(DRAFT_RUNTIME_KEY, newId)
    rekeyCodingTerminalOwner?.(DRAFT_RUNTIME_KEY, newId)
    setSessions((prev) => {
      if (prev.some((s) => s.id === newId)) return prev
      const shell: ChatSession = {
        id: newId,
        title: stickyUnsaved ? 'Unsaved' : 'New chat',
        createdAt: now,
        updatedAt: now,
        messages: [],
        systemPromptPreset: pendingNewSessionPreset,
        codingContextMemo: normalizeCodingContextMemo(codingContextMemo, projectPath),
        codingProjectPath: projectPath || undefined,
        imageVisionCache: normalizeImageVisionCache(imageVisionCache),
        ...(stickyUnsaved ? { unsaved: true as const } : {}),
      }
      return [...prev, shell].sort((a, b) => b.updatedAt - a.updatedAt)
    })
    setActiveSessionId(newId)
    if (stickyUnsaved) setSessionDirty(true)
    return newId
  }, [
    activeSessionId,
    settings.autoSaveChat,
    settings.coding.projectPath,
    settings.codingProjectPath,
    rekeyCodingTerminalOwner,
    pendingNewSessionPreset,
    codingContextMemo,
    imageVisionCache,
  ])

  /** Apply coding memo patches for a background (non-visible) session. */
  const patchSessionCodingMemo = useCallback(
    (sessionId: string, action: SetStateAction<CodingContextMemo>) => {
      setSessions((prev) => {
        const idx = prev.findIndex((s) => s.id === sessionId)
        if (idx < 0) return prev
        const current = prev[idx]
        const projectPath = sessionCodingProjectPath(current) || getCodingProjectPath(settings)
        const prevMemo = resolveMemoForSession(current, projectPath)
        const nextMemo = normalizeCodingContextMemo(resolveAction(prevMemo, action), projectPath)
        const next = [...prev]
        next[idx] = {
          ...current,
          codingContextMemo: nextMemo,
          updatedAt: Date.now(),
        }
        return next
      })
    },
    [settings],
  )

  /** Reset the active view for a brand-new chat bound to `projectPath` ('' = General). */
  const resetForNewChat = (projectPath: string) => {
    // Leave other sessions' agent runs running in the background.
    cancelMessageEdit?.()
    stashActiveComposer()
    sessionAgentStore.resetDraft()
    clearComposerDraft(DRAFT_RUNTIME_KEY)
    setHiddenContextSummary('')
    setContextCompressedThroughIndex(0)
    contextOverflowLatchRef.current = false
    setContextUsageInfo(null)
    setContextWarnDismissed(false)
    setActiveSessionId(null)
    setPendingNewSessionPreset('default')
    setSessionDirty(false)
    setPendingDeleteId(null)
    setRenamingSessionId(null)
    setRenameValue('')
    setInput('')
    setPendingImages([])
    setPendingFiles([])
    setError(null)
    setToolResultBanner(null)
    // Bind terminal to draft first so clear does not wipe another chat's feed.
    switchCodingTerminalOwner?.(DRAFT_RUNTIME_KEY)
    resetCodingTerminal()
    const trimmed = projectPath.trim()
    // 1C: A new chat is General unless a folder is bound to it up front.
    codingProjectPathForMemoRef.current = trimmed
    setSettings((s) => mergeCodingProjectPathIntoSettings(s, trimmed))
    setCodingContextMemo(emptyCodingContextMemo(trimmed))
    setImageVisionCache({})
  }

  const newChat = () => resetForNewChat('')

  /** Start a fresh chat already bound to the given project folder. */
  const newChatForProject = (projectPath: string) => resetForNewChat(projectPath)

  const openSession = (session: ChatSession) => {
    // Do NOT abort the previous session's agent — background multi-chat.
    cancelMessageEdit?.()
    stashActiveComposer()
    const flushId =
      activeSessionId && activeSessionId !== session.id ? activeSessionId : null
    restoreCodingContextForSession(session, { flushActiveSessionId: flushId })

    const live = sessionAgentStore.get(session.id)
    // Prefer live runtime messages when the agent is mid-run (or has fresher state).
    if (live?.busy) {
      // slot already owns messages
    } else if (live) {
      // Keep live slot if present (may be slightly ahead of persisted).
    } else {
      sessionAgentStore.hydrateMessages(session.id, session.messages)
    }

    const messagesForView = sessionAgentStore.getSnapshot(session.id).messages
    const through = resolveContextCompressedThroughIndex(
      session.hiddenContextSummary,
      session.contextCompressedThroughIndex,
      messagesForView.length,
    )
    setHiddenContextSummary(session.hiddenContextSummary ?? '')
    setContextCompressedThroughIndex(through)
    if (
      session.hiddenContextSummary?.trim() &&
      (session.contextCompressedThroughIndex ?? 0) !== through
    ) {
      const updated = { ...session, contextCompressedThroughIndex: through, updatedAt: Date.now() }
      setSessions((prev) => {
        const next = prev.map((s) => (s.id === session.id ? updated : s))
        scheduleSaveChatSessions({ sessions: next, activeSessionId: session.id })
        return next
      })
    }
    if (!live?.busy) {
      // Fresh session view: usage comes with the slot on next render; no write needed.
    }
    setActiveSessionId(session.id)
    setSessionDirty(false)
    setPendingDeleteId(null)
    setRenamingSessionId(null)
    setRenameValue('')
    applyComposerDraft(session.id)
    setImageVisionCache(normalizeImageVisionCache(session.imageVisionCache))
    sessionAgentStore.clearCompleteUnread(session.id)
  }

  const forkSession = (session: ChatSession) => {
    cancelMessageEdit?.()
    stashActiveComposer()
    const now = Date.now()
    const sourceMessages =
      sessionAgentStore.get(session.id)?.messages ?? session.messages
    const forked: ChatSession = {
      id: uid(),
      title: `${session.title} (fork)`,
      createdAt: now,
      updatedAt: now,
      messages: sourceMessages,
      systemPromptPreset: session.systemPromptPreset,
      hiddenContextSummary: session.hiddenContextSummary,
      contextCompressedThroughIndex: session.contextCompressedThroughIndex,
      codingContextMemo: session.codingContextMemo,
      codingProjectPath: session.codingProjectPath,
      imageVisionCache: session.imageVisionCache,
      ...(session.unsaved ? { unsaved: true } : {}),
    }
    const nextState = upsertSession({ sessions, activeSessionId }, forked)
    setSessions(nextState.sessions)
    sessionAgentStore.hydrateMessages(forked.id, forked.messages)
    setActiveSessionId(forked.id)
    scheduleSaveChatSessions(nextState)
    setHiddenContextSummary(forked.hiddenContextSummary ?? '')
    setContextCompressedThroughIndex(
      resolveContextCompressedThroughIndex(
        forked.hiddenContextSummary,
        forked.contextCompressedThroughIndex,
        forked.messages.length,
      ),
    )
    setContextUsageInfo(null)
    setContextWarnDismissed(false)
    setSessionDirty(Boolean(session.unsaved))
    setToolResultBanner(null)
    setPendingDeleteId(null)
    setRenamingSessionId(null)
    setRenameValue('')
    applyComposerDraft(forked.id)
    restoreCodingContextForSession(forked, {
      flushActiveSessionId:
        activeSessionId && activeSessionId !== forked.id ? activeSessionId : null,
    })
  }

  const exportSessionToMarkdown = (session: ChatSession) => {
    const lines: string[] = []
    lines.push(`# ${session.title}`)
    lines.push('')
    lines.push(`_Exported: ${new Date().toLocaleString()}_`)
    lines.push('')
    for (const m of session.messages) {
      const role = m.role === 'user' ? 'User' : 'Assistant'
      lines.push(`## ${role}`)
      lines.push('')
      if (m.content.trim()) {
        lines.push(m.content)
        lines.push('')
      }
      if (m.images?.length) {
        lines.push(`_(${m.images.length} image(s) attached)_`)
        lines.push('')
      }
      if (m.fileAttachments?.length) {
        for (const f of m.fileAttachments) {
          lines.push(`- **File:** ${f.name}`)
        }
        lines.push('')
      }
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${session.title.replace(/[^a-z0-9\u0400-\u04FF\-]/gi, '_').slice(0, 60) || 'chat'}.md`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const setUseLongMemoryForActiveChat = (enabled: boolean) => {
    setSettings((prev) => ({ ...prev, longMemoryDefaultEnabled: enabled }))
  }

  /** Per-chat system prompt preset: applies from the next message. */
  const setSystemPromptPresetForActiveChat = (preset: SystemPromptPreset) => {
    if (!activeSessionId) {
      // Brand-new (unsaved) chat — stash for the session created on first message.
      setPendingNewSessionPreset(preset)
      return
    }
    const idx = sessions.findIndex((s) => s.id === activeSessionId)
    if (idx < 0) return
    const current = sessions[idx]
    if ((current.systemPromptPreset ?? 'default') === preset) return
    const next = [...sessions]
    next[idx] = { ...current, systemPromptPreset: preset, updatedAt: Date.now() }
    setSessions(next)
    scheduleSaveChatSessions({ sessions: next, activeSessionId })
  }

  const activeSystemPromptPreset: SystemPromptPreset = activeSessionId
    ? sessions.find((s) => s.id === activeSessionId)?.systemPromptPreset ?? 'default'
    : pendingNewSessionPreset

  const saveOrUpdateSession = () => {
    if (messages.length === 0) return
    const now = Date.now()
    const existing = activeSessionId ? sessions.find((s) => s.id === activeSessionId) : null
    const id = existing?.id ?? uid()
    if (!activeSessionId) {
      sessionAgentStore.rekey(DRAFT_RUNTIME_KEY, id)
      rekeyComposerDraft(DRAFT_RUNTIME_KEY, id)
      rekeyCodingTerminalOwner?.(DRAFT_RUNTIME_KEY, id)
    }
    const next: ChatSession = {
      id,
      title: existing?.title || deriveSessionTitle(messages),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      messages,
      systemPromptPreset: existing?.systemPromptPreset ?? pendingNewSessionPreset,
      hiddenContextSummary: hiddenContextSummary.trim() || undefined,
      contextCompressedThroughIndex: hiddenContextSummary.trim()
        ? contextCompressedThroughIndex
        : undefined,
      codingContextMemo: normalizeCodingContextMemo(
        codingContextMemo,
        getCodingProjectPath(settings),
      ),
      codingProjectPath: getCodingProjectPath(settings) || undefined,
      imageVisionCache: normalizeImageVisionCache(imageVisionCache),
      // Explicit Save promotes sticky draft into durable storage.
    }
    const nextState = upsertSession({ sessions, activeSessionId }, next)
    setSessions(nextState.sessions)
    setActiveSessionId(nextState.activeSessionId)
    scheduleSaveChatSessions(nextState)
    setSessionDirty(false)
  }

  const deleteSession = (sessionId: string) => {
    // Stop that session's agent if running, without stopping others.
    sessionAgentStore.discard(sessionId)
    void cancelActiveMcpCalls(sessionId)
    clearComposerDraft(sessionId)
    const state = deleteSessionById({ sessions, activeSessionId }, sessionId)
    setSessions(state.sessions)
    setActiveSessionId(state.activeSessionId)
    if (state.activeSessionId) {
      const next = state.sessions.find((s) => s.id === state.activeSessionId)
      if (next) {
        if (!sessionAgentStore.get(next.id)?.busy) {
          sessionAgentStore.hydrateMessages(next.id, next.messages)
        }
        setHiddenContextSummary(next.hiddenContextSummary ?? '')
        setContextCompressedThroughIndex(
          resolveContextCompressedThroughIndex(
            next.hiddenContextSummary,
            next.contextCompressedThroughIndex,
            next.messages.length,
          ),
        )
        restoreCodingContextForSession(next)
        applyComposerDraft(next.id)
      }
    } else {
      sessionAgentStore.resetDraft()
      setHiddenContextSummary('')
      setContextCompressedThroughIndex(0)
      contextOverflowLatchRef.current = false
      switchCodingTerminalOwner?.(DRAFT_RUNTIME_KEY)
      resetCodingTerminal()
      codingProjectPathForMemoRef.current = ''
      setSettings((s) => mergeCodingProjectPathIntoSettings(s, ''))
      setCodingContextMemo(emptyCodingContextMemo(''))
      setImageVisionCache({})
      applyComposerDraft(DRAFT_RUNTIME_KEY)
    }
    setContextUsageInfo(null)
    setContextWarnDismissed(false)
    scheduleSaveChatSessions(state)
    setSessionDirty(false)
    setPendingDeleteId(null)
    if (renamingSessionId === sessionId) {
      setRenamingSessionId(null)
      setRenameValue('')
    }
  }

  const startRenameSession = (session: ChatSession) => {
    setPendingDeleteId(null)
    setRenamingSessionId(session.id)
    setRenameValue(session.title)
  }

  const cancelRenameSession = () => {
    setRenamingSessionId(null)
    setRenameValue('')
  }

  const commitRenameSession = (sessionId: string) => {
    const nextTitle = renameValue.trim().replace(/\s+/g, ' ')
    if (!nextTitle) return
    const updated = sessions.map((s) =>
      s.id === sessionId ? { ...s, title: nextTitle, updatedAt: Date.now() } : s,
    )
    setSessions(updated)
    scheduleSaveChatSessions({ sessions: updated, activeSessionId })
    setRenamingSessionId(null)
    setRenameValue('')
  }

  return {
    sessions,
    setSessions,
    activeSessionId,
    setActiveSessionId,
    sessionDirty,
    setSessionDirty,
    sidebarCollapsed,
    setSidebarCollapsed,
    pendingDeleteId,
    setPendingDeleteId,
    renamingSessionId,
    renameValue,
    setRenameValue,
    sessionsHydrated,
    hiddenContextSummary,
    setHiddenContextSummary,
    contextCompressedThroughIndex,
    setContextCompressedThroughIndex,
    activeSessionUseLongMemory,
    canSaveSession,
    newChat,
    newChatForProject,
    openSession,
    forkSession,
    exportSessionToMarkdown,
    saveOrUpdateSession,
    deleteSession,
    startRenameSession,
    cancelRenameSession,
    commitRenameSession,
    setUseLongMemoryForActiveChat,
    activeSystemPromptPreset,
    setSystemPromptPresetForActiveChat,
    claimSessionIdForDraft,
    patchSessionCodingMemo,
  }
}
