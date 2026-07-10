import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
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
  type ContextUsageInfo,
} from '@/lib/contextUsage'
import type { CodingContextMemo } from '@/lib/codingContextMemo'
import { mergeImageVisionCache, type ImageVisionCache } from '@/lib/imageVisionCache'
import { touchMemoryUsage } from '@/lib/longMemoryStorage'
import { runOllamaChatWithTools } from '@/lib/ollamaAgent'
import {
  advancePlanStepsOnProgress,
  extractPlanArtifactFromReply,
  finalizePlanAfterBuild,
  formatPlanForBuildPrompt,
  isPlanProgressToolResult,
  reopenPlanAsDraft,
  stripPlanJsonFenceFromContent,
} from '@/lib/planArtifact'
import { anyToolEnabled } from '@/lib/toolDefinitions'
import { type AgentToolUiPhase } from '@/lib/agentToolPhase'
import { streamOllamaChat, isThinkingUiEnabled } from '@/lib/ollama'
import { runOpenRouterChatWithTools } from '@/lib/openrouterAgent'
import { resolveCloudLlmChatConfig } from '@/lib/cloudLlm'
import { ollamaMessagesToOpenRouter, streamOpenRouterChat } from '@/lib/openrouter'
import { playNotificationSound } from '@/lib/notificationSounds'
import { loadSettings, type AppSettings } from '@/lib/settings'
import type { SubAgentUiCallbacks } from '@/lib/subAgent'
import type { RunwareAudioToolMeta, RunwareImageToolMeta } from '@/lib/runwareMessageMeta'
import { toConversationTurns } from '@/lib/chatHints'
import type { AgentChatMode, FileAttachmentSnapshot, PlanArtifact, UiMessage } from '@/types/chat'
import type { TerminalLine } from '@/types/coding'

export type UseChatAgentDeps = {
  settings: AppSettings
  setSettings: Dispatch<SetStateAction<AppSettings>>
  effectivePdfOutputDir: string

  hiddenContextSummary: string
  setHiddenContextSummary: (summary: string) => void
  contextCompressedThroughIndex: number
  setContextCompressedThroughIndex: (index: number) => void
  imageVisionCache: ImageVisionCache
  setImageVisionCache: Dispatch<SetStateAction<ImageVisionCache>>
  codingContextMemo: CodingContextMemo
  activeSessionId: string | null
  onContextCompressed?: (params: {
    summary: string
    throughIndex: number
    activeSessionId: string | null
  }) => void

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

  onSessionDirty: () => void
}

export type OnSendOptions = {
  text?: string
  history?: UiMessage[]
  skipAddUserMsg?: boolean
  /** Override settings.agentMode for this turn (Approve → Build uses 'agent'). */
  forceAgentMode?: AgentChatMode
  /** After a successful build turn, mark this plan message as built. */
  buildFromPlanMessageId?: string
}

export function useChatAgent(deps: UseChatAgentDeps) {
  const {
    settings,
    setSettings,
    effectivePdfOutputDir,
    hiddenContextSummary,
    setHiddenContextSummary,
    contextCompressedThroughIndex,
    setContextCompressedThroughIndex,
    imageVisionCache,
    setImageVisionCache,
    codingContextMemo,
    activeSessionId,
    onContextCompressed,
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
    onSessionDirty,
  } = deps

  const [messages, setMessages] = useState<UiMessage[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toolPhase, setToolPhase] = useState<AgentToolUiPhase | null>(null)
  const [contextUsageInfo, setContextUsageInfo] = useState<ContextUsageInfo | null>(null)
  const [contextWarnDismissed, setContextWarnDismissed] = useState(false)
  const [contextCompressBusy, setContextCompressBusy] = useState(false)
  const contextOverflowLatchRef = useRef(false)

  const [subAgentPanelOpen, setSubAgentPanelOpen] = useState(false)
  const [subAgentPanelBusy, setSubAgentPanelBusy] = useState(false)
  const [subAgentPanelText, setSubAgentPanelText] = useState('')

  const [toolResultBanner, setToolResultBanner] = useState<{ kind: 'pdf'; text: string } | null>(
    null,
  )

  const [assistantGeneratedImages, setAssistantGeneratedImages] = useState<
    Record<string, string[]>
  >({})
  const [assistantSavedImagePaths, setAssistantSavedImagePaths] = useState<
    Record<string, string[]>
  >({})
  const [assistantImageToolMeta, setAssistantImageToolMeta] = useState<
    Record<string, Record<string, RunwareImageToolMeta>>
  >({})
  const [assistantImageMessageMeta, setAssistantImageMessageMeta] = useState<
    Record<string, RunwareImageToolMeta>
  >({})
  const [assistantGeneratedAudios, setAssistantGeneratedAudios] = useState<
    Record<string, string[]>
  >({})
  const [assistantSavedAudioPaths, setAssistantSavedAudioPaths] = useState<
    Record<string, string[]>
  >({})
  const [assistantAudioToolMeta, setAssistantAudioToolMeta] = useState<
    Record<string, Record<string, RunwareAudioToolMeta>>
  >({})
  const [assistantAudioMessageMeta, setAssistantAudioMessageMeta] = useState<
    Record<string, RunwareAudioToolMeta>
  >({})

  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [editInputValue, setEditInputValue] = useState('')
  const editingHistoryRef = useRef<UiMessage[] | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  const activeChatRunIdRef = useRef(0)

  const resetAssistantMediaState = useCallback(() => {
    setAssistantGeneratedImages({})
    setAssistantSavedImagePaths({})
    setAssistantImageToolMeta({})
    setAssistantImageMessageMeta({})
    setAssistantGeneratedAudios({})
    setAssistantSavedAudioPaths({})
    setAssistantAudioToolMeta({})
    setAssistantAudioMessageMeta({})
  }, [])

  const resetContextUsage = useCallback(() => {
    setContextUsageInfo(null)
    setContextWarnDismissed(false)
    contextOverflowLatchRef.current = false
  }, [])

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
        nvidiaBaseUrl: settings.nvidiaBaseUrl,
        nvidiaApiKey: settings.nvidiaApiKey,
        nvidiaModel: settings.nvidiaModel,
        deepseekBaseUrl: settings.deepseekBaseUrl,
        deepseekApiKey: settings.deepseekApiKey,
        deepseekModel: settings.deepseekModel,
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
        activeSessionId,
      })
    } catch (e) {
      contextOverflowLatchRef.current = false
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setContextCompressBusy(false)
    }
  }, [
    activeSessionId,
    busy,
    contextCompressBusy,
    hiddenContextSummary,
    messages,
    onContextCompressed,
    setContextCompressedThroughIndex,
    setHiddenContextSummary,
    settings,
  ])

  useEffect(() => {
    if (!contextUsageInfo) return
    if (contextUsageInfo.ratio < CONTEXT_COMPRESS_RATIO_RESET) {
      contextOverflowLatchRef.current = false
      return
    }
    if (!contextUsageInfo.shouldCompress) return
    if (!settings.contextAutoCompress) return
    if (busy || contextCompressBusy || contextOverflowLatchRef.current) return
    if (messages.length < 4) return

    contextOverflowLatchRef.current = true
    void summarizeContextNow()
  }, [
    busy,
    contextCompressBusy,
    contextUsageInfo,
    messages.length,
    settings.contextAutoCompress,
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
    }),
    [],
  )

  const onSend = useCallback(
    async (opts?: OnSendOptions) => {
      const isEdit = Boolean(opts?.skipAddUserMsg)
      const text = isEdit
        ? (opts?.text ?? '')
        : (opts?.text ?? input).trim()
      const activeHistory = opts?.history ?? messages
      const queued = isEdit || opts?.text ? [] : pendingImages
      const queuedFiles = isEdit || opts?.text ? [] : pendingFiles
      if ((!text && queued.length === 0 && queuedFiles.length === 0) || busy) return
      setError(null)
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

      const turnContext = await buildAgentTurnContext({
        settings: turnSettings,
        activeHistory,
        text,
        queued,
        queuedFiles,
        hiddenContextSummary,
        contextCompressedThroughIndex,
        imageVisionCache,
        codingContextMemo,
        activeSessionUseLongMemory,
      })

      const {
        toolImageCatalog,
        history,
        retrievedLongMemory,
        activeRunwareProfile,
        activeRunwareEditProfile,
        activeRunwareMusicProfile,
        skillsActive,
      } = turnContext

      let userMsg: UiMessage | undefined
      if (!isEdit) {
        userMsg = {
          id: uid(),
          role: 'user',
          content: text,
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
      const runId = activeChatRunIdRef.current + 1
      activeChatRunIdRef.current = runId
      const asstMsg: UiMessage = { id: asstId, role: 'assistant', content: '' }
      if (isEdit) {
        setMessages(() => [...activeHistory, asstMsg])
      } else {
        setMessages((m) => [...m, userMsg!, asstMsg])
      }
      onSessionDirty()
      setBusy(true)
      setToolPhase(null)
      setToolResultBanner(null)

      const useTools = anyToolEnabled(settings.toolsEnabled, skillsActive)

      const ac = new AbortController()
      abortRef.current = ac
      const isRunActive = () => activeChatRunIdRef.current === runId && !ac.signal.aborted
      let replyText = ''
      let usage: { prompt_eval_count?: number; eval_count?: number } | undefined

      try {
        if (useTools) {
          const commonToolParams = {
            initialMessages: history,
            rawUserText: text,
            modelOptions: { temperature: settings.llmTemperature, num_ctx: settings.llmNumCtx },
            toolsEnabled: settings.toolsEnabled,
            skillsEnabled: skillsActive,
            agentMode: turnAgentMode,
            ttsBaseUrl: settings.ttsBaseUrl,
            pdfOutputDir: effectivePdfOutputDir,
            runware: {
              apiBaseUrl: settings.runwareApiBaseUrl,
              apiKey: settings.runwareApiKey,
              proxyBaseUrl: settings.ttsBaseUrl,
              model: settings.runwareImageModel,
              editModel: settings.runwareEditModel,
              width: activeRunwareProfile.width,
              height: activeRunwareProfile.height,
              steps: activeRunwareProfile.steps,
              cfgScale: activeRunwareProfile.cfgScale,
              gptQuality: activeRunwareProfile.gptQuality,
              editDefaults: {
                width: activeRunwareEditProfile.width,
                height: activeRunwareEditProfile.height,
                steps: activeRunwareEditProfile.steps,
                cfgScale: activeRunwareEditProfile.cfgScale,
                gptQuality: activeRunwareEditProfile.gptQuality,
              },
              negativePrompt: settings.runwareNegativePrompt,
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
            subAgent: settings.subAgent,
            ollamaBaseUrlForSubAgent: settings.ollamaBaseUrl,
            openrouterBaseUrlForSubAgent: settings.openrouterBaseUrl,
            openrouterApiKeyForSubAgent: settings.openrouterApiKey,
            deepseekBaseUrlForSubAgent: settings.deepseekBaseUrl,
            deepseekApiKeyForSubAgent: settings.deepseekApiKey,
            subAgentUi:
              settings.subAgent.enabled && settings.subAgent.showAnalysisWindow !== false
                ? subAgentUi
                : undefined,
            onImageVisionCacheUpdate: (entries: ImageVisionCache) => {
              setImageVisionCache((prev) => mergeImageVisionCache(prev, entries))
            },
            imageVisionCache,
            signal: ac.signal,
            onThinkingDelta: isThinkingUiEnabled(settings.llmThinkLevel)
              ? (thinking: string) => {
                  if (!isRunActive()) return
                  setMessages((prev) =>
                    prev.map((m) => (m.id === asstId ? { ...m, thinking } : m)),
                  )
                }
              : undefined,
            onDelta: (full: string) => {
              if (!isRunActive()) return
              setMessages((prev) =>
                prev.map((m) => (m.id === asstId ? { ...m, content: full } : m)),
              )
            },
            onToolPhase: (phase: AgentToolUiPhase | null) => {
              if (!isRunActive()) return
              if (phase !== null) setToolPhase(phase)
            },
            onToolResult: (payload: AgentToolResultPayload) => {
              if (!isRunActive()) return
              applyAgentToolResult(
                {
                  asstId,
                  settings,
                  setSettings,
                  setToolPhase,
                  refreshReminders,
                  refreshLongMemories,
                  setCodingContextMemo,
                  setCodingTerminalFeed,
                  setCodingFileTreeNonce,
                  setCodingGitNonce,
                  setToolResultBanner,
                  setMessages,
                  setAssistantGeneratedImages,
                  setAssistantSavedImagePaths,
                  setAssistantImageToolMeta,
                  setAssistantImageMessageMeta,
                  setAssistantGeneratedAudios,
                  setAssistantSavedAudioPaths,
                  setAssistantAudioToolMeta,
                  setAssistantAudioMessageMeta,
                },
                payload,
              )
              if (
                opts?.buildFromPlanMessageId &&
                isPlanProgressToolResult(payload.name, payload.result)
              ) {
                const planMsgId = opts.buildFromPlanMessageId
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === planMsgId && m.plan
                      ? { ...m, plan: advancePlanStepsOnProgress(m.plan) }
                      : m,
                  ),
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
        } else {
          const cloudCfg = resolveCloudLlmChatConfig(settings)
          const out = cloudCfg
              ? await streamOpenRouterChat({
                  baseUrl: cloudCfg.baseUrl,
                  apiKey: cloudCfg.apiKey,
                  model: cloudCfg.model,
                  thinkLevel: cloudCfg.thinkLevel,
                  messages: ollamaMessagesToOpenRouter(history),
                  modelOptions: { temperature: settings.llmTemperature, num_ctx: settings.llmNumCtx },
                  signal: ac.signal,
                  onThinkingDelta: isThinkingUiEnabled(settings.llmThinkLevel)
                    ? (thinking) => {
                        if (!isRunActive()) return
                        setMessages((prev) =>
                          prev.map((m) => (m.id === asstId ? { ...m, thinking } : m)),
                        )
                      }
                    : undefined,
                  onDelta: (full) => {
                    if (!isRunActive()) return
                    setMessages((prev) =>
                      prev.map((m) => (m.id === asstId ? { ...m, content: full } : m)),
                    )
                  },
                })
              : await streamOllamaChat({
                  baseUrl: settings.ollamaBaseUrl,
                  model: settings.ollamaModel,
                  messages: history,
                  modelOptions: { temperature: settings.llmTemperature, num_ctx: settings.llmNumCtx },
                  signal: ac.signal,
                  thinkLevel: settings.llmThinkLevel,
                  onThinkingDelta: isThinkingUiEnabled(settings.llmThinkLevel)
                    ? (thinking) => {
                        if (!isRunActive()) return
                        setMessages((prev) =>
                          prev.map((m) => (m.id === asstId ? { ...m, thinking } : m)),
                        )
                      }
                    : undefined,
                  onDelta: (full) => {
                    if (!isRunActive()) return
                    setMessages((prev) =>
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
            setMessages((prev) =>
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
          const plan = extractPlanArtifactFromReply(replyText)
          const stripped = stripPlanJsonFenceFromContent(replyText)
          // Fence-only replies: show empty body (card has the structure), not raw JSON.
          const displayContent = stripped.trim() ? stripped : plan ? '' : replyText
          setMessages((prev) =>
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
          setMessages((prev) =>
            prev.map((m) =>
              m.id === planMsgId && m.plan
                ? { ...m, plan: finalizePlanAfterBuild(m.plan) }
                : m,
            ),
          )
          setSettings((s) => (s.agentMode === 'agent' ? s : { ...s, agentMode: 'agent' }))
        }

        const usageInfo = estimateContextUsage(usage, settings.llmNumCtx)
        setContextUsageInfo(usageInfo)
        if (usageInfo?.shouldWarn && !settings.contextAutoCompress) setContextWarnDismissed(false)
        if (retrievedLongMemory.length > 0) {
          void touchMemoryUsage(retrievedLongMemory.map((m) => m.id))
        }
      } catch (e) {
        const reopenBuildPlan = () => {
          const planMsgId = opts?.buildFromPlanMessageId
          if (!planMsgId) return
          setMessages((prev) =>
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
        setError(msg)
        setMessages((prev) =>
          prev.map((m) =>
            m.id === asstId && !m.content.trim() ? { ...m, content: `(ERR: ${msg})` } : m,
          ),
        )
        if (settings.notificationSoundsEnabled) {
          void playNotificationSound('error', { volume: settings.notificationSoundVolume })
        }
      } finally {
        if (activeChatRunIdRef.current === runId) {
          setToolPhase(null)
          setBusy(false)
          abortRef.current = null
        }
      }

      if (replyText.trim()) {
        const willAutoSpeak = loadSettings().autoVoice && ttsOk !== false
        if (settings.notificationSoundsEnabled && !willAutoSpeak) {
          void playNotificationSound('reply', { volume: settings.notificationSoundVolume })
        }
        if (willAutoSpeak) {
          void onRead({ id: asstId, role: 'assistant', content: replyText })
        }
      }
    },
    [
      activeSessionUseLongMemory,
      busy,
      codingContextMemo,
      contextCompressedThroughIndex,
      effectivePdfOutputDir,
      hiddenContextSummary,
      imageVisionCache,
      input,
      messages,
      onRead,
      onSessionDirty,
      pendingFiles,
      pendingImages,
      refreshLongMemories,
      refreshReminders,
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
      subAgentUi,
      ttsOk,
    ],
  )

  const onStop = useCallback(() => {
    activeChatRunIdRef.current += 1
    abortRef.current?.abort()
    abortRef.current = null
    setToolPhase(null)
    setBusy(false)
    // Unlock any in-flight Approve & Build plan so the user can retry.
    setMessages((prev) =>
      prev.map((m) =>
        m.plan?.status === 'approved' ? { ...m, plan: reopenPlanAsDraft(m.plan) } : m,
      ),
    )
  }, [])

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
    [editInputValue, messages, onSend],
  )

  const updateMessagePlan = useCallback(
    (messageId: string, plan: PlanArtifact | undefined) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, plan } : m)),
      )
      onSessionDirty()
    },
    [onSessionDirty],
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
        forceAgentMode: 'agent',
        buildFromPlanMessageId: messageId,
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
    assistantGeneratedImages,
    setAssistantGeneratedImages,
    assistantSavedImagePaths,
    setAssistantSavedImagePaths,
    assistantImageToolMeta,
    setAssistantImageToolMeta,
    assistantImageMessageMeta,
    setAssistantImageMessageMeta,
    assistantGeneratedAudios,
    setAssistantGeneratedAudios,
    assistantSavedAudioPaths,
    setAssistantSavedAudioPaths,
    assistantAudioToolMeta,
    setAssistantAudioToolMeta,
    assistantAudioMessageMeta,
    setAssistantAudioMessageMeta,
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
    summarizeContextNow,
    subAgentUi,
  }
}
