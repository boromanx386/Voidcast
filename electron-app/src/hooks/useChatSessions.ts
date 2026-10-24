import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react'
import { resolveContextCompressedThroughIndex } from '@/lib/chatMessages'
import {
  deleteSessionsByIds,
  loadChatSessions,
  scheduleSaveChatSessions,
  upsertSession,
} from '@/lib/chatSessionsStorage'
import {
  emptyCodingContextMemo,
  emptyCodingTurnEvidence,
  formatCodingTurnEvidenceLabel,
  normalizeCodingContextMemo,
  patchSessionCodingPath,
  resolveMemoForSession,
  sessionCodingProjectPath,
  type CodingContextMemo,
} from '@/lib/codingContextMemo'
import { deriveSessionTitle } from '@/lib/chatHints'
import { generateSessionTitle, isAutoSessionTitle } from '@/lib/chatTitle'
import { subAgentKeysFromSettings } from '@/lib/subAgentKeys'
import { invokePickCodingDirectory } from '@/lib/codingTools'
import { uid } from '@/lib/chatUid'
import {
  mergeImageVisionCache,
  normalizeImageVisionCache,
  type ImageVisionCache,
} from '@/lib/imageVisionCache'
import {
  loadSettings,
  subAgentConfigForRole,
  type AppSettings,
  type LlmThinkLevel,
} from '@/lib/settings'
import type { ContextUsageInfo } from '@/lib/contextUsage'
import type { PendingChatImage } from '@/lib/chatImageCatalog'
import {
  clearComposerDraft,
  loadComposerDraft,
  rekeyComposerDraft,
  stashComposerDraft,
} from '@/lib/chatComposerDrafts'
import { DRAFT_RUNTIME_KEY, runtimeKeyForSession, sessionAgentStore } from '@/lib/sessionAgentStore'
import { cancelActiveMcpCalls } from '@/lib/mcpTools'
import type { AgentChatMode, ChatSession, FileAttachmentSnapshot, UiMessage } from '@/types/chat'
import { normalizeAgentChatMode } from '@/types/chat'
import { applyScopedModelToSettings, currentPinnedModelId } from '@/lib/pinnedModels'
import { formatDurationMs } from '@/lib/turnTimer'

function resolveAction<T>(prev: T, action: SetStateAction<T>): T {
  return typeof action === 'function' ? (action as (p: T) => T)(prev) : action
}

/**
 * Full transcript of one chat for the sidebar "Export .md" action. Covers everything the
 * chat shows — user/assistant turns, streamed reasoning, the intermediate agent rounds that
 * precede each tool call, sub-agent activity, plan artifacts and tool evidence — not only
 * the final replies. Thinking and agent rounds fold into `<details>` blocks so a long
 * export stays readable.
 */
function buildSessionMarkdown(session: ChatSession): string {
  const lines: string[] = []
  const push = (...rows: string[]) => lines.push(...rows)

  push(`# ${session.title}`, '')
  push(`_Exported: ${new Date().toLocaleString()}_`, '')

  for (const m of session.messages) {
    const role = m.role === 'user' ? 'User' : 'Assistant'
    const duration =
      m.role === 'assistant' && m.turnStartedAt && m.turnEndedAt
        ? ` — ${formatDurationMs(m.turnEndedAt - m.turnStartedAt)}`
        : ''
    push(`## ${role}${duration}`, '')

    if (m.steered) push('_Steer: this message redirected a running turn._', '')
    if (m.planHandoffDraft) push('_Kept as a draft before the Plan-mode turn._', '')

    // Reasoning streamed before the reply (Ollama `thinking` / OpenRouter `reasoning`).
    if (m.thinking?.trim()) {
      push('<details>', '<summary>Thinking</summary>', '', m.thinking.trim(), '', '</details>', '')
    }

    // Intermediate drafts the agent wrote before a tool round replaced the bubble reply.
    if (m.agentProgress?.length) {
      push('<details>')
      push(`<summary>Agent rounds · ${m.agentProgress.length} (before tool calls)</summary>`, '')
      for (const progress of m.agentProgress) {
        if (!progress.content.trim()) continue
        push(`**Round ${progress.round}**`, '', progress.content.trim(), '')
      }
      push('</details>', '')
    }

    // Collapsible sub-agent activity card (vision / explore / coding workers) for this turn.
    if (m.subAgentActivity?.text?.trim()) {
      const activity = m.subAgentActivity
      push(`### Sub-agent · ${activity.title || activity.kind}`, '')
      if (activity.progress.trim()) push(`_${activity.progress.trim()}_`, '')
      push(activity.text.trim(), '')
    }

    if (m.content.trim()) push(m.content.trim(), '')

    if (m.plan) {
      push(`### Plan · ${m.plan.title}`, '')
      if (m.plan.summary?.trim()) push(m.plan.summary.trim(), '')
      for (const step of m.plan.steps) {
        push(`${step.done ? '- [x]' : '- [ ]'} ${step.text}`)
      }
      push('', `_Status: ${m.plan.status}_`, '')
    }

    if (m.codingTurnEvidence) {
      const evidence = { ...emptyCodingTurnEvidence(), ...m.codingTurnEvidence }
      push(`_Tools: ${formatCodingTurnEvidenceLabel(evidence)}_`, '')
    }

    if (m.images?.length) push(`_(${m.images.length} image(s) attached)_`, '')
    if (m.generatedImageUrls?.length) {
      push(`_(${m.generatedImageUrls.length} image(s) generated)_`, '')
    }
    if (m.generatedAudioPaths?.length) {
      push(`_(${m.generatedAudioPaths.length} audio clip(s))_`, '')
    }
    if (m.fileAttachments?.length) {
      for (const f of m.fileAttachments) push(`- **File:** ${f.name}`)
      push('')
    }
  }

  return lines.join('\n')
}

// The sub-agent keys builder lives in `@/lib/subAgentKeys` — shared with the prompt-hint
// path in useVoidcastApp, so both side requests read one set of endpoints.

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
  /** Keep the agent runtime on the same session during the state transition. */
  setViewSessionId: Dispatch<SetStateAction<string | null>>
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
  setToolResultBanner: Dispatch<SetStateAction<{ text: string } | null>>
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
    setViewSessionId,
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
  /** Think level for the next brand-new session (undefined = follow the global default). */
  const [pendingNewSessionThinkLevel, setPendingNewSessionThinkLevel] = useState<
    LlmThinkLevel | undefined
  >(undefined)
  /**
   * Agent mode for the next brand-new session. Set on every picker change so a fresh
   * chat keeps the user's last choice instead of a stale global value.
   */
  const [pendingNewSessionAgentMode, setPendingNewSessionAgentMode] =
    useState<AgentChatMode | null>(null)
  /**
   * Folder owned by the not-yet-created chat. It lives here instead of in settings so a
   * draft can never borrow — or clear — the app default another chat is using.
   * Empty string = General.
   */
  const [draftCodingProjectPath, setDraftCodingProjectPath] = useState('')
  const draftCodingProjectPathRef = useRef('')

  // `useChatAgent` is created before this hook, so the parent normally mirrors
  // activeSessionId to its runtime key in an effect. That effect is one render
  // late during chat switches; update both pieces of state together for paths
  // that change the active session so auto-save cannot observe the previous
  // session's messages as a new draft.
  const setActiveSession = (sessionId: string | null) => {
    setActiveSessionId(sessionId)
    setViewSessionId(sessionId)
  }

  // Load sessions from IndexedDB (one-time localStorage migration on first run)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const state = await loadChatSessions()
      if (cancelled) return
      const baseSettings = loadSettings()
      let sessionsMigrated = false
      const sessions = state.sessions.map((s) => {
        let next = s
        // Give every legacy chat its own mode so it can never follow the viewed chat.
        if (!next.agentMode) {
          sessionsMigrated = true
          next = { ...next, agentMode: normalizeAgentChatMode(baseSettings.agentMode) }
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
      setActiveSession(state.activeSessionId)
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
      // Bound path only: no active / no path → General. The open chat owns its folder,
      // so hydrating must never rewrite the app-level default in settings.
      const projectPath = sessionCodingProjectPath(active ?? undefined)
      setDraftCodingProjectPath('')
      draftCodingProjectPathRef.current = ''
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
          !prev[idx].title || prev[idx].title === 'New chat' || prev[idx].title === 'Unsaved'
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

  // One-shot title upgrade: replace the derived placeholder (first 60 chars of the prompt)
  // with a topic title from the sub-agent model, once the first reply has landed.
  // Only chats created during this app run qualify (`titleEpochRef`), so restarting never
  // fires one model call per stored chat. An epoch beats seeding the attempt set on the
  // first hydrated render: that depended on `sessions` and `sessionsHydrated` landing in
  // the same batch. Attempted at most once per session id.
  const titledSessionIdsRef = useRef<Set<string>>(new Set())
  const titleEpochRef = useRef(Date.now())

  useEffect(() => {
    if (!sessionsHydrated) return
    // An empty coding model (or no sub-agent at all) disables title generation.
    const config = subAgentConfigForRole(settings.subAgent, 'coding')
    if (!config.model?.trim()) return
    const candidates = sessions
      .filter((s) => {
        if (titledSessionIdsRef.current.has(s.id)) return false
        if (s.createdAt < titleEpochRef.current) return false
        // Unsaved rows (autoSaveChat off) qualify too: their title lives in the sidebar like
        // any other and persists when the chat is explicitly saved. Skipping them here meant
        // no title was ever generated for anyone running with auto-save off.
        // A rename wins: only a still-machine-generated title may be overwritten.
        if (!isAutoSessionTitle(s.title, s.messages)) return false
        if (!s.messages.some((m) => m.role === 'assistant' && m.content.trim())) return false
        // Wait out the visible turn so the seed holds a real reply. Background chats are
        // not tracked here — a partial reply still names the topic well enough.
        if (s.id === activeSessionId && busy) return false
        return true
      })
      .slice(0, 2)
    for (const session of candidates) {
      titledSessionIdsRef.current.add(session.id)
      void generateSessionTitle({
        messages: session.messages,
        config,
        keys: subAgentKeysFromSettings(settings, session.id),
      })
        .then((title) => {
          if (!title) return
          setSessions((prev) => {
            const idx = prev.findIndex((s) => s.id === session.id)
            // Session deleted while the call was in flight — drop the result silently.
            if (idx < 0) return prev
            if (!isAutoSessionTitle(prev[idx].title, prev[idx].messages)) return prev
            const next = [...prev]
            next[idx] = { ...prev[idx], title }
            return next
          })
        })
        .catch((err: unknown) => {
          // Provider unreachable or rejected: the derived placeholder title stays. Never
          // swallow this silently — a mute catch is what makes a wired feature look absent.
          console.warn('[chatTitle] title generation failed:', err)
        })
    }
  }, [sessions, sessionsHydrated, settings, activeSessionId, busy])

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
      const projectPath = draftCodingProjectPathRef.current
      const newSession: ChatSession = {
        id: newId,
        title: deriveSessionTitle(messages),
        createdAt: now,
        updatedAt: now,
        messages,
        thinkLevel: pendingNewSessionThinkLevel,
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
      setActiveSession(newId)
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
      // An existing chat keeps its own folder ('' = General); only a fresh row inherits the draft.
      const projectPath =
        idx >= 0 ? sessionCodingProjectPath(prev[idx]) : draftCodingProjectPathRef.current
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
          thinkLevel: pendingNewSessionThinkLevel,
          agentMode: pendingNewSessionAgentMode ?? normalizeAgentChatMode(settings.agentMode),
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
    settings.autoSaveChat,
    pendingNewSessionThinkLevel,
  ])

  const activeSessionUseLongMemory = settings.longMemoryDefaultEnabled

  const activeUnsaved = Boolean(
    activeSessionId && sessions.find((s) => s.id === activeSessionId)?.unsaved,
  )
  const canSaveSession = !settings.autoSaveChat && messages.length > 0 && !busy && activeUnsaved

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
    const projectPath = draftCodingProjectPathRef.current
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
        thinkLevel: pendingNewSessionThinkLevel,
        agentMode: pendingNewSessionAgentMode ?? normalizeAgentChatMode(settings.agentMode),
        codingContextMemo: normalizeCodingContextMemo(codingContextMemo, projectPath),
        codingProjectPath: projectPath || undefined,
        imageVisionCache: normalizeImageVisionCache(imageVisionCache),
        ...(stickyUnsaved ? { unsaved: true as const } : {}),
      }
      return [...prev, shell].sort((a, b) => b.updatedAt - a.updatedAt)
    })
    setActiveSession(newId)
    if (stickyUnsaved) setSessionDirty(true)
    return newId
  }, [
    activeSessionId,
    settings.autoSaveChat,
    rekeyCodingTerminalOwner,
    pendingNewSessionThinkLevel,
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
        // The memo belongs to this chat — no settings fallback, '' = General.
        const projectPath = sessionCodingProjectPath(current)
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
    [],
  )

  /** Merge vision-cache entries into a background (non-visible) session. */
  const patchSessionImageVision = useCallback((sessionId: string, entries: ImageVisionCache) => {
    setSessions((prev) => {
      const idx = prev.findIndex((s) => s.id === sessionId)
      if (idx < 0) return prev
      const current = prev[idx]
      const next = [...prev]
      next[idx] = {
        ...current,
        imageVisionCache: mergeImageVisionCache(
          normalizeImageVisionCache(current.imageVisionCache),
          entries,
        ),
        updatedAt: Date.now(),
      }
      return next
    })
  }, [])

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
    setActiveSession(null)
    setPendingNewSessionThinkLevel(undefined)
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
    // 1C: A new chat is General unless a folder is bound to it up front. The folder
    // belongs to the draft, so the app default in settings is left untouched.
    codingProjectPathForMemoRef.current = trimmed
    setDraftCodingProjectPath(trimmed)
    draftCodingProjectPathRef.current = trimmed
    setCodingContextMemo(emptyCodingContextMemo(trimmed))
    setImageVisionCache({})
  }

  const newChat = () => resetForNewChat('')

  /** Open the folder picker, then start a fresh chat bound to the selected folder. */
  const newChatWithPickedFolder = async () => {
    const result = await invokePickCodingDirectory()
    if (result.ok) resetForNewChat(result.path)
  }

  /** Start a fresh chat already bound to the given project folder. */
  const newChatForProject = (projectPath: string) => resetForNewChat(projectPath)

  const openSession = (session: ChatSession) => {
    // Do NOT abort the previous session's agent — background multi-chat.
    cancelMessageEdit?.()
    stashActiveComposer()
    const flushId = activeSessionId && activeSessionId !== session.id ? activeSessionId : null
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
    setActiveSession(session.id)
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
    const sourceMessages = sessionAgentStore.get(session.id)?.messages ?? session.messages
    const forked: ChatSession = {
      id: uid(),
      title: `${session.title} (fork)`,
      createdAt: now,
      updatedAt: now,
      messages: sourceMessages,
      thinkLevel: session.thinkLevel,
      agentMode: session.agentMode ?? normalizeAgentChatMode(settings.agentMode),
      // A fork continues the same chat, so it stays locked to the same model.
      model: session.model,
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
    setActiveSession(forked.id)
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
    const blob = new Blob([buildSessionMarkdown(session)], { type: 'text/markdown' })
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

  /** Per-chat think level (undefined = global default): applies from the next message. */
  const setThinkLevelForActiveChat = (level: LlmThinkLevel | undefined) => {
    if (!activeSessionId) {
      // Brand-new (unsaved) chat — stash for the session created on first message.
      setPendingNewSessionThinkLevel(level)
      return
    }
    const idx = sessions.findIndex((s) => s.id === activeSessionId)
    if (idx < 0) return
    const current = sessions[idx]
    if (current.thinkLevel === level) return
    const next = [...sessions]
    next[idx] = { ...current, thinkLevel: level, updatedAt: Date.now() }
    setSessions(next)
    scheduleSaveChatSessions({ sessions: next, activeSessionId })
  }

  const activeThinkLevel: LlmThinkLevel | undefined = activeSessionId
    ? sessions.find((s) => s.id === activeSessionId)?.thinkLevel
    : pendingNewSessionThinkLevel

  /**
   * Agent mode of the chat on screen. The session owns the value; `settings.agentMode`
   * only seeds brand-new chats (and chats hydration has not back-filled yet).
   */
  const activeAgentMode: AgentChatMode = activeSessionId
    ? normalizeAgentChatMode(
        sessions.find((s) => s.id === activeSessionId)?.agentMode ?? settings.agentMode,
      )
    : (pendingNewSessionAgentMode ?? normalizeAgentChatMode(settings.agentMode))

  /**
   * Write agent mode onto one chat by id. Safe for background chats: the session is the
   * source of truth, so a plan escalation in chat A can never retarget the viewed chat.
   */
  const setAgentModeForSession = useCallback((sessionId: string, mode: AgentChatMode) => {
    setSessions((prev) => {
      const idx = prev.findIndex((s) => s.id === sessionId)
      if (idx < 0) return prev
      const current = prev[idx]
      if (current.agentMode === mode) return prev
      const next = [...prev]
      next[idx] = { ...current, agentMode: mode }
      return next
    })
  }, [])

  /** Per-chat agent mode picker: applies from the next message, like the think-level picker. */
  const setAgentModeForActiveChat = (mode: AgentChatMode) => {
    setPendingNewSessionAgentMode(mode)
    if (!activeSessionId) return
    setAgentModeForSession(activeSessionId, mode)
  }

  /**
   * Scoped LLM id this chat is locked to, '' while it follows the app-level model. The
   * presence of `ChatSession.model` IS the lock: the padlock writes it and clears it.
   */
  const activeChatModelId: string = activeSessionId
    ? sessions.find((s) => s.id === activeSessionId)?.model?.trim() || ''
    : ''

  /** Id the next turn runs with: the chat's own model when it has one, else the Options one. */
  const activeModelId: string = activeChatModelId || currentPinnedModelId(settings)

  /**
   * Write the model lock of one chat by id; `''` clears it. Safe for background chats: the
   * session owns the model, so a switch elsewhere never retargets a running turn.
   */
  const setModelForSession = useCallback((sessionId: string, scopedId: string) => {
    const value = scopedId.trim() || undefined
    setSessions((prev) => {
      const idx = prev.findIndex((s) => s.id === sessionId)
      if (idx < 0) return prev
      const current = prev[idx]
      if (current.model === value) return prev
      const next = [...prev]
      next[idx] = { ...current, model: value }
      return next
    })
  }, [])

  /**
   * Chat-header model switcher. A locked chat keeps its own model, so the pick lands on that
   * chat; an unlocked one follows Options, so the pick is the global change the switcher made
   * before the per-chat lock — which is why it also works in a chat with no session id yet.
   */
  const setModelForActiveChat = (scopedId: string) => {
    if (activeSessionId && activeChatModelId) {
      setModelForSession(activeSessionId, scopedId)
      return
    }
    setSettings((prev) => applyScopedModelToSettings(prev, scopedId))
  }

  /** Chat-header padlock: lock this chat to the model it resolves to now, or release it. */
  const toggleModelLockForActiveChat = () => {
    if (!activeSessionId) return
    setModelForSession(activeSessionId, activeChatModelId ? '' : activeModelId)
  }

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
      thinkLevel: existing?.thinkLevel ?? pendingNewSessionThinkLevel,
      agentMode:
        existing?.agentMode ??
        pendingNewSessionAgentMode ??
        normalizeAgentChatMode(settings.agentMode),
      hiddenContextSummary: hiddenContextSummary.trim() || undefined,
      contextCompressedThroughIndex: hiddenContextSummary.trim()
        ? contextCompressedThroughIndex
        : undefined,
      // Saved chat keeps the folder it owns; only a brand-new row takes the draft's.
      codingContextMemo: normalizeCodingContextMemo(
        codingContextMemo,
        existing ? sessionCodingProjectPath(existing) : draftCodingProjectPathRef.current,
      ),
      codingProjectPath:
        (existing ? sessionCodingProjectPath(existing) : draftCodingProjectPathRef.current) ||
        undefined,
      imageVisionCache: normalizeImageVisionCache(imageVisionCache),
      // Explicit Save must not drop the model lock: upsertSession replaces the whole row.
      model: existing?.model,
      // Explicit Save promotes sticky draft into durable storage.
    }
    const nextState = upsertSession({ sessions, activeSessionId }, next)
    setSessions(nextState.sessions)
    setActiveSession(nextState.activeSessionId)
    scheduleSaveChatSessions(nextState)
    setSessionDirty(false)
  }

  const deleteSession = (sessionId: string) => deleteSessions([sessionId])

  /** Bulk delete: per-session teardown in a loop, but state, selection and persist once. */
  const deleteSessions = (sessionIds: string[]) => {
    if (sessionIds.length === 0) return
    for (const sessionId of sessionIds) {
      // Stop that session's agent if running, without stopping others.
      sessionAgentStore.discard(sessionId)
      void cancelActiveMcpCalls(sessionId)
      clearComposerDraft(sessionId)
    }
    const state = deleteSessionsByIds({ sessions, activeSessionId }, sessionIds)
    setSessions(state.sessions)
    setActiveSession(state.activeSessionId)
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
      setDraftCodingProjectPath('')
      draftCodingProjectPathRef.current = ''
      setCodingContextMemo(emptyCodingContextMemo(''))
      setImageVisionCache({})
      applyComposerDraft(DRAFT_RUNTIME_KEY)
    }
    setContextUsageInfo(null)
    setContextWarnDismissed(false)
    scheduleSaveChatSessions(state)
    setSessionDirty(false)
    setPendingDeleteId(null)
    if (renamingSessionId && sessionIds.includes(renamingSessionId)) {
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

  /** Folder owned by the chat on screen; the draft path while it has no id yet. */
  const activeCodingProjectPath = activeSessionId
    ? sessionCodingProjectPath(sessions.find((s) => s.id === activeSessionId))
    : draftCodingProjectPath

  /** Rebind the folder of the chat on screen — the chat owns it, nothing else writes it. */
  const setCodingPathForActiveChat = useCallback(
    (projectPath: string) => {
      const trimmed = projectPath.trim()
      if (!activeSessionId) {
        setDraftCodingProjectPath(trimmed)
        draftCodingProjectPathRef.current = trimmed
        return
      }
      setSessions((prev) => patchSessionCodingPath(prev, activeSessionId, trimmed))
    },
    [activeSessionId],
  )

  /** Folder bound to any chat by runtime key (background runs included); '' = General. */
  const codingProjectPathForRuntimeKey = useCallback(
    (runtimeKey: string) => {
      if (runtimeKey === DRAFT_RUNTIME_KEY) return draftCodingProjectPathRef.current
      const session = sessions.find((s) => s.id === runtimeKey)
      return session ? sessionCodingProjectPath(session) : ''
    },
    [sessions],
  )

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
    newChatWithPickedFolder,
    newChatForProject,
    openSession,
    forkSession,
    exportSessionToMarkdown,
    saveOrUpdateSession,
    deleteSession,
    deleteSessions,
    startRenameSession,
    cancelRenameSession,
    commitRenameSession,
    setUseLongMemoryForActiveChat,
    activeThinkLevel,
    setThinkLevelForActiveChat,
    activeAgentMode,
    setAgentModeForActiveChat,
    setAgentModeForSession,
    setModelForSession,
    patchSessionImageVision,
    activeModelId,
    activeChatModelId,
    setModelForActiveChat,
    toggleModelLockForActiveChat,
    activeCodingProjectPath,
    setCodingPathForActiveChat,
    codingProjectPathForRuntimeKey,
    claimSessionIdForDraft,
    patchSessionCodingMemo,
  }
}
