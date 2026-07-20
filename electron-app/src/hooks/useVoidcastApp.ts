import { useCallback, useEffect, useRef, useState } from 'react'
import { scheduleSaveChatSessions } from '@/lib/chatSessionsStorage'
import { fetchOllamaModels } from '@/lib/ollama'
import { deleteReminder, markReminderDone } from '@/lib/reminderStorage'
import { recordReminderDeleted, scheduleUserDataSync } from '@/lib/userDataSync'
import { useAppSettings } from '@/hooks/useAppSettings'
import { useChatAgent } from '@/hooks/useChatAgent'
import { useChatAttachments } from '@/hooks/useChatAttachments'
import { useChatSessions } from '@/hooks/useChatSessions'
import { useCodingSession } from '@/hooks/useCodingSession'
import { useLongMemoryUi } from '@/hooks/useLongMemoryUi'
import { useSttInput } from '@/hooks/useSttInput'
import { useTtsPlayback } from '@/hooks/useTtsPlayback'
import type { ImageVisionCache } from '@/lib/imageVisionCache'
import type { ChatSession, UiMessage } from '@/types/chat'
import type { OptionsTab, Screen } from '@/types/voidcast'

export type { OptionsTab, Screen } from '@/types/voidcast'

export function useVoidcastApp() {
  const {
    settings,
    setSettings,
    hostPdfOutputDir,
    setHostPdfOutputDir,
    effectivePdfOutputDir,
    appVersion,
  } = useAppSettings()

  const [screen, setScreen] = useState<Screen>('chat')
  const [optionsTab, setOptionsTab] = useState<OptionsTab>('general')
  const [sessionsSidebarCollapsed, setSessionsSidebarCollapsed] = useState(false)

  useEffect(() => {
    if (window.matchMedia('(max-width: 640px)').matches) {
      setSessionsSidebarCollapsed(true)
    }
  }, [])
  const [input, setInputState] = useState('')
  const [hiddenContextSummary, setHiddenContextSummary] = useState('')
  const [contextCompressedThroughIndex, setContextCompressedThroughIndex] = useState(0)
  const [imageVisionCache, setImageVisionCache] = useState<ImageVisionCache>({})

  const [ollamaModels, setOllamaModels] = useState<string[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)

  const sessionsRef = useRef<ChatSession[]>([])
  const setSessionsRef = useRef<React.Dispatch<React.SetStateAction<ChatSession[]>>>(() => {})
  const activeSessionIdRef = useRef<string | null>(null)
  const busyRef = useRef(false)
  const editingMessageIdRef = useRef<string | null>(null)
  const setErrorRef = useRef<(error: string | null) => void>(() => {})
  const onReadRef = useRef<(msg: UiMessage) => Promise<void>>(async () => {})
  const refreshRemindersRef = useRef<() => void | Promise<void>>(async () => {})
  const refreshLongMemoriesRef = useRef<() => void | Promise<void>>(async () => {})
  const abortTtsRef = useRef<() => void>(() => {})

  const setInput = useCallback((value: string) => setInputState(value), [])

  const coding = useCodingSession({
    settings,
    setSettings,
    imageVisionCache,
    setImageVisionCache,
    setSessions: (action) => setSessionsRef.current(action),
  })

  const tts = useTtsPlayback({
    settings,
    setError: (error) => setErrorRef.current(error),
  })
  onReadRef.current = tts.onRead
  abortTtsRef.current = tts.abortTts

  const attachments = useChatAttachments({
    busyRef,
    editingMessageIdRef,
    setError: (error) => setErrorRef.current(error),
  })

  const setSessionDirtyRef = useRef<(dirty: boolean) => void>(() => {})

  const agent = useChatAgent({
    settings,
    setSettings,
    effectivePdfOutputDir,
    hiddenContextSummary,
    setHiddenContextSummary,
    contextCompressedThroughIndex,
    setContextCompressedThroughIndex,
    imageVisionCache,
    setImageVisionCache,
    codingContextMemo: coding.codingContextMemo,
    activeSessionId: activeSessionIdRef.current,
    onContextCompressed: ({ summary, throughIndex, activeSessionId: sessionId }) => {
      if (!sessionId) return
      setSessionsRef.current((prev) => {
        const updated = prev.map((s) =>
          s.id === sessionId
            ? {
                ...s,
                hiddenContextSummary: summary,
                contextCompressedThroughIndex: throughIndex,
                updatedAt: Date.now(),
              }
            : s,
        )
        scheduleSaveChatSessions({ sessions: updated, activeSessionId: sessionId })
        return updated
      })
    },
    pendingImages: attachments.pendingImages,
    setPendingImages: attachments.setPendingImages,
    pendingFiles: attachments.pendingFiles,
    setPendingFiles: attachments.setPendingFiles,
    input,
    setInput,
    onRead: (msg) => onReadRef.current(msg),
    ttsOk: tts.ttsOk,
    refreshReminders: () => refreshRemindersRef.current(),
    refreshLongMemories: () => refreshLongMemoriesRef.current(),
    activeSessionUseLongMemory: settings.longMemoryDefaultEnabled,
    setCodingContextMemo: coding.setCodingContextMemo,
    setCodingTerminalFeed: coding.setCodingTerminalFeed,
    setCodingFileTreeNonce: coding.setCodingFileTreeNonce,
    setCodingGitNonce: coding.setCodingGitNonce,
    onSessionDirty: () => setSessionDirtyRef.current(true),
  })

  setErrorRef.current = agent.setError
  busyRef.current = agent.busy
  editingMessageIdRef.current = agent.editingMessageId

  const sessions = useChatSessions({
    settings,
    setSettings,
    messages: agent.messages,
    setMessages: agent.setMessages,
    codingContextMemo: coding.codingContextMemo,
    setCodingContextMemo: coding.setCodingContextMemo,
    imageVisionCache,
    setImageVisionCache,
    codingProjectPathForMemoRef: coding.codingProjectPathForMemoRef,
    contextOverflowLatchRef: agent.contextOverflowLatchRef,
    resetAssistantMediaState: agent.resetAssistantMediaState,
    restoreCodingContextForSession: coding.restoreCodingContextForSession,
    resetCodingTerminal: coding.resetCodingTerminal,
    abortActiveRuns: () => {
      agent.onStop()
      abortTtsRef.current()
    },
    cancelMessageEdit: agent.cancelEdit,
    setInput: setInputState,
    setPendingImages: attachments.setPendingImages,
    setError: agent.setError,
    setToolResultBanner: agent.setToolResultBanner,
    setContextUsageInfo: agent.setContextUsageInfo,
    setContextWarnDismissed: agent.setContextWarnDismissed,
    busy: agent.busy,
    hiddenContextSummary,
    setHiddenContextSummary,
    contextCompressedThroughIndex,
    setContextCompressedThroughIndex,
  })

  sessionsRef.current = sessions.sessions
  setSessionsRef.current = sessions.setSessions
  activeSessionIdRef.current = sessions.activeSessionId
  setSessionDirtyRef.current = sessions.setSessionDirty

  const stt = useSttInput({
    settings,
    busy: agent.busy,
    setInput: setInputState,
    setError: agent.setError,
  })

  const longMemory = useLongMemoryUi({
    settings,
    messages: agent.messages,
    busy: agent.busy,
    activeSessionId: sessions.activeSessionId,
    setError: agent.setError,
    setHostPdfOutputDir,
    setScreen,
    setOptionsTab,
    screen,
    optionsTab,
  })
  refreshRemindersRef.current = longMemory.refreshReminders
  refreshLongMemoriesRef.current = longMemory.refreshLongMemories

  const loadOllamaModels = useCallback(async () => {
    setModelsError(null)
    setModelsLoading(true)
    try {
      const names = await fetchOllamaModels(settings.ollamaBaseUrl)
      setOllamaModels(names)
    } catch (e) {
      setModelsError(e instanceof Error ? e.message : String(e))
      setOllamaModels([])
    } finally {
      setModelsLoading(false)
    }
  }, [settings.ollamaBaseUrl])

  useEffect(() => {
    void loadOllamaModels()
  }, [loadOllamaModels])

  useEffect(() => {
    if (screen === 'options' && (optionsTab === 'llm' || optionsTab === 'subAgent')) {
      void loadOllamaModels()
    }
  }, [screen, optionsTab, loadOllamaModels])

  const openOptions = useCallback((tab: OptionsTab = 'general') => {
    setOptionsTab(tab)
    setScreen('options')
  }, [])

  useEffect(() => {
    const preventDefault = (e: Event) => {
      const types = (e as globalThis.DragEvent).dataTransfer?.types
      if (!types) return
      for (let i = 0; i < types.length; i++) {
        if (types[i] === 'Files') {
          e.preventDefault()
          return
        }
      }
    }
    window.addEventListener('dragover', preventDefault)
    window.addEventListener('drop', preventDefault)
    return () => {
      window.removeEventListener('dragover', preventDefault)
      window.removeEventListener('drop', preventDefault)
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (screen === 'options') setScreen('chat')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [screen])

  const handleDeleteReminder = useCallback(
    async (id: string) => {
      await deleteReminder(id)
      recordReminderDeleted(id)
      scheduleUserDataSync(settings.ttsBaseUrl)
      await longMemory.refreshReminders()
    },
    [longMemory.refreshReminders, settings.ttsBaseUrl],
  )

  const handleMarkDoneReminder = useCallback(
    async (id: string) => {
      await markReminderDone(id)
      scheduleUserDataSync(settings.ttsBaseUrl)
      await longMemory.refreshReminders()
    },
    [longMemory.refreshReminders, settings.ttsBaseUrl],
  )

  return {
    settings,
    setSettings,
    effectivePdfOutputDir,
    appVersion,
    screen,
    setScreen,
    optionsTab,
    setOptionsTab,
    input,
    ollamaModels,
    modelsLoading,
    modelsError,
    loadModels: loadOllamaModels,
    openOptions,
    ...coding,
    ...agent,
    ...sessions,
    ...tts,
    ...attachments,
    ...stt,
    ...longMemory,
    setInput: setInputState,
    handleDeleteReminder,
    handleMarkDoneReminder,
    sessionsSidebarCollapsed,
    setSessionsSidebarCollapsed,
  }
}

export type VoidcastApp = ReturnType<typeof useVoidcastApp>
