import { useCallback, useEffect, useState } from 'react'
import { extractLongMemoryCandidates } from '@/lib/longMemoryExtract'
import {
  dedupeMemories,
  deleteMemory,
  listMemories,
  updateMemoryText,
  upsertMemories,
} from '@/lib/longMemoryStorage'
import type { AppSettings } from '@/lib/settings'
import { applyScopedModelToSettings, currentPinnedModelId } from '@/lib/pinnedModels'
import { toConversationTurns } from '@/lib/chatHints'
import type { UiMessage } from '@/types/chat'
import type { LongMemoryCandidate, LongMemoryItem } from '@/types/longMemory'
import type { OptionsTab, Screen } from '@/types/voidcast'

export type UseLongMemoryUiParams = {
  settings: AppSettings
  messages: UiMessage[]
  busy: boolean
  activeSessionId: string | null
  /** Model picked for the chat on screen (scoped id); empty = the app default. */
  activeModelId: string
  setError: (error: string | null) => void
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
  extractLongMemoryNow: () => Promise<void>
  confirmSaveLongMemory: () => Promise<void>
  refreshLongMemories: () => Promise<void>
  deleteLongMemoryById: (id: string) => Promise<void>
  updateLongMemoryById: (id: string, text: string) => Promise<void>
}

export function useLongMemoryUi({
  settings,
  messages,
  busy,
  activeSessionId,
  activeModelId,
  setError,
  screen,
  optionsTab,
}: UseLongMemoryUiParams): UseLongMemoryUiResult {
  const [longMemoryBusy, setLongMemoryBusy] = useState(false)
  const [memoryCandidates, setMemoryCandidates] = useState<LongMemoryCandidate[]>([])
  const [memoryPreviewOpen, setMemoryPreviewOpen] = useState(false)
  const [longMemories, setLongMemories] = useState<LongMemoryItem[]>([])

  const extractLongMemoryNow = useCallback(async () => {
    if (busy || longMemoryBusy) return
    const turns = toConversationTurns(messages)
    if (turns.length === 0) return
    // The chat's own model, as its turns use: a chat on a local model must not have its
    // history sent to the app-default cloud model.
    const chat = applyScopedModelToSettings(
      settings,
      activeModelId.trim() || currentPinnedModelId(settings),
    )
    setLongMemoryBusy(true)
    setError(null)
    try {
      const candidates = await extractLongMemoryCandidates({
        provider: chat.llmProvider,
        ollamaBaseUrl: chat.ollamaBaseUrl,
        ollamaModel: chat.ollamaModel,
        openrouterBaseUrl: chat.openrouterBaseUrl,
        openrouterApiKey: chat.openrouterApiKey,
        openrouterModel: chat.openrouterModel,
        openrouterProviderOnly: chat.openrouterProviderOnly,
        nvidiaBaseUrl: chat.nvidiaBaseUrl,
        nvidiaApiKey: chat.nvidiaApiKey,
        nvidiaModel: chat.nvidiaModel,
        deepseekBaseUrl: chat.deepseekBaseUrl,
        deepseekApiKey: chat.deepseekApiKey,
        deepseekModel: chat.deepseekModel,
        customBaseUrl: chat.customBaseUrl,
        customApiKey: chat.customApiKey,
        customModel: chat.customModel,
        customApiStyle: chat.customApiStyle,
        ttsBaseUrl: chat.ttsBaseUrl,
        opencodeGoBaseUrl: chat.opencodeGoBaseUrl,
        opencodeGoApiKey: chat.opencodeGoApiKey,
        opencodeGoModel: chat.opencodeGoModel,
        opencodeSessionId: activeSessionId || 'voidcast-draft',
        modelOptions: {
          temperature: chat.llmTemperature,
          num_ctx: chat.llmNumCtx,
        },
        turns,
        // Most recently updated first; the extractor caps what it actually sends.
        existingMemories: (await listMemories(60)).map((m) => m.text),
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
  }, [activeModelId, activeSessionId, busy, longMemoryBusy, messages, setError, settings])

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
      setLongMemories(await listMemories(100))
      setMemoryPreviewOpen(false)
      setMemoryCandidates([])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLongMemoryBusy(false)
    }
  }, [activeSessionId, memoryCandidates, setError])

  const refreshLongMemories = useCallback(async () => {
    try {
      setLongMemories(await listMemories(100))
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    void refreshLongMemories()
  }, [refreshLongMemories])

  const deleteLongMemoryById = useCallback(
    async (id: string) => {
      await deleteMemory(id)
      await refreshLongMemories()
    },
    [refreshLongMemories],
  )

  const updateLongMemoryById = useCallback(
    async (id: string, text: string) => {
      await updateMemoryText(id, text)
      await refreshLongMemories()
    },
    [refreshLongMemories],
  )

  useEffect(() => {
    if (screen === 'options' && optionsTab === 'general') {
      void refreshLongMemories()
    }
  }, [optionsTab, screen, refreshLongMemories])

  return {
    longMemoryBusy,
    memoryCandidates,
    memoryPreviewOpen,
    setMemoryPreviewOpen,
    setMemoryCandidates,
    longMemories,
    extractLongMemoryNow,
    confirmSaveLongMemory,
    refreshLongMemories,
    deleteLongMemoryById,
    updateLongMemoryById,
  }
}
