import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react'
import { buildAgentTurnContext } from '@/lib/buildAgentTurnContext'
import { uid } from '@/lib/chatUid'
import type { PendingChatImage } from '@/lib/chatImageCatalog'
import { applyAgentToolResult, type AgentToolResultPayload } from '@/lib/applyAgentToolResult'
import { compressConversationContext } from '@/lib/contextCompress'
import {
  CONTEXT_COMPRESS_RATIO_RESET,
  estimateContextUsage,
} from '@/lib/contextUsage'
import { resolveContextLimit } from '@/lib/contextLimit'
import type { CodingContextMemo, CodingFileCache } from '@/lib/codingContextMemo'
import {
  buildCodingTurnSummary,
  buildPlanHandoffContextHint,
  buildPlanHandoffUiDraftContent,
  emptyCodingFileCache,
  emptyCodingTurnLog,
  recordCodingToolInTurnLog,
} from '@/lib/codingContextMemo'
import type { ActiveCodingProcess } from '@/lib/codingActiveProcesses'
import { mergeImageVisionCache, type ImageVisionCache } from '@/lib/imageVisionCache'
import { cancelActiveMcpCalls } from '@/lib/mcpTools'
import { touchMemoryUsage } from '@/lib/longMemoryStorage'
import { runOllamaChatWithTools } from '@/lib/ollamaAgent'
import {
  applyPlanProgressUpdate,
  attachResearchToPlan,
  emptyPlanResearchHarvest,
  extractPlanArtifactFromReply,
  finalizePlanAfterBuild,
  formatPlanForBuildPrompt,
  formatPlanForRevisePrompt,
  harvestPlanToolIntoBuffer,
  planHasResearch,
  reopenPlanAsDraft,
  stripPlanJsonFenceFromContent,
  type PlanResearchHarvest,
} from '@/lib/planArtifact'
import { anyToolEnabled } from '@/lib/toolDefinitions'
import { type AgentToolUiPhase } from '@/lib/agentToolPhase'
import { streamOllamaChat, isThinkingUiEnabled } from '@/lib/ollama'
import { runOpenRouterChatWithTools } from '@/lib/openrouterAgent'
import { resolveCloudLlmChatConfig } from '@/lib/cloudLlm'
import { ollamaMessagesToOpenRouter, streamOpenRouterChat } from '@/lib/openrouter'
import { playNotificationSound } from '@/lib/notificationSounds'
import {
  getOpenRouterImageProfile,
  loadSettings,
  type AppSettings,
} from '@/lib/settings'
import type { SubAgentUiCallbacks } from '@/lib/subAgent'
import { toConversationTurns } from '@/lib/chatHints'
import {
  DRAFT_RUNTIME_KEY,
  isRealSessionRuntimeKey,
  sessionAgentStore,
  useSessionAgentSlot,
  type SessionAgentKeyHandle,
} from '@/lib/sessionAgentStore'
import type {
  AgentChatMode,
  FileAttachmentSnapshot,
  PlanArtifact,
  SystemPromptPreset,
  UiMessage,
} from '@/types/chat'
import type { TerminalLine } from '@/types/coding'

export type UseChatAgentDeps = {
  settings: AppSettings
  setSettings: Dispatch<SetStateAction<AppSettings>>
  effectivePdfOutputDir: string

  /**
   * Runtime key for the visible chat: session id or DRAFT_RUNTIME_KEY.
   * Agent runs bind to a mutable handle so draft → session rekey mid-run works.
   */
  runtimeKey: string
  /** Latest runtime key (view) — used to gate coding-panel side effects while backgrounded. */
  runtimeKeyRef: MutableRefObject<string>

  hiddenContextSummary: string
  setHiddenContextSummary: (summary: string) => void
  contextCompressedThroughIndex: number
  setContextCompressedThroughIndex: (index: number) => void
  imageVisionCache: ImageVisionCache
  setImageVisionCache: Dispatch<SetStateAction<ImageVisionCache>>
  codingContextMemo: CodingContextMemo
  codingContextMemoRef: MutableRefObject<CodingContextMemo>
  codingFileCacheRef: React.MutableRefObject<CodingFileCache>
  /** Live per-chat preset — read at send time so the current session wins. */
  systemPromptPresetRef: MutableRefObject<SystemPromptPreset>
  onContextCompressed?: (params: {
    summary: string
    throughIndex: number
    activeSessionId: string | null
  }) => void
  /**
   * Persist coding memo for a non-visible session (background agent).
   * Visible session still uses setCodingContextMemo.
   */
  patchSessionCodingMemo?: (
    sessionId: string,
    action: SetStateAction<CodingContextMemo>,
  ) => void
  /**
   * Auto-save: allocate a session id for the draft and rekey the runtime before
   * the first message turns into a mid-run draft → id transition race.
   */
  claimSessionIdForDraft?: () => string | null

  pendingImages: PendingChatImage[]
  setPendingImages: Dispatch<SetStateAction<PendingChatImage[]>>
  pendingFiles: FileAttachmentSnapshot[]
  setPendingFiles: Dispatch<SetStateAction<FileAttachmentSnapshot[]>>
  input: string
  setInput: (value: string) => void

  onRead: (msg: UiMessage) => Promise<void>
  ttsOk: boolean | null

  refreshReminders: () => void | Promise<void>
  refreshLongMemories: () => void | Promise<void>
  activeSessionUseLongMemory: boolean

  setCodingContextMemo: Dispatch<SetStateAction<CodingContextMemo>>
  setCodingTerminalFeed: Dispatch<SetStateAction<TerminalLine[]>>
  setCodingFileTreeNonce: Dispatch<SetStateAction<number>>
  setCodingGitNonce: Dispatch<SetStateAction<number>>
  revealCodingFile: (path: string) => void
  activeCodingProcesses: ActiveCodingProcess[]

  onSessionDirty: () => void
}

export type OnSendOptions = {
  text?: string
  /** Short user-bubble label shown instead of `text` (build prompt stays internal). */
  displayText?: string
  history?: UiMessage[]
  skipAddUserMsg?: boolean
  /** Override settings.agentMode for this turn (Approve → Build uses 'agent'). */
  forceAgentMode?: AgentChatMode
  /** After a successful build turn, mark this plan message as built. */
  buildFromPlanMessageId?: string
  /** enter_plan_mode handoff: reuse attachments from the last user message in history. */
  planHandoff?: boolean
  /** Prior agent-turn exploration text injected into the Plan turn system/tools hint. */
  planHandoffContext?: string
  /**
   * Agent-mode reply kept on screen when escalating to Plan.
   * UI only — not included in the Plan turn's LLM history.
   */
  planHandoffUiDraft?: UiMessage
}

function lastUserMessage(history: UiMessage[]): UiMessage | undefined {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (history[i]?.role === 'user') return history[i]
  }
  return undefined
}

function attachmentsFromUserMessage(msg: UiMessage): {
  queued: PendingChatImage[]
  queuedFiles: FileAttachmentSnapshot[]
} {
  const queued: PendingChatImage[] = []
  if (msg.images?.length) {
    msg.images.forEach((base64, i) => {
      queued.push({
        base64,
        mime: msg.imageMimes?.[i] || 'image/jpeg',
        name: msg.imageNames?.[i] || '',
        path: msg.imagePaths?.[i] || '',
        kind: 'attachment',
      })
    })
  }
  return {
    queued,
    queuedFiles: msg.fileAttachments ?? [],
  }
}

function sessionIdFromRuntimeKey(key: string): string | null {
  return isRealSessionRuntimeKey(key) ? key : null
}

function resolveAction<T>(prev: T, action: SetStateAction<T>): T {
  return typeof action === 'function' ? (action as (p: T) => T)(prev) : action
}

export function useChatAgent(deps: UseChatAgentDeps) {
  const {
    settings,
    setSettings,
    effectivePdfOutputDir,
    runtimeKey,
    runtimeKeyRef,
    hiddenContextSummary,
    setHiddenContextSummary,
    contextCompressedThroughIndex,
    setContextCompressedThroughIndex,
    imageVisionCache,
    setImageVisionCache,
    codingContextMemo,
    codingContextMemoRef,
    codingFileCacheRef,
    systemPromptPresetRef,
    onContextCompressed,
    patchSessionCodingMemo,
    claimSessionIdForDraft,
    pendingImages,
    setPendingImages,
    pendingFiles,
    setPendingFiles,
    input,
    setInput,
    onRead,
    ttsOk,
    refreshReminders,
    refreshLongMemories,
    activeSessionUseLongMemory,
    setCodingContextMemo,
    setCodingTerminalFeed,
    setCodingFileTreeNonce,
    setCodingGitNonce,
    revealCodingFile,
    activeCodingProcesses,
    onSessionDirty,
  } = deps

  const slot = useSessionAgentSlot(runtimeKey)

  const setMessages = useCallback<Dispatch<SetStateAction<UiMessage[]>>>(
    (action) => sessionAgentStore.setMessages(runtimeKey, action),
    [runtimeKey],
  )
  const setBusy = useCallback(
    (busy: boolean) => sessionAgentStore.update(runtimeKey, { busy }),
    [runtimeKey],
  )
  const setError = useCallback<Dispatch<SetStateAction<string | null>>>(
    (action) => {
      const prev = sessionAgentStore.getSnapshot(runtimeKey).error
      const error = resolveAction(prev, action)
      sessionAgentStore.update(runtimeKey, { error })
    },
    [runtimeKey],
  )
  const setToolPhase = useCallback(
    (toolPhase: AgentToolUiPhase | null) =>
      sessionAgentStore.update(runtimeKey, { toolPhase }),
    [runtimeKey],
  )
  const setContextUsageInfo = useCallback<
    Dispatch<SetStateAction<(typeof slot)['contextUsageInfo']>>
  >(
    (action) => {
      const prev = sessionAgentStore.getSnapshot(runtimeKey).contextUsageInfo
      sessionAgentStore.update(runtimeKey, {
        contextUsageInfo: resolveAction(prev, action),
      })
    },
    [runtimeKey],
  )
  const setContextWarnDismissed = useCallback<Dispatch<SetStateAction<boolean>>>(
    (action) => {
      const prev = sessionAgentStore.getSnapshot(runtimeKey).contextWarnDismissed
      sessionAgentStore.update(runtimeKey, {
        contextWarnDismissed: resolveAction(prev, action),
      })
    },
    [runtimeKey],
  )
  const setContextCompressBusy = useCallback(
    (contextCompressBusy: boolean) =>
      sessionAgentStore.update(runtimeKey, { contextCompressBusy }),
    [runtimeKey],
  )
  const setToolResultBanner = useCallback<
    Dispatch<SetStateAction<(typeof slot)['toolResultBanner']>>
  >(
    (action) => {
      const prev = sessionAgentStore.getSnapshot(runtimeKey).toolResultBanner
      sessionAgentStore.update(runtimeKey, {
        toolResultBanner: resolveAction(prev, action),
      })
    },
    [runtimeKey],
  )
  const setSubAgentPanelOpen = useCallback(
    (subAgentPanelOpen: boolean) =>
      sessionAgentStore.update(runtimeKey, { subAgentPanelOpen }),
    [runtimeKey],
  )
  const setSubAgentPanelBusy = useCallback(
    (subAgentPanelBusy: boolean) =>
      sessionAgentStore.update(runtimeKey, { subAgentPanelBusy }),
    [runtimeKey],
  )
  const setSubAgentPanelText = useCallback(
    (subAgentPanelText: string) =>
      sessionAgentStore.update(runtimeKey, { subAgentPanelText }),
    [runtimeKey],
  )

  const mediaView = sessionAgentStore.mediaSetters(runtimeKey)

  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [editInputValue, setEditInputValue] = useState('')
  const editingHistoryRef = useRef<UiMessage[] | null>(null)

  // Compat refs for session switch path (overflow latch lives on the slot).
  const contextOverflowLatchRef = useRef(false)
  contextOverflowLatchRef.current = slot.contextOverflowLatch
  const abortRef = useRef<AbortController | null>(null)
  abortRef.current = slot.abortController
  const activeChatRunIdRef = useRef(0)
  activeChatRunIdRef.current = slot.runId

  const resetAssistantMediaState = useCallback(() => {
    sessionAgentStore.resetMedia(runtimeKey)
  }, [runtimeKey])

  const resetContextUsage = useCallback(() => {
    sessionAgentStore.update(runtimeKey, {
      contextUsageInfo: null,
      contextWarnDismissed: false,
      contextOverflowLatch: false,
    })
  }, [runtimeKey])

  const {
    messages,
    busy,
    error,
    toolPhase,
    contextUsageInfo,
    contextWarnDismissed,
    contextCompressBusy,
    subAgentPanelOpen,
    subAgentPanelBusy,
    subAgentPanelText,
    toolResultBanner,
    media,
  } = slot

  const summarizeContextNow = useCallback(async () => {
    if (busy || contextCompressBusy) return
    const turns = toConversationTurns(messages)
    if (turns.length === 0) return

    setContextCompressBusy(true)
    setError(null)
    try {
      const compressed = await compressConversationContext({
        provider: settings.llmProvider,
        ollamaBaseUrl: settings.ollamaBaseUrl,
        ollamaModel: settings.ollamaModel,
        openrouterBaseUrl: settings.openrouterBaseUrl,
        openrouterApiKey: settings.openrouterApiKey,
        openrouterModel: settings.openrouterModel,
        openrouterProviderOnly: settings.openrouterProviderOnly,
        nvidiaBaseUrl: settings.nvidiaBaseUrl,
        nvidiaApiKey: settings.nvidiaApiKey,
        nvidiaModel: settings.nvidiaModel,
        deepseekBaseUrl: settings.deepseekBaseUrl,
        deepseekApiKey: settings.deepseekApiKey,
        deepseekModel: settings.deepseekModel,
        openaiBaseUrl: settings.openaiBaseUrl,
        openaiApiKey: settings.openaiApiKey,
        openaiModel: settings.openaiModel,
        turns,
        existingSummary: hiddenContextSummary,
        modelOptions: { temperature: settings.llmTemperature, num_ctx: settings.llmNumCtx },
      })
      const nextSummary = compressed.trim()
      if (!nextSummary) return
      const throughIndex = messages.length
      setHiddenContextSummary(nextSummary)
      setContextCompressedThroughIndex(throughIndex)
      setContextWarnDismissed(true)
      onContextCompressed?.({
        summary: nextSummary,
        throughIndex,
        activeSessionId: sessionIdFromRuntimeKey(runtimeKey),
      })
    } catch (e) {
      sessionAgentStore.update(runtimeKey, { contextOverflowLatch: false })
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setContextCompressBusy(false)
    }
  }, [
    busy,
    contextCompressBusy,
    hiddenContextSummary,
    messages,
    onContextCompressed,
    runtimeKey,
    setContextCompressedThroughIndex,
    setContextCompressBusy,
    setContextWarnDismissed,
    setError,
    setHiddenContextSummary,
    settings,
  ])

  useEffect(() => {
    if (!contextUsageInfo) return
    if (contextUsageInfo.ratio < CONTEXT_COMPRESS_RATIO_RESET) {
      // Only clear when set — a no-op write + emit freezes React (infinite loop).
      if (slot.contextOverflowLatch) {
        sessionAgentStore.update(runtimeKey, { contextOverflowLatch: false })
      }
      return
    }
    if (!contextUsageInfo.shouldCompress) return
    if (!settings.contextAutoCompress) return
    if (busy || contextCompressBusy || slot.contextOverflowLatch) return
    if (messages.length < 4) return

    sessionAgentStore.update(runtimeKey, { contextOverflowLatch: true })
    void summarizeContextNow()
  }, [
    busy,
    contextCompressBusy,
    contextUsageInfo,
    messages.length,
    runtimeKey,
    settings.contextAutoCompress,
    slot.contextOverflowLatch,
    summarizeContextNow,
  ])

  const subAgentUi = useMemo<SubAgentUiCallbacks>(
    () => ({
      onStart: (imageCount) => {
        setSubAgentPanelOpen(true)
        setSubAgentPanelBusy(true)
        setSubAgentPanelText(`SUB_AGENT: analyzing ${imageCount} image(s)…`)
      },
      onProgress: (current, total) => {
        setSubAgentPanelText(`SUB_AGENT: image ${current}/${total}…`)
      },
      onDone: (formatted) => {
        setSubAgentPanelBusy(false)
        setSubAgentPanelText(formatted || '[Sub-agent returned no descriptions.]')
      },
      onCodingStart: (label) => {
        setSubAgentPanelOpen(true)
        setSubAgentPanelBusy(true)
        setSubAgentPanelText(label)
      },
      onCodingDone: (formatted) => {
        setSubAgentPanelBusy(false)
        setSubAgentPanelText(formatted || '[Sub-agent returned no digest.]')
      },
    }),
    [setSubAgentPanelBusy, setSubAgentPanelOpen, setSubAgentPanelText],
  )

  const onSend = useCallback(
    async (opts?: OnSendOptions) => {
      // Prefer a real session id before the turn so stream/bind never races rekey.
      const claimedId = claimSessionIdForDraft?.()
      const startKey =
        claimedId && claimedId.trim()
          ? claimedId
          : runtimeKey

      const bind: SessionAgentKeyHandle = sessionAgentStore.createKeyHandle(startKey)
      if (claimedId && runtimeKey === DRAFT_RUNTIME_KEY) {
        // ensure handle points at rekeyed session
        bind.key = claimedId
      }
      const keyOf = () => bind.key
      const slotNow = () => sessionAgentStore.getSnapshot(keyOf())
      const setMsgs: Dispatch<SetStateAction<UiMessage[]>> = (action) =>
        sessionAgentStore.setMessages(keyOf(), action)
      const setPhase = (toolPhase: AgentToolUiPhase | null) =>
        sessionAgentStore.update(keyOf(), { toolPhase })
      const setErr = (error: string | null) => sessionAgentStore.update(keyOf(), { error })
      const setBanner: Dispatch<SetStateAction<(typeof slot)['toolResultBanner']>> = (
        action,
      ) => {
        const prev = slotNow().toolResultBanner
        sessionAgentStore.update(keyOf(), {
          toolResultBanner: resolveAction(prev, action),
        })
      }
      const setUsage: Dispatch<SetStateAction<(typeof slot)['contextUsageInfo']>> = (
        action,
      ) => {
        const prev = slotNow().contextUsageInfo
        sessionAgentStore.update(keyOf(), {
          contextUsageInfo: resolveAction(prev, action),
        })
      }
      const setWarnDismissed = (contextWarnDismissed: boolean) =>
        sessionAgentStore.update(keyOf(), { contextWarnDismissed })
      const mediaRun = sessionAgentStore.mediaSetters(bind)

      const runSubAgentUi: SubAgentUiCallbacks = {
        onStart: (imageCount) => {
          sessionAgentStore.update(keyOf(), {
            subAgentPanelOpen: true,
            subAgentPanelBusy: true,
            subAgentPanelText: `SUB_AGENT: analyzing ${imageCount} image(s)…`,
          })
        },
        onProgress: (current, total) => {
          sessionAgentStore.update(keyOf(), {
            subAgentPanelText: `SUB_AGENT: image ${current}/${total}…`,
          })
        },
        onDone: (formatted) => {
          sessionAgentStore.update(keyOf(), {
            subAgentPanelBusy: false,
            subAgentPanelText: formatted || '[Sub-agent returned no descriptions.]',
          })
        },
        onCodingStart: (label) => {
          sessionAgentStore.update(keyOf(), {
            subAgentPanelOpen: true,
            subAgentPanelBusy: true,
            subAgentPanelText: label,
          })
        },
        onCodingDone: (formatted) => {
          sessionAgentStore.update(keyOf(), {
            subAgentPanelBusy: false,
            subAgentPanelText: formatted || '[Sub-agent returned no digest.]',
          })
        },
      }

      const isViewingThisRun = () => keyOf() === runtimeKeyRef.current

      const isEdit = Boolean(opts?.skipAddUserMsg)
      const isPlanHandoff = Boolean(opts?.planHandoff)
      const activeHistory = opts?.history ?? slotNow().messages
      const text = isEdit
        ? (opts?.text ?? (isPlanHandoff ? lastUserMessage(activeHistory)?.content ?? '' : '')).trim()
        : (opts?.text ?? input).trim()
      let queued = isEdit || (opts?.text && !isPlanHandoff) ? [] : pendingImages
      let queuedFiles = isEdit || (opts?.text && !isPlanHandoff) ? [] : pendingFiles
      if (isPlanHandoff && isEdit) {
        const lastUser = lastUserMessage(activeHistory)
        if (lastUser) {
          const recovered = attachmentsFromUserMessage(lastUser)
          queued = recovered.queued
          queuedFiles = recovered.queuedFiles
        }
      }
      if ((!text && queued.length === 0 && queuedFiles.length === 0) || slotNow().busy) {
        sessionAgentStore.releaseKeyHandle(bind)
        return
      }
      setErr(null)
      if (!isEdit) {
        if (!opts?.text) {
          setPendingImages([])
          setPendingFiles([])
          setInput('')
        }
      }

      const imagesBase64 = queued.map((q) => q.base64)
      const imageMimes = queued.map((q) => q.mime)
      const imageNames = queued.map((q) => (q.name || '').trim())
      const imagePaths = queued.map((q) => (q.path || '').trim())

      const turnAgentMode: AgentChatMode =
        opts?.forceAgentMode === 'plan' || opts?.forceAgentMode === 'agent'
          ? opts.forceAgentMode
          : settings.agentMode === 'plan'
            ? 'plan'
            : 'agent'

      const turnSettings: AppSettings =
        turnAgentMode === settings.agentMode
          ? settings
          : { ...settings, agentMode: turnAgentMode }

      // Per-turn isolation so background runs do not share mutables with the active view.
      const turnFileCacheRef = { current: emptyCodingFileCache() }
      const turnMemoRef = { current: codingContextMemoRef.current }

      const applyCodingMemo: Dispatch<SetStateAction<CodingContextMemo>> = (action) => {
        turnMemoRef.current = resolveAction(turnMemoRef.current, action)
        if (isViewingThisRun()) {
          setCodingContextMemo(action)
          return
        }
        const sid = sessionIdFromRuntimeKey(keyOf())
        if (sid && patchSessionCodingMemo) {
          patchSessionCodingMemo(sid, action)
        }
      }

      const turnContext = await buildAgentTurnContext({
        settings: turnSettings,
        systemPromptPreset: systemPromptPresetRef.current,
        activeHistory,
        text,
        queued,
        queuedFiles,
        hiddenContextSummary,
        contextCompressedThroughIndex,
        imageVisionCache,
        codingContextMemo: turnMemoRef.current,
        activeCodingProcesses,
        activeSessionUseLongMemory,
        buildWithResearch: (() => {
          const planMsgId = opts?.buildFromPlanMessageId
          if (!planMsgId) return false
          const plan =
            slotNow().messages.find((m) => m.id === planMsgId)?.plan ??
            activeHistory.find((m) => m.id === planMsgId)?.plan
          return planHasResearch(plan)
        })(),
        planHandoffContext: opts?.planHandoffContext,
      })

      const {
        toolImageCatalog,
        history,
        retrievedLongMemory,
        activeRunwareProfile,
        activeRunwareEditProfile,
        activeRunwareMusicProfile,
        skillsActive,
        mcpActive,
        mcpTools,
      } = turnContext

      const openRouterImageProfile = getOpenRouterImageProfile(settings)
      const imageGptQuality =
        settings.imageProvider === 'openrouter'
          ? openRouterImageProfile.gptQuality
          : activeRunwareProfile.gptQuality
      const editGptQuality =
        settings.imageProvider === 'openrouter'
          ? openRouterImageProfile.gptQuality
          : activeRunwareEditProfile.gptQuality
      const imageWidth =
        settings.imageProvider === 'openrouter'
          ? openRouterImageProfile.width
          : activeRunwareProfile.width
      const imageHeight =
        settings.imageProvider === 'openrouter'
          ? openRouterImageProfile.height
          : activeRunwareProfile.height
      const editWidth =
        settings.imageProvider === 'openrouter'
          ? openRouterImageProfile.width
          : activeRunwareEditProfile.width
      const editHeight =
        settings.imageProvider === 'openrouter'
          ? openRouterImageProfile.height
          : activeRunwareEditProfile.height

      let userMsg: UiMessage | undefined
      if (!isEdit) {
        userMsg = {
          id: uid(),
          role: 'user',
          content: opts?.displayText ?? text,
          ...(imagesBase64.length > 0
            ? { images: imagesBase64, imageMimes, imageNames, imagePaths }
            : {}),
          ...(queuedFiles.length > 0
            ? {
                fileAttachments: queuedFiles.map((f) => ({
                  id: f.id,
                  name: f.name,
                  path: f.path,
                  mime: f.mime,
                  size: f.size,
                  ext: f.ext,
                  content: f.content,
                  truncated: f.truncated,
                })),
              }
            : {}),
        }
      }

      const asstId = uid()
      const { runId, controller: ac } = sessionAgentStore.beginRun(keyOf())
      const asstMsg: UiMessage = { id: asstId, role: 'assistant', content: '' }
      if (isEdit) {
        const handoffDraft =
          isPlanHandoff && opts?.planHandoffUiDraft?.content?.trim()
            ? [
                {
                  ...opts.planHandoffUiDraft,
                  content: opts.planHandoffUiDraft.content.trim(),
                  planHandoffDraft: true as const,
                },
              ]
            : []
        setMsgs(() => [...activeHistory, ...handoffDraft, asstMsg])
      } else {
        setMsgs((m) => [...m, userMsg!, asstMsg])
      }
      onSessionDirty()

      const useTools =
        anyToolEnabled(settings.toolsEnabled, skillsActive, mcpActive) ||
        settings.subAgent.enabled

      const isRunActive = () => sessionAgentStore.isRunActive(keyOf(), runId)
      let replyText = ''
      let usage: { prompt_eval_count?: number; eval_count?: number } | undefined
      let escalatedToPlan = false
      let liveBuildPlan: PlanArtifact | undefined =
        opts?.buildFromPlanMessageId
          ? slotNow().messages.find((m) => m.id === opts.buildFromPlanMessageId)?.plan ??
            activeHistory.find((m) => m.id === opts.buildFromPlanMessageId)?.plan
          : undefined
      const planResearchHarvest: PlanResearchHarvest = emptyPlanResearchHarvest()
      const harvestingPlanResearch = turnAgentMode === 'plan'
      let turnLogMutable = emptyCodingTurnLog()

      // Keep shared file-cache ref in sync when this run is the visible chat (tools that read it outside params).
      if (isViewingThisRun()) {
        codingFileCacheRef.current = turnFileCacheRef.current
      }

      try {
        if (useTools) {
          const commonToolParams = {
            initialMessages: history,
            rawUserText: text,
            modelOptions: { temperature: settings.llmTemperature, num_ctx: settings.llmNumCtx },
            toolsEnabled: settings.toolsEnabled,
            maxToolRounds: settings.agentMaxToolRounds,
            skillsEnabled: skillsActive,
            mcpEnabled: mcpActive,
            mcpTools,
            mcpServerEnabled: settings.mcpServerEnabled,
            mcpTrustedProjectPaths: settings.mcpTrustedProjectPaths,
            agentMode: turnAgentMode,
            getActiveBuildPlan: () => liveBuildPlan,
            ttsBaseUrl: settings.ttsBaseUrl,
            pdfOutputDir: effectivePdfOutputDir,
            runware: {
              apiBaseUrl: settings.runwareApiBaseUrl || 'https://api.runware.ai/v1',
              apiKey: settings.runwareApiKey,
              proxyBaseUrl: settings.ttsBaseUrl,
              model: settings.runwareImageModel,
              editModel: settings.runwareEditModel,
              width: imageWidth,
              height: imageHeight,
              steps: activeRunwareProfile.steps,
              cfgScale: activeRunwareProfile.cfgScale,
              gptQuality: imageGptQuality,
              editDefaults: {
                width: editWidth,
                height: editHeight,
                steps: activeRunwareEditProfile.steps,
                cfgScale: activeRunwareEditProfile.cfgScale,
                gptQuality: editGptQuality,
              },
              negativePrompt: settings.runwareNegativePrompt,
              imageProvider: settings.imageProvider,
              openrouter: {
                apiKey: settings.openrouterApiKey,
                baseUrl: settings.openrouterBaseUrl,
                model: settings.openrouterImageModel,
              },
              musicDefaults: {
                model: settings.runwareMusicModel,
                outputFormat: activeRunwareMusicProfile.outputFormat,
                durationSec: activeRunwareMusicProfile.durationSec,
                steps: activeRunwareMusicProfile.steps,
                cfgScale: activeRunwareMusicProfile.cfgScale,
                guidanceType: settings.runwareMusicGuidanceType,
                vocalLanguage: settings.runwareMusicVocalLanguage,
                seed: activeRunwareMusicProfile.seed ?? undefined,
              },
            },
            userImages: toolImageCatalog.map((x) => x.base64),
            userImageMimes: toolImageCatalog.map((x) => x.mime),
            userImagePaths: toolImageCatalog.map((x) => x.path || ''),
            codingProjectPath: settings.coding.projectPath || settings.codingProjectPath,
            codingRecentFiles: turnMemoRef.current.recentFiles,
            codingFileCacheRef: turnFileCacheRef,
            codingContextMemoRef: turnMemoRef,
            subAgent: settings.subAgent,
            ollamaBaseUrlForSubAgent: settings.ollamaBaseUrl,
            openrouterBaseUrlForSubAgent: settings.openrouterBaseUrl,
            openrouterApiKeyForSubAgent: settings.openrouterApiKey,
            deepseekBaseUrlForSubAgent: settings.deepseekBaseUrl,
            deepseekApiKeyForSubAgent: settings.deepseekApiKey,
            openaiBaseUrlForSubAgent: settings.openaiBaseUrl,
            openaiApiKeyForSubAgent: settings.openaiApiKey,
            subAgentUi:
              (settings.subAgent.enabled || settings.subAgent.codingEnabled) &&
              settings.subAgent.showAnalysisWindow !== false
                ? runSubAgentUi
                : undefined,
            onImageVisionCacheUpdate: (entries: ImageVisionCache) => {
              if (isViewingThisRun()) {
                setImageVisionCache((prev) => mergeImageVisionCache(prev, entries))
              }
            },
            onEscalateToPlan: () => {
              escalatedToPlan = true
            },
            imageVisionCache,
            signal: ac.signal,
            onThinkingDelta: isThinkingUiEnabled(settings.llmThinkLevel)
              ? (thinking: string) => {
                  if (!isRunActive()) return
                  setMsgs((prev) =>
                    prev.map((m) => (m.id === asstId ? { ...m, thinking } : m)),
                  )
                }
              : undefined,
            onDelta: (full: string) => {
              if (!isRunActive()) return
              if (!full) return
              setMsgs((prev) =>
                prev.map((m) => (m.id === asstId ? { ...m, content: full } : m)),
              )
            },
            onToolPhase: (phase: AgentToolUiPhase | null) => {
              if (!isRunActive()) return
              if (phase !== null) setPhase(phase)
            },
            onToolResult: (payload: AgentToolResultPayload) => {
              if (!isRunActive()) return
              if (harvestingPlanResearch) {
                harvestPlanToolIntoBuffer(
                  planResearchHarvest,
                  payload.name,
                  payload.args,
                  payload.result,
                )
              }
              turnLogMutable = recordCodingToolInTurnLog(
                turnLogMutable,
                payload.name,
                payload.args,
                payload.result,
              )
              const viewing = isViewingThisRun()
              applyAgentToolResult(
                {
                  asstId,
                  settings,
                  setSettings,
                  setToolPhase: setPhase,
                  refreshReminders,
                  refreshLongMemories,
                  setCodingContextMemo: applyCodingMemo,
                  codingFileCacheRef: turnFileCacheRef,
                  setCodingTerminalFeed: viewing
                    ? setCodingTerminalFeed
                    : () => {
                        /* background: skip terminal UI */
                      },
                  setCodingFileTreeNonce: viewing
                    ? setCodingFileTreeNonce
                    : () => {
                        /* background */
                      },
                  setCodingGitNonce: viewing
                    ? setCodingGitNonce
                    : () => {
                        /* background */
                      },
                  revealCodingFile: viewing ? revealCodingFile : () => {},
                  setToolResultBanner: setBanner,
                  setMessages: setMsgs,
                  ...mediaRun,
                },
                payload,
              )
              if (viewing) {
                codingFileCacheRef.current = turnFileCacheRef.current
              }
              if (
                opts?.buildFromPlanMessageId &&
                payload.name === 'update_plan_progress' &&
                !/^error:/i.test(payload.result.trim())
              ) {
                const planMsgId = opts.buildFromPlanMessageId
                const args = payload.args ?? {}
                setMsgs((prev) =>
                  prev.map((m) => {
                    if (m.id !== planMsgId || !m.plan) return m
                    const { plan, error: planErr } = applyPlanProgressUpdate(m.plan, args)
                    if (planErr) return m
                    liveBuildPlan = plan
                    return { ...m, plan }
                  }),
                )
              }
            },
          }
          const cloudCfg = resolveCloudLlmChatConfig(settings)
          const out = cloudCfg
            ? await runOpenRouterChatWithTools({
                baseUrl: cloudCfg.baseUrl,
                apiKey: cloudCfg.apiKey,
                model: cloudCfg.model,
                thinkLevel: cloudCfg.thinkLevel,
                providerOnly: cloudCfg.providerOnly,
                ...commonToolParams,
              })
            : await runOllamaChatWithTools({
                baseUrl: settings.ollamaBaseUrl,
                model: settings.ollamaModel,
                thinkLevel: settings.llmThinkLevel,
                ...commonToolParams,
              })
          replyText = out.content
          usage = out.usage
          if (out.content) {
            setMsgs((prev) =>
              prev.map((m) => (m.id === asstId ? { ...m, content: out.content } : m)),
            )
          }
        } else {
          const cloudCfg = resolveCloudLlmChatConfig(settings)
          const out = cloudCfg
            ? await streamOpenRouterChat({
                baseUrl: cloudCfg.baseUrl,
                apiKey: cloudCfg.apiKey,
                model: cloudCfg.model,
                thinkLevel: cloudCfg.thinkLevel,
                providerOnly: cloudCfg.providerOnly,
                messages: ollamaMessagesToOpenRouter(history),
                modelOptions: {
                  temperature: settings.llmTemperature,
                  num_ctx: settings.llmNumCtx,
                },
                signal: ac.signal,
                onThinkingDelta: isThinkingUiEnabled(settings.llmThinkLevel)
                  ? (thinking) => {
                      if (!isRunActive()) return
                      setMsgs((prev) =>
                        prev.map((m) => (m.id === asstId ? { ...m, thinking } : m)),
                      )
                    }
                  : undefined,
                onDelta: (full) => {
                  if (!isRunActive()) return
                  setMsgs((prev) =>
                    prev.map((m) => (m.id === asstId ? { ...m, content: full } : m)),
                  )
                },
              })
            : await streamOllamaChat({
                baseUrl: settings.ollamaBaseUrl,
                model: settings.ollamaModel,
                messages: history,
                modelOptions: {
                  temperature: settings.llmTemperature,
                  num_ctx: settings.llmNumCtx,
                },
                signal: ac.signal,
                thinkLevel: settings.llmThinkLevel,
                onThinkingDelta: isThinkingUiEnabled(settings.llmThinkLevel)
                  ? (thinking) => {
                      if (!isRunActive()) return
                      setMsgs((prev) =>
                        prev.map((m) => (m.id === asstId ? { ...m, thinking } : m)),
                      )
                    }
                  : undefined,
                onDelta: (full) => {
                  if (!isRunActive()) return
                  setMsgs((prev) =>
                    prev.map((m) => (m.id === asstId ? { ...m, content: full } : m)),
                  )
                },
              })
          replyText = out.content
          usage = out.usage
        }

        if (!isRunActive()) {
          const planMsgId = opts?.buildFromPlanMessageId
          if (planMsgId) {
            setMsgs((prev) =>
              prev.map((m) =>
                m.id === planMsgId && m.plan?.status === 'approved'
                  ? { ...m, plan: reopenPlanAsDraft(m.plan) }
                  : m,
              ),
            )
          }
          return
        }

        if (turnAgentMode === 'plan' && replyText.trim()) {
          const extracted = extractPlanArtifactFromReply(replyText)
          const plan = extracted
            ? attachResearchToPlan(extracted, planResearchHarvest)
            : null
          const stripped = stripPlanJsonFenceFromContent(replyText)
          const displayContent = stripped.trim() ? stripped : plan ? '' : replyText
          setMsgs((prev) =>
            prev.map((m) =>
              m.id === asstId
                ? {
                    ...m,
                    content: displayContent,
                    ...(plan ? { plan } : {}),
                  }
                : m,
            ),
          )
          replyText = displayContent
        }

        if (opts?.buildFromPlanMessageId) {
          const planMsgId = opts.buildFromPlanMessageId
          setMsgs((prev) =>
            prev.map((m) =>
              m.id === planMsgId && m.plan
                ? { ...m, plan: finalizePlanAfterBuild(m.plan) }
                : m,
            ),
          )
          setSettings((s) => (s.agentMode === 'agent' ? s : { ...s, agentMode: 'agent' }))
        }

        const usageInfo = estimateContextUsage(usage, resolveContextLimit(settings))
        setUsage(usageInfo)
        if (usageInfo?.shouldWarn && !settings.contextAutoCompress) setWarnDismissed(false)
        if (retrievedLongMemory.length > 0) {
          void touchMemoryUsage(retrievedLongMemory.map((m) => m.id))
        }

        if (settings.toolsEnabled.coding && turnLogMutable.events.length > 0) {
          const summary = buildCodingTurnSummary({
            userGoal: text,
            log: turnLogMutable,
            assistantReply: replyText,
          })
          if (summary) {
            applyCodingMemo((prev) => ({
              ...prev,
              lastTurnSummary: summary,
            }))
          }
        }
      } catch (e) {
        const reopenBuildPlan = () => {
          const planMsgId = opts?.buildFromPlanMessageId
          if (!planMsgId) return
          setMsgs((prev) =>
            prev.map((m) =>
              m.id === planMsgId && m.plan?.status === 'approved'
                ? { ...m, plan: reopenPlanAsDraft(m.plan) }
                : m,
            ),
          )
        }
        if ((e as Error).name === 'AbortError') {
          reopenBuildPlan()
          return
        }
        if (!isRunActive()) {
          reopenBuildPlan()
          return
        }
        reopenBuildPlan()
        const msg = e instanceof Error ? e.message : String(e)
        setErr(msg)
        setMsgs((prev) =>
          prev.map((m) =>
            m.id === asstId && !m.content.trim() ? { ...m, content: `(ERR: ${msg})` } : m,
          ),
        )
        if (settings.notificationSoundsEnabled) {
          void playNotificationSound('error', { volume: settings.notificationSoundVolume })
        }
      } finally {
        sessionAgentStore.endRun(keyOf(), runId)
      }

      // Same semantics as pre-store: runId still current and not aborted → finish/escalate.
      const runStillOwnsSlot =
        sessionAgentStore.getSnapshot(keyOf()).runId === runId && !ac.signal.aborted

      if (escalatedToPlan && runStillOwnsSlot) {
        setSettings((s) => (s.agentMode === 'plan' ? s : { ...s, agentMode: 'plan' }))
        const handoffHistory = isEdit
          ? activeHistory.filter((m) => m.id !== asstId)
          : userMsg
            ? [...activeHistory, userMsg]
            : activeHistory
        let handoffContext = ''
        let summary = ''
        if (settings.toolsEnabled.coding) {
          summary = buildCodingTurnSummary({
            userGoal: text,
            log: turnLogMutable,
            assistantReply: replyText,
          })
          if (summary) {
            applyCodingMemo((prev) => ({
              ...prev,
              lastTurnSummary: summary,
            }))
          }
          handoffContext = buildPlanHandoffContextHint(turnMemoRef.current, {
            turnSummary: summary || turnMemoRef.current.lastTurnSummary,
            toolLog: turnLogMutable,
          })
        }
        const draftBody = buildPlanHandoffUiDraftContent({
          replyText,
          turnSummary: summary || turnMemoRef.current.lastTurnSummary,
          memo: turnMemoRef.current,
          toolLog: turnLogMutable,
        })
        const planHandoffUiDraft = draftBody
          ? {
              id: asstId,
              role: 'assistant' as const,
              content: draftBody,
              planHandoffDraft: true,
            }
          : undefined
        onSessionDirty()
        sessionAgentStore.releaseKeyHandle(bind)
        void onSend({
          text,
          forceAgentMode: 'plan',
          skipAddUserMsg: true,
          history: handoffHistory,
          planHandoff: true,
          planHandoffContext: handoffContext || undefined,
          planHandoffUiDraft,
        })
        return
      }

      sessionAgentStore.releaseKeyHandle(bind)

      if (replyText.trim() && runStillOwnsSlot) {
        const willAutoSpeak = loadSettings().autoVoice && ttsOk !== false
        if (settings.notificationSoundsEnabled && !willAutoSpeak) {
          void playNotificationSound('reply', { volume: settings.notificationSoundVolume })
        }
        if (willAutoSpeak && isViewingThisRun()) {
          void onRead({ id: asstId, role: 'assistant', content: replyText })
        }
      }
    },
    [
      activeCodingProcesses,
      activeSessionUseLongMemory,
      codingContextMemo,
      codingContextMemoRef,
      codingFileCacheRef,
      claimSessionIdForDraft,
      contextCompressedThroughIndex,
      effectivePdfOutputDir,
      hiddenContextSummary,
      imageVisionCache,
      input,
      onRead,
      onSessionDirty,
      patchSessionCodingMemo,
      pendingFiles,
      pendingImages,
      refreshLongMemories,
      refreshReminders,
      revealCodingFile,
      runtimeKey,
      runtimeKeyRef,
      setCodingContextMemo,
      setCodingFileTreeNonce,
      setCodingGitNonce,
      setCodingTerminalFeed,
      setImageVisionCache,
      setInput,
      setPendingFiles,
      setPendingImages,
      setSettings,
      settings,
      systemPromptPresetRef,
      ttsOk,
    ],
  )

  const onStop = useCallback(() => {
    sessionAgentStore.stop(runtimeKey)
    void cancelActiveMcpCalls()
    sessionAgentStore.setMessages(runtimeKey, (prev) =>
      prev.map((m) =>
        m.plan?.status === 'approved' ? { ...m, plan: reopenPlanAsDraft(m.plan) } : m,
      ),
    )
  }, [runtimeKey])

  const startEdit = useCallback(
    (msg: UiMessage) => {
      if (busy) return
      setEditingMessageId(msg.id)
      setEditInputValue(msg.content)
    },
    [busy],
  )

  const cancelEdit = useCallback(() => {
    setEditingMessageId(null)
    setEditInputValue('')
  }, [])

  const commitEdit = useCallback(
    (msgId: string) => {
      const idx = messages.findIndex((m) => m.id === msgId)
      if (idx < 0) return
      const trimmed = editInputValue.trim()
      if (!trimmed) return
      const edited: UiMessage = { ...messages[idx], content: trimmed }
      const truncated = messages.slice(0, idx + 1).map((m, i) => (i === idx ? edited : m))
      setMessages(truncated)
      setEditingMessageId(null)
      setEditInputValue('')
      void onSend({ text: trimmed, history: truncated, skipAddUserMsg: true })
    },
    [editInputValue, messages, onSend, setMessages],
  )

  const updateMessagePlan = useCallback(
    (messageId: string, plan: PlanArtifact | undefined) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, plan } : m)),
      )
      onSessionDirty()
    },
    [onSessionDirty, setMessages],
  )

  const approveAndBuildPlan = useCallback(
    (messageId: string, plan: PlanArtifact) => {
      if (busy) return
      const approved: PlanArtifact = { ...plan, status: 'approved' }
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, plan: approved } : m)),
      )
      onSessionDirty()
      setSettings((s) => ({ ...s, agentMode: 'agent' }))
      const buildText = formatPlanForBuildPrompt(approved)
      void onSend({
        text: buildText,
        displayText: `Build approved plan: ${approved.title || 'plan'}`,
        forceAgentMode: 'agent',
        buildFromPlanMessageId: messageId,
      })
    },
    [busy, onSend, onSessionDirty, setMessages, setSettings],
  )

  const revisePlanWithCustomNote = useCallback(
    (_messageId: string, plan: PlanArtifact, customNote: string) => {
      if (busy) return
      const note = customNote.trim()
      if (!note) return
      onSessionDirty()
      setSettings((s) => (s.agentMode === 'plan' ? s : { ...s, agentMode: 'plan' }))
      const reviseText = formatPlanForRevisePrompt(plan, note)
      void onSend({
        text: reviseText,
        forceAgentMode: 'plan',
      })
    },
    [busy, onSend, onSessionDirty, setSettings],
  )

  return {
    messages,
    setMessages,
    busy,
    error,
    setError,
    toolPhase,
    contextUsageInfo,
    setContextUsageInfo,
    contextWarnDismissed,
    setContextWarnDismissed,
    contextCompressBusy,
    subAgentPanelOpen,
    setSubAgentPanelOpen,
    subAgentPanelBusy,
    setSubAgentPanelBusy,
    subAgentPanelText,
    setSubAgentPanelText,
    assistantGeneratedImages: media.assistantGeneratedImages,
    setAssistantGeneratedImages: mediaView.setAssistantGeneratedImages,
    assistantSavedImagePaths: media.assistantSavedImagePaths,
    setAssistantSavedImagePaths: mediaView.setAssistantSavedImagePaths,
    assistantImageToolMeta: media.assistantImageToolMeta,
    setAssistantImageToolMeta: mediaView.setAssistantImageToolMeta,
    assistantImageMessageMeta: media.assistantImageMessageMeta,
    setAssistantImageMessageMeta: mediaView.setAssistantImageMessageMeta,
    assistantGeneratedAudios: media.assistantGeneratedAudios,
    setAssistantGeneratedAudios: mediaView.setAssistantGeneratedAudios,
    assistantSavedAudioPaths: media.assistantSavedAudioPaths,
    setAssistantSavedAudioPaths: mediaView.setAssistantSavedAudioPaths,
    assistantAudioToolMeta: media.assistantAudioToolMeta,
    setAssistantAudioToolMeta: mediaView.setAssistantAudioToolMeta,
    assistantAudioMessageMeta: media.assistantAudioMessageMeta,
    setAssistantAudioMessageMeta: mediaView.setAssistantAudioMessageMeta,
    toolResultBanner,
    setToolResultBanner,
    editingMessageId,
    setEditingMessageId,
    editInputValue,
    setEditInputValue,
    editingHistoryRef,
    abortRef,
    activeChatRunIdRef,
    contextOverflowLatchRef,
    resetAssistantMediaState,
    resetContextUsage,
    onSend,
    onStop,
    startEdit,
    cancelEdit,
    commitEdit,
    updateMessagePlan,
    approveAndBuildPlan,
    revisePlanWithCustomNote,
    summarizeContextNow,
    subAgentUi,
    setBusy,
    runtimeKey,
  }
}

/** @deprecated use DRAFT_RUNTIME_KEY from sessionAgentStore */
export { DRAFT_RUNTIME_KEY }
