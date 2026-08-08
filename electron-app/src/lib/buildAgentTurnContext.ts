import {
  buildOllamaMessages,
  sliceUiHistoryForContext,
  TOOLS_CODING_CHAT_IMAGE_ASSETS_HINT,
  buildToolsCodingHint,
  TOOLS_PDF_HINT,
  TOOLS_REDDIT_HINT,
  TOOLS_IMAGE_RECALL_HINT,
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
import {
  buildActiveProcessesHint,
  type ActiveCodingProcess,
} from '@/lib/codingActiveProcesses'
import type { ImageVisionCache } from '@/lib/imageVisionCache'
import { searchMemories } from '@/lib/longMemoryStorage'
import type { OllamaApiMessage } from '@/lib/ollama'
import { isThinkingUiEnabled } from '@/lib/ollama'
import {
  getAgentVisibleSettings,
  getRunwareMusicProfileForModel,
  getRunwareProfileForModel,
  getSystemPromptForPreset,
  type AppSettings,
  type RunwareModelProfile,
  type RunwareMusicModelProfile,
} from '@/lib/settings'
import { normalizeAgentChatMode, isReadOnlyAgentMode } from '@/types/chat'
import {
  buildProjectInstructionsHint,
  buildSkillsCatalogHint,
  discoverAgentSkills,
  loadProjectAgentInstructions,
} from '@/lib/agentSkills'
import {
  BUILD_WITH_RESEARCH_SYSTEM_HINT,
  BUILD_WITH_TEAM_WORKERS_SYSTEM_HINT,
  BUILD_TEAM_WORKERS_SYSTEM_HINT,
  buildAskModeSystemHint,
  buildPlanModeSystemHint,
} from '@/lib/planArtifact'
import { formatPlanHandoffUserBlock } from '@/lib/codingReadGuard'
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
  /** Live foreground/background coding shell processes for CTX hint. */
  activeCodingProcesses?: ActiveCodingProcess[]
  activeSessionUseLongMemory: boolean
  /** Per-chat system prompt preset; resolved via getSystemPromptForPreset. */
  systemPromptPreset?: unknown
  /**
   * Approve & Build turn with Plan research attached — softens broad explore pressure.
   */
  buildWithResearch?: boolean
  /**
   * enter_plan_mode handoff: prior agent-turn exploration to reuse in Plan mode.
   */
  planHandoffContext?: string
  /**
   * True when this turn is Approve & Build (even without research) — Team build hints.
   */
  buildFromPlan?: boolean
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
    activeCodingProcesses = [],
    activeSessionUseLongMemory,
    systemPromptPreset,
    buildWithResearch = false,
    planHandoffContext = '',
    buildFromPlan = false,
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
    toolImageCatalog.length > 0 ? buildImageCatalogHint(toolImageCatalog, queued.length) : ''
  const attachedFileHint = buildQueuedFilePathHint(queuedFiles)

  const runtimeTimeHint = buildRuntimeTimeHint()
  const codingProjectPath = (
    settings.coding.projectPath ||
    settings.codingProjectPath ||
    ''
  ).trim()
  const agentMode = normalizeAgentChatMode(settings.agentMode)
  const planMode = agentMode === 'plan'
  const askMode = agentMode === 'ask'
  const teamMode = agentMode === 'team'
  const readOnlyMode = isReadOnlyAgentMode(agentMode)
  const modeLabel = planMode ? 'Plan' : askMode ? 'Ask' : null
  const handoffHint = planHandoffContext.trim()
  const handoffUserBlock =
    planMode && handoffHint ? formatPlanHandoffUserBlock(handoffHint) : ''
  const ollamaUserText = [
    text,
    handoffUserBlock,
    attachedImageHint,
    imageCatalogHint,
    attachedFileHint,
  ]
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
  const useTools =
    anyToolEnabled(settings.toolsEnabled, skillsActive, mcpActive) ||
    Boolean(settings.subAgent?.enabled)
  const skillsSystemHint = skillsActive ? buildSkillsCatalogHint(discoveredSkills) : ''
  const projectInstructionFiles =
    settings.toolsEnabled.coding && codingProjectPath
      ? await loadProjectAgentInstructions({ projectPath: codingProjectPath })
      : []
  const projectInstructionsHint = buildProjectInstructionsHint(projectInstructionFiles)
  const planModeSystemHint = planMode
    ? buildPlanModeSystemHint({ hasHandoff: Boolean(handoffHint) })
    : ''
  const askModeSystemHint = askMode ? buildAskModeSystemHint() : ''
  const toolsHintParts: string[] = []
  if (handoffHint && planMode) toolsHintParts.push(handoffHint)
  // Approve & Build (Plan → implement) — never applies to Ask.
  if (!readOnlyMode && buildFromPlan && teamMode && settings.subAgent?.codingEnabled) {
    toolsHintParts.push(
      buildWithResearch
        ? BUILD_WITH_TEAM_WORKERS_SYSTEM_HINT
        : BUILD_TEAM_WORKERS_SYSTEM_HINT,
    )
  } else if (!readOnlyMode && buildWithResearch) {
    toolsHintParts.push(BUILD_WITH_RESEARCH_SYSTEM_HINT)
  }
  if (useTools) toolsHintParts.push(TOOLS_TRUTH_HINT)
  if (teamMode && useTools && settings.subAgent?.codingEnabled) {
    toolsHintParts.push(
      'TEAM DEFAULT: multi-file / multi-area work → call run_coding_workers early (≤2 path-disjoint tasks). You orchestrate; workers implement. Skip enter_plan_mode.',
    )
  }
  if (mcpActive) {
    const servers = [...new Set(mcpTools.map((t) => t.serverId))].sort()
    const mcpLines = [
      'MCP progressive discovery (keep context small):',
      '1) mcp_list_tools with a focused query → short catalog only (no schemas).',
      '2) mcp_get_tool with ONE qualified name → that tool\'s schema only.',
      readOnlyMode
        ? `3) mcp_call is disabled in ${modeLabel} mode (read-only). Use list/get + non-MCP research tools only.`
        : '3) mcp_call with name + arguments.',
      readOnlyMode
        ? ''
        : '4) If mcp_call returns <persisted-output>, use mcp_read_result on that path (or narrower MCP filters) — never invent missing data from the preview alone.',
      'Never load schemas for many tools at once.',
      servers.length
        ? `Connected MCP servers: ${servers.join(', ')} (${mcpTools.length} tools discoverable).`
        : '',
    ]
    toolsHintParts.push(mcpLines.filter(Boolean).join(' '))
  }
  if (settings.toolsEnabled.webSearch) toolsHintParts.push(TOOLS_WEB_SEARCH_HINT)
  if (settings.toolsEnabled.youtube) toolsHintParts.push(TOOLS_YOUTUBE_HINT)
  if (settings.toolsEnabled.reddit) toolsHintParts.push(TOOLS_REDDIT_HINT)
  if (settings.toolsEnabled.weather) toolsHintParts.push(TOOLS_WEATHER_HINT)
  if (settings.toolsEnabled.scrape) toolsHintParts.push(TOOLS_SCRAPE_HINT)
  if (settings.toolsEnabled.pdf && !readOnlyMode) toolsHintParts.push(TOOLS_PDF_HINT)
  if (useTools) {
    if (settings.toolsEnabled.runwareImage) {
      if (readOnlyMode) {
        toolsHintParts.push(
          `image_recall is available in ${modeLabel} mode for inspecting existing session/project images (read-only). Image generation/edit tools are disabled.`,
        )
      } else {
        toolsHintParts.push(TOOLS_RUNWARE_IMAGE_HINT)
      }
    } else if (readOnlyMode) {
      toolsHintParts.push(
        `image_recall is available in ${modeLabel} mode for inspecting existing session/project images (read-only).`,
      )
    } else {
      toolsHintParts.push(TOOLS_IMAGE_RECALL_HINT)
    }
  }
  if (settings.toolsEnabled.runwareMusic && !readOnlyMode) toolsHintParts.push(TOOLS_RUNWARE_MUSIC_HINT)
  if (settings.toolsEnabled.coding) {
    const codingSub = Boolean(settings.subAgent?.codingEnabled)
    if (readOnlyMode) {
      toolsHintParts.push(
        [
          `Coding tools are READ-ONLY in ${modeLabel} mode: list_directory, read_file, search_files, glob_files, find_symbols, git_status, git_diff, git_log, git_show, check_types, list_processes, read_process_output${codingSub ? ', coding_explore' : ''}.`,
          planMode
            ? 'write_file, edit_code, execute_command, stop_process, git_restore, git_stash, and run_coding_workers are disabled until the user Approves & Builds.'
            : 'write_file, edit_code, execute_command, stop_process, git_restore, git_stash, and run_coding_workers are disabled in Ask mode. For changes, the user should switch to Agent, Team, or Plan.',
          codingProjectPath
            ? `Coding project root: ${codingProjectPath}`
            : 'No coding project path is set yet (Options → Tools).',
        ].join('\n'),
      )
    } else {
      toolsHintParts.push(
        buildToolsCodingHint(codingProjectPath, {
          codingSubAgentEnabled: codingSub,
          teamMode,
        }),
      )
      toolsHintParts.push(TOOLS_CODING_CHAT_IMAGE_ASSETS_HINT)
      toolsHintParts.push(
        'image_recall can load vision bytes from image files inside the coding project folder (use reference_image_paths with a project-relative path such as demos/name.png).',
      )
    }
    toolsHintParts.push(buildCodingMemoHint(codingContextMemo, { buildWithResearch }))
    const activeHint = buildActiveProcessesHint(activeCodingProcesses)
    if (activeHint) toolsHintParts.push(activeHint)
  }
  if (useTools && !readOnlyMode) {
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
    if (settings.toolsEnabled.enterPlan && !teamMode) {
      toolsHintParts.push(
        'You have an enter_plan_mode tool. Call it when a task is complex, risky, or has meaningful tradeoffs — before making any changes — or whenever the user explicitly asks for a plan. It hands control to Plan mode, which explores read-only and presents an editable plan card for approval before anything is implemented.',
      )
    }
    if (teamMode) {
      toolsHintParts.push(
        [
          'Team mode stays active for the whole turn — do not switch to Plan.',
          'enter_plan_mode is unavailable.',
          settings.subAgent?.codingEnabled
            ? 'Non-trivial coding: run_coding_workers is the default path (≤2 path-disjoint tasks + path_prefix). After digests: verify, then one user answer. Direct tools only for tiny single-file work or glue.'
            : 'Coding sub-agent is off — enable Options → SUB → ENABLE_CODING_SUB_AGENT so Team can run parallel workers (otherwise Team has no point).',
          'If the user only wanted a plan card, tell them to use Plan mode in the composer.',
        ].join(' '),
      )
    }
  } else if (useTools && readOnlyMode) {
    toolsHintParts.push(
      `Reminder tools: only list_reminders is available in ${modeLabel} mode (read-only).`,
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
    systemPrompt: getSystemPromptForPreset(systemPromptPreset, settings),
    projectInstructionsHint: projectInstructionsHint || undefined,
    planModeSystemHint: planModeSystemHint || undefined,
    askModeSystemHint: askModeSystemHint || undefined,
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
