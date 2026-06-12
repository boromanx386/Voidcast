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
import { dedupeNonEmpty } from '@/lib/chatHints'
import { compressConversationContext } from '@/lib/contextCompress'
import {
  CONTEXT_COMPRESS_RATIO_RESET,
  estimateContextUsage,
  type ContextUsageInfo,
} from '@/lib/contextUsage'
import {
  commandResultSnippet,
  getCodingProjectPath,
  isCodingToolFailure,
  normalizeCodingContextMemo,
  pushRecentCommand,
  pushRecentUnique,
  type CodingContextMemo,
} from '@/lib/codingContextMemo'
import { formatEditedFileMemoEntry } from '@/lib/codingEol'
import { mergeImageVisionCache, type ImageVisionCache } from '@/lib/imageVisionCache'
import { touchMemoryUsage } from '@/lib/longMemoryStorage'
import { runOllamaChatWithTools } from '@/lib/ollamaAgent'
import { anyToolEnabled } from '@/lib/toolDefinitions'
import { toolPhaseForAgentTool, type AgentToolUiPhase } from '@/lib/agentToolPhase'
import { streamOllamaChat, isThinkingUiEnabled } from '@/lib/ollama'
import { runOpenRouterChatWithTools } from '@/lib/openrouterAgent'
import { ollamaMessagesToOpenRouter, streamOpenRouterChat } from '@/lib/openrouter'
import { playNotificationSound } from '@/lib/notificationSounds'
import { invokeSaveImageFromUrl } from '@/lib/saveImage'
import { invokeSaveAudioFromUrl } from '@/lib/saveAudio'
import { loadSettings, type AppSettings } from '@/lib/settings'
import type { SubAgentUiCallbacks } from '@/lib/subAgent'
import { scheduleUserDataSync } from '@/lib/userDataSync'
import {
  extractRunwareAudioUrls,
  extractRunwareImageUrls,
  extractSavedAudioPaths,
  extractSavedImagePaths,
  parseRunwareAudioToolMeta,
  parseRunwareImageToolMeta,
  type RunwareAudioToolMeta,
  type RunwareImageToolMeta,
} from '@/lib/runwareMessageMeta'
import { toConversationTurns } from '@/lib/chatHints'
import type { FileAttachmentSnapshot, UiMessage } from '@/types/chat'
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

  onSessionDirty: () => void
}

export type OnSendOptions = {
  text?: string
  history?: UiMessage[]
  skipAddUserMsg?: boolean
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
      const text = isEdit ? (opts?.text ?? '') : input.trim()
      const activeHistory = opts?.history ?? messages
      const queued = isEdit ? [] : pendingImages
      const queuedFiles = isEdit ? [] : pendingFiles
      if ((!text && queued.length === 0 && queuedFiles.length === 0) || busy) return
      setError(null)
      if (!isEdit) {
        setPendingImages([])
        setPendingFiles([])
        setInput('')
      }

      const imagesBase64 = queued.map((q) => q.base64)
      const imageMimes = queued.map((q) => q.mime)
      const imageNames = queued.map((q) => (q.name || '').trim())
      const imagePaths = queued.map((q) => (q.path || '').trim())

      const turnContext = await buildAgentTurnContext({
        settings,
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

      const useTools = anyToolEnabled(settings.toolsEnabled)

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
            subAgentUi:
              settings.subAgent.enabled && settings.subAgent.showAnalysisWindow !== false
                ? subAgentUi
                : undefined,
            onImageVisionCacheUpdate: (entries: ImageVisionCache) => {
              setImageVisionCache((prev) => mergeImageVisionCache(prev, entries))
            },
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
            onToolResult: ({
              name,
              result,
              args,
            }: {
              name: string
              result: string
              args?: Record<string, unknown>
            }) => {
              if (!isRunActive()) return
              setToolPhase(toolPhaseForAgentTool(name))
              if (
                name === 'add_reminder' ||
                name === 'list_reminders' ||
                name === 'delete_reminder' ||
                name === 'update_reminder'
              ) {
                void refreshReminders()
                scheduleUserDataSync(settings.ttsBaseUrl)
              }
              if (name === 'update_settings') {
                setSettings(loadSettings())
                void refreshLongMemories()
                scheduleUserDataSync(settings.ttsBaseUrl)
              }
              if (
                name === 'list_directory' ||
                name === 'read_file' ||
                name === 'write_file' ||
                name === 'edit_code' ||
                name === 'search_files' ||
                name === 'glob_files' ||
                name === 'git_status' ||
                name === 'git_diff' ||
                name === 'git_log' ||
                name === 'git_show' ||
                name === 'execute_command'
              ) {
                setCodingContextMemo((prev) => {
                  const next = { ...prev }
                  if (name === 'list_directory') {
                    const p = typeof args?.path === 'string' ? args.path : ''
                    next.lastDirectory = p || '.'
                  } else if (name === 'glob_files') {
                    const p = typeof args?.path_prefix === 'string' ? args.path_prefix : ''
                    if (p) next.lastDirectory = p
                  } else if (name === 'read_file' || name === 'write_file' || name === 'edit_code') {
                    const p = typeof args?.path === 'string' ? args.path : ''
                    let entry = p
                    if (name === 'read_file' && entry) {
                      const s = typeof args?.start_line === 'number' ? args.start_line : undefined
                      const e = typeof args?.end_line === 'number' ? args.end_line : undefined
                      if (s !== undefined && e !== undefined) entry = `${entry} (lines ${s}-${e})`
                      else if (s !== undefined) entry = `${entry} (from line ${s})`
                      else if (e !== undefined) entry = `${entry} (to line ${e})`
                    } else if (name === 'edit_code' && entry) {
                      entry = formatEditedFileMemoEntry(entry, result)
                    } else if (name === 'write_file' && entry) {
                      entry = `${entry} (written)`
                    }
                    if (entry) next.recentFiles = pushRecentUnique(next.recentFiles, entry)
                  } else if (name === 'search_files') {
                    const q = typeof args?.query === 'string' ? args.query : ''
                    next.recentSearches = pushRecentUnique(next.recentSearches, q, 6)
                  } else if (
                    name === 'git_status' ||
                    name === 'git_diff' ||
                    name === 'git_log' ||
                    name === 'git_show'
                  ) {
                    let label = name
                    if (name === 'git_log') {
                      const p = typeof args?.path === 'string' ? args.path : ''
                      label = p ? `git_log -- ${p}` : 'git_log'
                    } else if (name === 'git_show') {
                      const ref = typeof args?.ref === 'string' ? args.ref : ''
                      const p = typeof args?.path === 'string' ? args.path : ''
                      label = p ? `git_show ${ref || 'HEAD'} -- ${p}` : `git_show ${ref || 'HEAD'}`
                    } else if (name === 'git_diff') {
                      const p = typeof args?.path === 'string' ? args.path : ''
                      const staged = args?.staged === true
                      label = p
                        ? `git_diff${staged ? ' --staged' : ''} -- ${p}`
                        : `git_diff${staged ? ' --staged' : ''}`
                    }
                    next.recentGitOps = pushRecentUnique(next.recentGitOps, label, 6)
                  } else if (name === 'execute_command') {
                    const c = typeof args?.command === 'string' ? args.command : ''
                    const ok = !isCodingToolFailure('execute_command', result)
                    next.recentCommands = pushRecentCommand(
                      next.recentCommands,
                      { command: c, ok, snippet: commandResultSnippet(result) },
                      6,
                    )
                  }

                  if (isCodingToolFailure(name, result)) {
                    let failureLabel = name
                    if (name === 'edit_code' || name === 'read_file' || name === 'write_file') {
                      const p = typeof args?.path === 'string' ? args.path : ''
                      if (p) failureLabel = `${name} (${p})`
                    } else if (name === 'execute_command') {
                      const c = typeof args?.command === 'string' ? args.command : ''
                      if (c) failureLabel = `${name}: ${c.split(' ')[0]}`
                    }
                    const failureEntry = `${failureLabel}: ${result.slice(0, 120)}`
                    next.recentFailures = pushRecentUnique(next.recentFailures, failureEntry, 6)
                  }

                  return normalizeCodingContextMemo(next, getCodingProjectPath(settings))
                })
              }

              if (name === 'execute_command') {
                const cmd = typeof args?.command === 'string' ? args.command : ''
                const raw = String(result ?? '').trimEnd()
                const MAX = 120_000
                const body =
                  raw.length > MAX
                    ? `${raw.slice(0, MAX)}\n\n… [truncated ${(raw.length - MAX).toLocaleString()} chars]`
                    : raw
                const ts = Date.now()
                const idBase = uid()
                setCodingTerminalFeed((prev) =>
                  [
                    ...prev,
                    {
                      id: `exec-cmd-${idBase}`,
                      stream: 'system' as const,
                      text: `$ ${cmd || '(empty command)'}`,
                      ts,
                    },
                    ...(body
                      ? ([
                          {
                            id: `exec-out-${idBase}`,
                            stream: 'stdout' as const,
                            text: body,
                            ts,
                          },
                        ] as const)
                      : []),
                  ].slice(-80),
                )
              }
              if (name === 'write_file' || name === 'edit_code' || name === 'execute_command') {
                setCodingFileTreeNonce((n) => n + 1)
              }
              if (name === 'save_pdf') {
                setToolResultBanner({ kind: 'pdf', text: result })
              }
              if (name === 'generate_image' || name === 'edit_image_runware') {
                const urls = extractRunwareImageUrls(result)
                const meta = parseRunwareImageToolMeta(result)
                if (meta) {
                  setAssistantImageMessageMeta((prev) => ({ ...prev, [asstId]: meta }))
                }
                if (urls.length > 0) {
                  setMessages((prev) =>
                    prev.map((m) => {
                      if (m.id !== asstId) return m
                      return {
                        ...m,
                        generatedImageUrls: dedupeNonEmpty([
                          ...(m.generatedImageUrls || []),
                          ...urls,
                        ]),
                      }
                    }),
                  )
                  setAssistantGeneratedImages((prev) => {
                    const cur = prev[asstId] || []
                    const next = Array.from(new Set([...cur, ...urls]))
                    return { ...prev, [asstId]: next }
                  })
                  if (meta) {
                    setAssistantImageToolMeta((prev) => {
                      const cur = prev[asstId] || {}
                      const next = { ...cur }
                      for (const u of urls) next[u] = meta
                      return { ...prev, [asstId]: next }
                    })
                  }
                  if (settings.runwareAutoSaveImages && settings.runwareImageOutputDir.trim()) {
                    void (async () => {
                      const saved: string[] = []
                      for (const u of urls) {
                        const txt = await invokeSaveImageFromUrl({
                          imageUrl: u,
                          outputDir: settings.runwareImageOutputDir,
                        }).catch((e) => (e instanceof Error ? e.message : String(e)))
                        saved.push(txt)
                      }
                      if (saved.length > 0) {
                        const savedPaths = extractSavedImagePaths(saved.join('\n'))
                        if (savedPaths.length > 0) {
                          setMessages((prev) =>
                            prev.map((m) => {
                              if (m.id !== asstId) return m
                              return {
                                ...m,
                                generatedImagePaths: dedupeNonEmpty([
                                  ...(m.generatedImagePaths || []),
                                  ...savedPaths,
                                ]),
                                generatedImageUrls: dedupeNonEmpty([
                                  ...(m.generatedImageUrls || []),
                                  ...urls,
                                ]),
                              }
                            }),
                          )
                          setAssistantSavedImagePaths((prev) => {
                            const cur = prev[asstId] || []
                            const next = Array.from(new Set([...cur, ...savedPaths]))
                            return { ...prev, [asstId]: next }
                          })
                        }
                      }
                    })()
                  }
                }
              }
              if (name === 'generate_music_runware') {
                const urls = extractRunwareAudioUrls(result)
                const meta = parseRunwareAudioToolMeta(result)
                if (meta) {
                  setAssistantAudioMessageMeta((prev) => ({ ...prev, [asstId]: meta }))
                }
                if (urls.length > 0) {
                  setAssistantGeneratedAudios((prev) => {
                    const cur = prev[asstId] || []
                    const next = Array.from(new Set([...cur, ...urls]))
                    return { ...prev, [asstId]: next }
                  })
                  if (meta) {
                    setAssistantAudioToolMeta((prev) => {
                      const cur = prev[asstId] || {}
                      const next = { ...cur }
                      for (const u of urls) next[u] = meta
                      return { ...prev, [asstId]: next }
                    })
                  }
                }
                if (
                  urls.length > 0 &&
                  settings.runwareAutoSaveMusic &&
                  settings.runwareMusicOutputDir.trim()
                ) {
                  void (async () => {
                    const saved: string[] = []
                    for (const u of urls) {
                      const txt = await invokeSaveAudioFromUrl({
                        audioUrl: u,
                        outputDir: settings.runwareMusicOutputDir,
                      }).catch((e) => (e instanceof Error ? e.message : String(e)))
                      saved.push(txt)
                    }
                    if (saved.length > 0) {
                      const savedPaths = extractSavedAudioPaths(saved.join('\n'))
                      if (savedPaths.length > 0) {
                        setAssistantSavedAudioPaths((prev) => {
                          const cur = prev[asstId] || []
                          const next = Array.from(new Set([...cur, ...savedPaths]))
                          return { ...prev, [asstId]: next }
                        })
                      }
                    }
                  })()
                }
              }
            },
          }
          const out =
            settings.llmProvider === 'openrouter' || settings.llmProvider === 'nvidia'
              ? await runOpenRouterChatWithTools({
                  baseUrl:
                    settings.llmProvider === 'nvidia'
                      ? settings.nvidiaBaseUrl
                      : settings.openrouterBaseUrl,
                  apiKey:
                    settings.llmProvider === 'nvidia'
                      ? settings.nvidiaApiKey
                      : settings.openrouterApiKey,
                  model:
                    settings.llmProvider === 'nvidia'
                      ? settings.nvidiaModel
                      : settings.openrouterModel,
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
          const out =
            settings.llmProvider === 'openrouter' || settings.llmProvider === 'nvidia'
              ? await streamOpenRouterChat({
                  baseUrl:
                    settings.llmProvider === 'nvidia'
                      ? settings.nvidiaBaseUrl
                      : settings.openrouterBaseUrl,
                  apiKey:
                    settings.llmProvider === 'nvidia'
                      ? settings.nvidiaApiKey
                      : settings.openrouterApiKey,
                  model:
                    settings.llmProvider === 'nvidia'
                      ? settings.nvidiaModel
                      : settings.openrouterModel,
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

        if (!isRunActive()) return

        const usageInfo = estimateContextUsage(usage, settings.llmNumCtx)
        setContextUsageInfo(usageInfo)
        if (usageInfo?.shouldWarn && !settings.contextAutoCompress) setContextWarnDismissed(false)
        if (retrievedLongMemory.length > 0) {
          void touchMemoryUsage(retrievedLongMemory.map((m) => m.id))
        }
      } catch (e) {
        if (!isRunActive()) return
        if ((e as Error).name === 'AbortError') return
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
    summarizeContextNow,
    subAgentUi,
  }
}
