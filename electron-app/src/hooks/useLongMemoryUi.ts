import { useCallback, useEffect, useState } from 'react'
import { extractLongMemoryCandidates } from '@/lib/longMemoryExtract'
import { detectSubAgentProvider } from '@/lib/subAgent'
import {
  dedupeMemories,
  deleteMemory,
  listMemories,
  updateMemoryText,
  upsertMemories,
} from '@/lib/longMemoryStorage'
import {
  listDueUnnotifiedReminders,
  listReminders,
  markReminderNotified,
  type Reminder,
} from '@/lib/reminderStorage'
import { fetchHostToolConfig } from '@/lib/hostToolConfig'
import {
  recordMemoryDeleted,
  scheduleUserDataSync,
  syncUserDataNow,
} from '@/lib/userDataSync'
import { isWebStandalone } from '@/lib/platform'
import type { AppSettings } from '@/lib/settings'
import { toConversationTurns } from '@/lib/chatHints'
import type { UiMessage } from '@/types/chat'
import type { LongMemoryCandidate, LongMemoryItem } from '@/types/longMemory'
import type { OptionsTab, Screen } from '@/types/voidcast'

export type UseLongMemoryUiParams = {
  settings: AppSettings
  messages: UiMessage[]
  busy: boolean
  activeSessionId: string | null
  setError: (error: string | null) => void
  setHostPdfOutputDir: (dir: string) => void
  setScreen: (screen: Screen) => void
  setOptionsTab: (tab: OptionsTab) => void
  screen: Screen
  optionsTab: OptionsTab
}

export type UseLongMemoryUiResult = {
  longMemoryBusy: boolean
  memoryCandidates: LongMemoryCandidate[]
  memoryPreviewOpen: boolean
  setMemoryPreviewOpen: React.Dispatch<React.SetStateAction<boolean>>
  setMemoryCandidates: React.Dispatch<React.SetStateAction<LongMemoryCandidate[]>>
  longMemories: LongMemoryItem[]
  reminders: Reminder[]
  extractLongMemoryNow: () => Promise<void>
  confirmSaveLongMemory: () => Promise<void>
  refreshLongMemories: () => Promise<void>
  refreshReminders: () => Promise<void>
  syncUserDataAndRefresh: () => Promise<void>
  deleteLongMemoryById: (id: string) => Promise<void>
  updateLongMemoryById: (id: string, text: string) => Promise<void>
}

export function useLongMemoryUi({
  settings,
  messages,
  busy,
  activeSessionId,
  setError,
  setHostPdfOutputDir,
  setScreen,
  setOptionsTab,
  screen,
  optionsTab,
}: UseLongMemoryUiParams): UseLongMemoryUiResult {
  const [longMemoryBusy, setLongMemoryBusy] = useState(false)
  const [memoryCandidates, setMemoryCandidates] = useState<LongMemoryCandidate[]>([])
  const [memoryPreviewOpen, setMemoryPreviewOpen] = useState(false)
  const [longMemories, setLongMemories] = useState<LongMemoryItem[]>([])
  const [reminders, setReminders] = useState<Reminder[]>([])

  const extractLongMemoryNow = useCallback(async () => {
    if (busy || longMemoryBusy) return
    const turns = toConversationTurns(messages)
    if (turns.length === 0) return
    setLongMemoryBusy(true)
    setError(null)
    try {
      const useSub = settings.subAgent.enabled
      const subModel = settings.subAgent.model
      const subProvider = detectSubAgentProvider(subModel)
      const memLlmProvider = useSub
        ? subProvider === 'ollama'
          ? 'ollama'
          : subProvider === 'deepseek'
            ? 'deepseek'
            : 'openrouter'
        : settings.llmProvider
      const candidates = await extractLongMemoryCandidates({
        provider: memLlmProvider,
        ollamaBaseUrl: settings.ollamaBaseUrl,
        ollamaModel: useSub && subProvider === 'ollama' ? subModel : settings.ollamaModel,
        openrouterBaseUrl: settings.openrouterBaseUrl,
        openrouterApiKey: settings.openrouterApiKey,
        openrouterModel: settings.openrouterModel,
        nvidiaBaseUrl: settings.nvidiaBaseUrl,
        nvidiaApiKey: settings.nvidiaApiKey,
        nvidiaModel: settings.nvidiaModel,
        deepseekBaseUrl: settings.deepseekBaseUrl,
        deepseekApiKey: settings.deepseekApiKey,
        deepseekModel: settings.deepseekModel,
        cloudModelOverride: useSub && subProvider !== 'ollama' ? subModel : undefined,
        modelOptions: {
          temperature: settings.llmTemperature,
          num_ctx: useSub ? (settings.subAgent.contextTokens ?? 8192) : settings.llmNumCtx,
        },
        turns,
      })
      if (candidates.length === 0) {
        setError('No stable long-memory items found in this chat.')
        return
      }
      setMemoryCandidates(candidates)
      setMemoryPreviewOpen(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLongMemoryBusy(false)
    }
  }, [busy, longMemoryBusy, messages, settings.subAgent, settings.llmProvider, settings, setError])

  const confirmSaveLongMemory = useCallback(async () => {
    if (!memoryCandidates.length) {
      setMemoryPreviewOpen(false)
      return
    }
    setLongMemoryBusy(true)
    setError(null)
    try {
      await upsertMemories(memoryCandidates, activeSessionId ?? 'draft')
      await dedupeMemories()
      scheduleUserDataSync(settings.ttsBaseUrl)
      setLongMemories(await listMemories(100))
      setMemoryPreviewOpen(false)
      setMemoryCandidates([])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLongMemoryBusy(false)
    }
  }, [activeSessionId, memoryCandidates, setError, settings.ttsBaseUrl])

  const refreshLongMemories = useCallback(async () => {
    try {
      setLongMemories(await listMemories(100))
    } catch {
      // ignore
    }
  }, [])

  const refreshReminders = useCallback(async () => {
    try {
      setReminders(await listReminders())
    } catch {
      // ignore
    }
  }, [])

  const syncUserDataAndRefresh = useCallback(async () => {
    await syncUserDataNow(settings.ttsBaseUrl)
    if (isWebStandalone()) {
      setHostPdfOutputDir(await fetchHostToolConfig(settings.ttsBaseUrl))
    }
    await refreshLongMemories()
    await refreshReminders()
  }, [settings.ttsBaseUrl, refreshLongMemories, refreshReminders, setHostPdfOutputDir])

  useEffect(() => {
    void syncUserDataAndRefresh()
    const heartbeat = window.setInterval(() => scheduleUserDataSync(settings.ttsBaseUrl), 30_000)
    return () => window.clearInterval(heartbeat)
  }, [settings.ttsBaseUrl, syncUserDataAndRefresh])

  useEffect(() => {
    if (!settings.reminderNotificationsEnabled) return
    if (typeof window === 'undefined' || typeof Notification === 'undefined') return

    let cancelled = false
    let timer: number | null = null

    const tick = async () => {
      if (cancelled) return
      if (Notification.permission !== 'granted') return
      try {
        const due = await listDueUnnotifiedReminders(Date.now())
        if (cancelled || due.length === 0) return
        let firedAny = false
        for (const r of due) {
          try {
            const n = new Notification('VOIDCAST reminder', {
              body: r.text,
              tag: r.id,
              requireInteraction: false,
            })
            n.onclick = () => {
              try {
                window.focus()
                setScreen('options')
                setOptionsTab('general')
              } catch {
                // ignore focus errors
              }
              n.close()
            }
            const notifiedTs = Date.now()
            await markReminderNotified(r.id, notifiedTs)
            scheduleUserDataSync(settings.ttsBaseUrl)
            firedAny = true
          } catch {
            // single failure shouldn't block other reminders
          }
        }
        if (firedAny) {
          void refreshReminders()
        }
      } catch {
        // ignore tick errors
      }
    }

    void tick()
    timer = window.setInterval(() => void tick(), 30_000)
    return () => {
      cancelled = true
      if (timer != null) window.clearInterval(timer)
    }
  }, [settings.reminderNotificationsEnabled, settings.ttsBaseUrl, refreshReminders, setOptionsTab, setScreen])

  const deleteLongMemoryById = useCallback(async (id: string) => {
    await deleteMemory(id)
    recordMemoryDeleted(id)
    scheduleUserDataSync(settings.ttsBaseUrl)
    await refreshLongMemories()
  }, [refreshLongMemories, settings.ttsBaseUrl])

  const updateLongMemoryById = useCallback(async (id: string, text: string) => {
    await updateMemoryText(id, text)
    scheduleUserDataSync(settings.ttsBaseUrl)
    await refreshLongMemories()
  }, [refreshLongMemories, settings.ttsBaseUrl])

  useEffect(() => {
    if (screen === 'options' && optionsTab === 'general') {
      void syncUserDataAndRefresh()
    }
  }, [optionsTab, screen, syncUserDataAndRefresh])

  return {
    longMemoryBusy,
    memoryCandidates,
    memoryPreviewOpen,
    setMemoryPreviewOpen,
    setMemoryCandidates,
    longMemories,
    reminders,
    extractLongMemoryNow,
    confirmSaveLongMemory,
    refreshLongMemories,
    refreshReminders,
    syncUserDataAndRefresh,
    deleteLongMemoryById,
    updateLongMemoryById,
  }
}
