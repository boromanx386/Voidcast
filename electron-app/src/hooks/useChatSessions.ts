import { useEffect, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
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
import { LLM_PROMPT_PRESETS, loadSettings, type AppSettings } from '@/lib/settings'
import type { ContextUsageInfo } from '@/lib/contextUsage'
import type { PendingChatImage } from '@/lib/chatImageCatalog'
import type { ChatSession, UiMessage } from '@/types/chat'

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
  abortActiveRuns: () => void
  cancelMessageEdit?: () => void
  setInput: Dispatch<SetStateAction<string>>
  setPendingImages: Dispatch<SetStateAction<PendingChatImage[]>>
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
    abortActiveRuns,
    cancelMessageEdit,
    setInput,
    setPendingImages,
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

  // Load sessions from IndexedDB (one-time localStorage migration on first run)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const state = await loadChatSessions()
      if (cancelled) return
      let sessionsMigrated = false
      const sessions = state.sessions.map((s) => {
        if (!s.hiddenContextSummary?.trim()) return s
        const through = resolveContextCompressedThroughIndex(
          s.hiddenContextSummary,
          s.contextCompressedThroughIndex,
          s.messages.length,
        )
        if ((s.contextCompressedThroughIndex ?? 0) === through) return s
        sessionsMigrated = true
        return { ...s, contextCompressedThroughIndex: through }
      })
      setSessions(sessions)
      if (sessionsMigrated) {
        scheduleSaveChatSessions({ sessions, activeSessionId: state.activeSessionId })
      }
      setActiveSessionId(state.activeSessionId)
      const active = state.activeSessionId
        ? sessions.find((s) => s.id === state.activeSessionId)
        : null
      setMessages(active?.messages ?? [])
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

  // Persist sessions (debounced IndexedDB write)
  useEffect(() => {
    if (!sessionsHydrated) return
    scheduleSaveChatSessions({ sessions, activeSessionId })
  }, [sessions, activeSessionId, sessionsHydrated])

  // Auto-update sessions in state. When autoSaveChat is ON, auto-create new sessions too.
  // When OFF and no session ID, remains an unsaved draft until user clicks SAVE.
  useEffect(() => {
    if (!sessionsHydrated) return
    if (messages.length === 0) return

    // AutoSave OFF + no session ID → nothing to auto-update (manual save needed)
    if (!settings.autoSaveChat && !activeSessionId) return

    // AutoSave ON + no session ID yet → auto-create the session on first message
    if (!activeSessionId && settings.autoSaveChat) {
      const newId = uid()
      const now = Date.now()
      const projectPath = getCodingProjectPath(settings)
      const newSession: ChatSession = {
        id: newId,
        title: deriveSessionTitle(messages),
        createdAt: now,
        updatedAt: now,
        messages,
        hiddenContextSummary: hiddenContextSummary.trim() || undefined,
        contextCompressedThroughIndex: hiddenContextSummary.trim()
          ? contextCompressedThroughIndex
          : undefined,
        codingContextMemo: normalizeCodingContextMemo(codingContextMemo, projectPath),
        codingProjectPath: projectPath || undefined,
        imageVisionCache: normalizeImageVisionCache(imageVisionCache),
        promptPreset: (() => {
          const match = Object.entries(LLM_PROMPT_PRESETS).find(
            ([, v]) => v === settings.llmSystemPrompt,
          )
          return match ? match[0] : 'void'
        })(),
      }
      setSessions((prev) => [...prev, newSession].sort((a, b) => b.updatedAt - a.updatedAt))
      setActiveSessionId(newId)
      setSessionDirty(false)
      return
    }

    // activeSessionId exists — update existing session
    setSessions((prev) => {
      const idx = prev.findIndex((s) => s.id === activeSessionId)
      if (idx < 0) return prev
      const current = prev[idx]
      const nextHiddenContextSummary = hiddenContextSummary.trim() || undefined
      const nextCompressedThrough = nextHiddenContextSummary
        ? contextCompressedThroughIndex
        : undefined
      const projectPath = getCodingProjectPath(settings)
      const nextMemo = normalizeCodingContextMemo(codingContextMemo, projectPath)
      const sameMessagesRef = current.messages === messages
      const sameHiddenSummary =
        (current.hiddenContextSummary ?? '') === (nextHiddenContextSummary ?? '')
      const sameCompressedThrough =
        (current.contextCompressedThroughIndex ?? 0) === (nextCompressedThrough ?? 0)
      const sameMemo =
        JSON.stringify(current.codingContextMemo ?? null) === JSON.stringify(nextMemo)
      const sameCodingPath = (current.codingProjectPath ?? '') === projectPath
      const nextVisionCache = normalizeImageVisionCache(imageVisionCache)
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

      const next = [...prev]
      next[idx] = {
        ...current,
        updatedAt: Date.now(),
        messages,
        hiddenContextSummary: nextHiddenContextSummary,
        contextCompressedThroughIndex: nextCompressedThrough,
        codingContextMemo: nextMemo,
        codingProjectPath: projectPath || undefined,
        imageVisionCache: nextVisionCache,
        promptPreset: current.promptPreset,
      }
      next.sort((a, b) => b.updatedAt - a.updatedAt)
      return next
    })
    setSessionDirty(false)
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
  ])

  const activeSessionUseLongMemory = settings.longMemoryDefaultEnabled

  const canSaveSession =
    settings.autoSaveChat ? false : messages.length > 0 && !busy && sessionDirty

  const newChat = () => {
    abortActiveRuns()
    cancelMessageEdit?.()
    setMessages([])
    resetAssistantMediaState()
    setHiddenContextSummary('')
    setContextCompressedThroughIndex(0)
    contextOverflowLatchRef.current = false
    setContextUsageInfo(null)
    setContextWarnDismissed(false)
    setActiveSessionId(null)
    setSessionDirty(false)
    setPendingDeleteId(null)
    setRenamingSessionId(null)
    setRenameValue('')
    setInput('')
    setPendingImages([])
    setError(null)
    setToolResultBanner(null)
    resetCodingTerminal()
    // 1C: New chat is always General until a folder is picked for this session.
    codingProjectPathForMemoRef.current = ''
    setSettings((s) => mergeCodingProjectPathIntoSettings(s, ''))
    setCodingContextMemo(emptyCodingContextMemo(''))
    setImageVisionCache({})
    // Reset system prompt to default Void preset for fresh chats.
    setSettings((s) => ({ ...s, llmSystemPrompt: LLM_PROMPT_PRESETS.void }))
  }

  const openSession = (session: ChatSession) => {
    abortActiveRuns()
    cancelMessageEdit?.()
    const flushId =
      activeSessionId && activeSessionId !== session.id ? activeSessionId : null
    restoreCodingContextForSession(session, { flushActiveSessionId: flushId })
    setMessages(session.messages)
    resetAssistantMediaState()
    const through = resolveContextCompressedThroughIndex(
      session.hiddenContextSummary,
      session.contextCompressedThroughIndex,
      session.messages.length,
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
    setContextUsageInfo(null)
    setContextWarnDismissed(false)
    setActiveSessionId(session.id)
    setSessionDirty(false)
    setToolResultBanner(null)
    setPendingDeleteId(null)
    setRenamingSessionId(null)
    setRenameValue('')
    setPendingImages([])
    // Restore the system prompt from this session's preset, or keep global default.
    if (session.promptPreset && LLM_PROMPT_PRESETS[session.promptPreset]) {
      setSettings((s) => ({
        ...s,
        llmSystemPrompt: LLM_PROMPT_PRESETS[session.promptPreset],
      }))
    }
  }

  const forkSession = (session: ChatSession) => {
    cancelMessageEdit?.()
    const now = Date.now()
    const forked: ChatSession = {
      id: uid(),
      title: `${session.title} (fork)`,
      createdAt: now,
      updatedAt: now,
      messages: session.messages,
      hiddenContextSummary: session.hiddenContextSummary,
      contextCompressedThroughIndex: session.contextCompressedThroughIndex,
      codingContextMemo: session.codingContextMemo,
      codingProjectPath: session.codingProjectPath,
      imageVisionCache: session.imageVisionCache,
      promptPreset: session.promptPreset,
    }
    const nextState = upsertSession({ sessions, activeSessionId }, forked)
    setSessions(nextState.sessions)
    setActiveSessionId(forked.id)
    scheduleSaveChatSessions(nextState)
    setMessages(forked.messages)
    resetAssistantMediaState()
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
    setSessionDirty(false)
    setToolResultBanner(null)
    setPendingDeleteId(null)
    setRenamingSessionId(null)
    setRenameValue('')
    setPendingImages([])
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

  const saveOrUpdateSession = () => {
    if (messages.length === 0) return
    const now = Date.now()
    const existing = activeSessionId ? sessions.find((s) => s.id === activeSessionId) : null
    const next: ChatSession = {
      id: existing?.id ?? uid(),
      title: existing?.title || deriveSessionTitle(messages),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      messages,
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
    }
    const nextState = upsertSession({ sessions, activeSessionId }, next)
    setSessions(nextState.sessions)
    setActiveSessionId(nextState.activeSessionId)
    scheduleSaveChatSessions(nextState)
    setSessionDirty(false)
  }

  const deleteSession = (sessionId: string) => {
    const state = deleteSessionById({ sessions, activeSessionId }, sessionId)
    setSessions(state.sessions)
    setActiveSessionId(state.activeSessionId)
    if (state.activeSessionId) {
      const next = state.sessions.find((s) => s.id === state.activeSessionId)
      setMessages(next?.messages ?? [])
      resetAssistantMediaState()
      setHiddenContextSummary(next?.hiddenContextSummary ?? '')
      setContextCompressedThroughIndex(
        resolveContextCompressedThroughIndex(
          next?.hiddenContextSummary,
          next?.contextCompressedThroughIndex,
          next?.messages.length ?? 0,
        ),
      )
      if (next) restoreCodingContextForSession(next)
    } else {
      setMessages([])
      resetAssistantMediaState()
      setHiddenContextSummary('')
      setContextCompressedThroughIndex(0)
      contextOverflowLatchRef.current = false
      resetCodingTerminal()
      codingProjectPathForMemoRef.current = ''
      setSettings((s) => mergeCodingProjectPathIntoSettings(s, ''))
      setCodingContextMemo(emptyCodingContextMemo(''))
      setImageVisionCache({})
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
    openSession,
    forkSession,
    exportSessionToMarkdown,
    saveOrUpdateSession,
    deleteSession,
    startRenameSession,
    cancelRenameSession,
    commitRenameSession,
    setUseLongMemoryForActiveChat,
  }
}
