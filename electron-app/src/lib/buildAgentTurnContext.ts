import {
  buildOllamaMessages,
  sliceUiHistoryForContext,
  TOOLS_CODING_CHAT_IMAGE_ASSETS_HINT,
  buildToolsCodingHint,
  TOOLS_PDF_HINT,
  TOOLS_REDDIT_HINT,
  TOOLS_RUNWARE_IMAGE_HINT,
  TOOLS_RUNWARE_MUSIC_HINT,
  TOOLS_SCRAPE_HINT,
  TOOLS_TRUTH_HINT,
  TOOLS_WEATHER_HINT,
  TOOLS_WEB_SEARCH_HINT,
  TOOLS_YOUTUBE_HINT,
  type HistoryTurn,
} from '@/lib/chatMessages'
import {
  buildAssistantImageVisionHint,
  buildHistoricalImageRecallHint,
  buildImageCatalogHint,
  buildQueuedFilePathHint,
  buildQueuedImagePathHint,
  buildRuntimeTimeHint,
  shouldUseVisionForText,
} from '@/lib/chatHints'
import { buildToolImageCatalog, type PendingChatImage } from '@/lib/chatImageCatalog'
import { buildCodingMemoHint, type CodingContextMemo } from '@/lib/codingContextMemo'
import type { ImageVisionCache } from '@/lib/imageVisionCache'
import { searchMemories } from '@/lib/longMemoryStorage'
import type { OllamaApiMessage } from '@/lib/ollama'
import { isThinkingUiEnabled } from '@/lib/ollama'
import {
  getAgentVisibleSettings,
  getRunwareMusicProfileForModel,
  getRunwareProfileForModel,
  type AppSettings,
  type RunwareModelProfile,
  type RunwareMusicModelProfile,
} from '@/lib/settings'
import {
  buildProjectInstructionsHint,
  buildSkillsCatalogHint,
  discoverAgentSkills,
  loadProjectAgentInstructions,
} from '@/lib/agentSkills'
import { PLAN_MODE_SYSTEM_HINT } from '@/lib/planArtifact'
import { anyToolEnabled } from '@/lib/toolDefinitions'
import { ensureMcpToolsCached, type McpToolInfo } from '@/lib/mcpTools'
import { isElectron } from '@/lib/platform'
import type { FileAttachmentSnapshot, UiMessage } from '@/types/chat'
import type { LongMemoryItem } from '@/types/longMemory'

export type BuildAgentTurnContextParams = {
  settings: AppSettings
  activeHistory: UiMessage[]
  text: string
  queued: PendingChatImage[]
  queuedFiles: FileAttachmentSnapshot[]
  hiddenContextSummary: string
  contextCompressedThroughIndex: number
  imageVisionCache: ImageVisionCache
  codingContextMemo: CodingContextMemo
  activeSessionUseLongMemory: boolean
}

export type BuildAgentTurnContextResult = {
  toolImageCatalog: PendingChatImage[]
  ollamaUserText: string
  useVisionForCurrentMessage: boolean
  visionImagesForCurrentMessage: string[]
  priorHistory: HistoryTurn[]
  history: OllamaApiMessage[]
  retrievedLongMemory: LongMemoryItem[]
  activeRunwareProfile: RunwareModelProfile
  activeRunwareEditProfile: RunwareModelProfile
  activeRunwareMusicProfile: RunwareMusicModelProfile
  /** True when skills are enabled and at least one skill was discovered. */
  skillsActive: boolean
  /** True when MCP is enabled and at least one MCP tool is available (not plan mode). */
  mcpActive: boolean
  mcpTools: McpToolInfo[]
}

export async function buildAgentTurnContext(
  params: BuildAgentTurnContextParams,
): Promise<BuildAgentTurnContextResult> {
  const {
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
  } = params

  const toolImageCatalog = await buildToolImageCatalog(activeHistory, queued)
  const hasCurrentAttach = queued.length > 0
  const useVisionForCurrentMessage =
    !settings.subAgent.enabled && (hasCurrentAttach || shouldUseVisionForText(text))
  const visionImagesForCurrentMessage = useVisionForCurrentMessage
    ? hasCurrentAttach
      ? queued.map((q) => q.base64)
      : toolImageCatalog.slice(0, 1).map((x) => x.base64)
    : []
  const attachedImageHint = buildQueuedImagePathHint(queued)
  const imageCatalogHint =
    settings.toolsEnabled.runwareImage && toolImageCatalog.length > 0
      ? buildImageCatalogHint(toolImageCatalog, queued.length)
      : ''
  const attachedFileHint = buildQueuedFilePathHint(queuedFiles)
  const ollamaUserText = [text, attachedImageHint, imageCatalogHint, attachedFileHint]
    .filter((x) => x.trim().length > 0)
    .join('\n\n')

  const historyForApi: UiMessage[] = sliceUiHistoryForContext(
    activeHistory,
    hiddenContextSummary,
    contextCompressedThroughIndex,
  )
  const priorHistory: HistoryTurn[] = historyForApi.reduce<HistoryTurn[]>((acc, x) => {
    if (x.role === 'user') {
      const fileHint = x.fileAttachments?.length
        ? [
            'Attached files in this user turn:',
            ...x.fileAttachments.map((f, idx) => `- ${idx + 1}: ${f.path || f.name}`),
            'File snapshots are stored in the original attachment turn.',
          ].join('\n')
        : ''
      const imageRecallHint = buildHistoricalImageRecallHint(x, toolImageCatalog, imageVisionCache)
      const t: HistoryTurn = {
        role: 'user',
        content:
          [x.content, fileHint, imageRecallHint].filter((v) => v.trim().length > 0).join('\n\n') ||
          (x.images?.length
            ? 'Attached image(s) were provided in this message.'
            : x.fileAttachments?.length
              ? 'Attached file(s) were provided in this message.'
              : ''),
      }
      acc.push(t)
      return acc
    }
    if (!x.content.trim() && !x.thinking?.trim()) return acc
    const imageVisionHint = buildAssistantImageVisionHint(x, imageVisionCache)
    acc.push({
      role: 'assistant',
      content: [x.content, imageVisionHint].filter((v) => v.trim().length > 0).join('\n\n'),
      ...(x.thinking?.trim() ? { thinking: x.thinking } : {}),
    })
    return acc
  }, [])

  const runtimeTimeHint = buildRuntimeTimeHint()
  const codingProjectPath = (
    settings.coding.projectPath ||
    settings.codingProjectPath ||
    ''
  ).trim()
  const agentMode = settings.agentMode === 'plan' ? 'plan' : 'agent'
  const planMode = agentMode === 'plan'
  const discoveredSkills = settings.skillsEnabled
    ? await discoverAgentSkills({ projectPath: codingProjectPath || undefined })
    : []
  const skillsActive = settings.skillsEnabled && discoveredSkills.length > 0
  const mcpTools =
    settings.mcpEnabled && isElectron()
      ? await ensureMcpToolsCached(
          codingProjectPath || undefined,
          settings.mcpServerEnabled,
          false,
          settings.mcpTrustedProjectPaths,
        )
      : []
  const mcpActive = settings.mcpEnabled && mcpTools.length > 0
  const useTools = anyToolEnabled(settings.toolsEnabled, skillsActive, mcpActive)
  const skillsSystemHint = skillsActive ? buildSkillsCatalogHint(discoveredSkills) : ''
  const projectInstructionFiles =
    settings.toolsEnabled.coding && codingProjectPath
      ? await loadProjectAgentInstructions({ projectPath: codingProjectPath })
      : []
  const projectInstructionsHint = buildProjectInstructionsHint(projectInstructionFiles)
  const planModeSystemHint = planMode ? PLAN_MODE_SYSTEM_HINT : ''
  const toolsHintParts: string[] = []
  if (useTools) toolsHintParts.push(TOOLS_TRUTH_HINT)
  if (mcpActive) {
    const servers = [...new Set(mcpTools.map((t) => t.serverId))].sort()
    toolsHintParts.push(
      [
        'MCP progressive discovery (keep context small):',
        '1) mcp_list_tools with a focused query → short catalog only (no schemas).',
        '2) mcp_get_tool with ONE qualified name → that tool\'s schema only.',
        '3) mcp_call with name + arguments.',
        '4) If mcp_call returns <persisted-output>, use mcp_read_result on that path (or narrower MCP filters) — never invent missing data from the preview alone.',
        'Never load schemas for many tools at once.',
        servers.length
          ? `Connected MCP servers: ${servers.join(', ')} (${mcpTools.length} tools discoverable).`
          : '',
      ]
        .filter(Boolean)
        .join(' '),
    )
  }
  if (settings.toolsEnabled.webSearch) toolsHintParts.push(TOOLS_WEB_SEARCH_HINT)
  if (settings.toolsEnabled.youtube) toolsHintParts.push(TOOLS_YOUTUBE_HINT)
  if (settings.toolsEnabled.reddit) toolsHintParts.push(TOOLS_REDDIT_HINT)
  if (settings.toolsEnabled.weather) toolsHintParts.push(TOOLS_WEATHER_HINT)
  if (settings.toolsEnabled.scrape) toolsHintParts.push(TOOLS_SCRAPE_HINT)
  if (settings.toolsEnabled.pdf && !planMode) toolsHintParts.push(TOOLS_PDF_HINT)
  if (settings.toolsEnabled.runwareImage) {
    if (planMode) {
      toolsHintParts.push(
        'image_recall is available in Plan mode for inspecting existing session/project images (read-only). Image generation/edit tools are disabled until Approve & Build.',
      )
    } else {
      toolsHintParts.push(TOOLS_RUNWARE_IMAGE_HINT)
    }
  }
  if (settings.toolsEnabled.runwareMusic && !planMode) toolsHintParts.push(TOOLS_RUNWARE_MUSIC_HINT)
  if (settings.toolsEnabled.coding) {
    if (planMode) {
      toolsHintParts.push(
        [
          'Coding tools are READ-ONLY in Plan mode: list_directory, read_file, search_files, glob_files, git_status, git_diff, git_log, git_show, check_types.',
          'write_file, edit_code, and execute_command are disabled until the user Approves & Builds.',
          codingProjectPath
            ? `Coding project root: ${codingProjectPath}`
            : 'No coding project path is set yet (Options → Tools).',
        ].join('\n'),
      )
    } else {
      toolsHintParts.push(buildToolsCodingHint(codingProjectPath))
      toolsHintParts.push(TOOLS_CODING_CHAT_IMAGE_ASSETS_HINT)
      if (settings.toolsEnabled.runwareImage) {
        toolsHintParts.push(
          'image_recall can load vision bytes from image files inside the coding project folder (use reference_image_paths with a project-relative path such as demos/name.png).',
        )
      }
    }
    toolsHintParts.push(buildCodingMemoHint(codingContextMemo))
  }
  if (useTools && !planMode) {
    const visible = getAgentVisibleSettings(settings)
    const settingsHint = [
      'You have an update_settings tool for app configuration.',
      'Allowed fields: llmSystemPrompt, llmNumCtx, llmTemperature, uiTheme, longMemoryAdd, autoVoice, runwareResolution, runwareWidth, runwareHeight, runwareImageModel, runwareEditModel.',
      `Current llmSystemPrompt: ${JSON.stringify(String(visible.llmSystemPrompt ?? ''))}`,
      `Current llmNumCtx: ${String(visible.llmNumCtx ?? '')}`,
      `Current llmTemperature: ${String(visible.llmTemperature ?? '')}`,
      `Current uiTheme: ${String(visible.uiTheme ?? '')}`,
      `Current autoVoice: ${String(visible.autoVoice ?? '')}`,
      `Current runwareWidth: ${String(visible.runwareWidth ?? '')}`,
      `Current runwareHeight: ${String(visible.runwareHeight ?? '')}`,
      `Current runwareImageModel: ${String(visible.runwareImageModel ?? '')}`,
      `Current runwareEditModel: ${String(visible.runwareEditModel ?? '')}`,
      'Sensitive keys are hidden; never ask to reveal API keys.',
    ].join('\n')
    toolsHintParts.push(settingsHint)
    const remindersHint = [
      'You have reminder tools: add_reminder (set a note or scheduled reminder), list_reminders (show what is coming up), delete_reminder (cancel/remove), and update_reminder (reschedule or edit text/tags).',
      'For add_reminder, pass ISO datetime in "when" for scheduled, or omit for general.',
      'For list_reminders, use "today", "tomorrow", or date ranges like "next 3 days" in from/to.',
      'For delete_reminder and update_reminder, pass search_text to find the reminder by its text.',
    ].join('\n')
    toolsHintParts.push(remindersHint)
    if (settings.toolsEnabled.enterPlan) {
      toolsHintParts.push(
        'You have an enter_plan_mode tool. Call it when a task is complex, risky, or has meaningful tradeoffs — before making any changes — or whenever the user explicitly asks for a plan. It hands control to Plan mode, which explores read-only and presents an editable plan card for approval before anything is implemented.',
      )
    }
  } else if (useTools && planMode) {
    toolsHintParts.push(
      'Reminder tools: only list_reminders is available in Plan mode (read-only).',
    )
  }

  const retrievedLongMemory = activeSessionUseLongMemory
    ? await searchMemories({
        query: [text, hiddenContextSummary].filter(Boolean).join('\n'),
        limit: 8,
        minConfidence: 0.35,
      })
    : []
  const longMemoryContext =
    retrievedLongMemory.length > 0
      ? retrievedLongMemory
          .map((m, idx) => `- ${idx + 1}. [${m.kind}] ${m.text}`)
          .join('\n')
          .slice(0, 1200)
      : undefined

  const history = buildOllamaMessages(priorHistory, ollamaUserText, {
    systemPrompt: settings.llmSystemPrompt,
    projectInstructionsHint: projectInstructionsHint || undefined,
    planModeSystemHint: planModeSystemHint || undefined,
    skillsSystemHint: skillsSystemHint || undefined,
    runtimeSystemHint: runtimeTimeHint,
    hiddenContextSummary: hiddenContextSummary.trim() || undefined,
    longTermMemoryContext: longMemoryContext,
    toolsSystemHint:
      useTools && toolsHintParts.length > 0 ? toolsHintParts.join('\n\n') : undefined,
    newUserImages:
      visionImagesForCurrentMessage.length > 0 ? visionImagesForCurrentMessage : undefined,
    includeThinkingInHistory: isThinkingUiEnabled(settings.llmThinkLevel),
  })

  const activeRunwareProfile = getRunwareProfileForModel(settings, settings.runwareImageModel)
  const activeRunwareEditProfile = getRunwareProfileForModel(settings, settings.runwareEditModel)
  const activeRunwareMusicProfile = getRunwareMusicProfileForModel(
    settings,
    settings.runwareMusicModel,
  )

  return {
    toolImageCatalog,
    ollamaUserText,
    useVisionForCurrentMessage,
    visionImagesForCurrentMessage,
    priorHistory,
    history,
    retrievedLongMemory,
    activeRunwareProfile,
    activeRunwareEditProfile,
    activeRunwareMusicProfile,
    skillsActive,
    mcpActive,
    mcpTools,
  }
}
