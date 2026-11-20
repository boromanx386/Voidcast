import {
  buildOllamaMessages,
  sliceUiHistoryForContext,
  APP_DOCS_HINT,
  MCP_CONFIG_HINT,
  TOOLS_CODING_CHAT_IMAGE_ASSETS_HINT,
  TOOLS_CODING_NO_FOLDER_HINT,
  buildToolsCodingHint,
  TOOLS_TRUTH_HINT,
  type HistoryTurn,
} from '@/lib/chatMessages'
import {
  buildAssistantImageVisionHint,
  buildHistoricalImageRecallHint,
  buildImageCatalogHint,
  buildQueuedFilePathHint,
  buildQueuedImagePathHint,
  buildRuntimeTimeHint,
} from '@/lib/chatHints'
import { buildToolImageCatalog, type PendingChatImage } from '@/lib/chatImageCatalog'
import { buildCodingMemoHint, type CodingContextMemo } from '@/lib/codingContextMemo'
import { formatTurnToolRecord } from '@/lib/turnToolRecord'
import { buildActiveProcessesHint, type ActiveCodingProcess } from '@/lib/codingActiveProcesses'
import type { ImageVisionCache } from '@/lib/imageVisionCache'
import { searchMemories } from '@/lib/longMemoryStorage'
import type { OllamaApiMessage } from '@/lib/ollama'
import {
  getAgentVisibleSettings,
  getRunwareMusicProfileForModel,
  getRunwareProfileForModel,
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
  formatPlanHistoryNote,
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
  /** Non-blocking multi-chat same-project warning (from sessionAgentStore). */
  codingConcurrencyAdvisory?: string
  /** Coding root of the chat that owns this turn ('' = General). Frozen at send time. */
  codingProjectPath?: string
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
    buildWithResearch = false,
    planHandoffContext = '',
    buildFromPlan = false,
    codingConcurrencyAdvisory = '',
    codingProjectPath: codingProjectPathInput = '',
  } = params

  const toolImageCatalog = await buildToolImageCatalog(activeHistory, queued)
  const hasCurrentAttach = queued.length > 0
  // Only send vision bytes for images attached on THIS turn. Historical session
  // images stay in the catalog for image_recall — never re-inject the newest
  // catalog image just because the user text matched a vision keyword (that
  // made old screenshots look "newly attached" many turns later).
  const useVisionForCurrentMessage = !settings.subAgent.enabled && hasCurrentAttach
  const visionImagesForCurrentMessage = useVisionForCurrentMessage
    ? queued.map((q) => q.base64)
    : []
  const attachedImageHint = buildQueuedImagePathHint(queued)
  const imageCatalogHint =
    toolImageCatalog.length > 0 ? buildImageCatalogHint(toolImageCatalog, queued.length) : ''
  const attachedFileHint = buildQueuedFilePathHint(queuedFiles)

  const runtimeTimeHint = buildRuntimeTimeHint()
  // Explicit turn value, not a settings read: the chat that owns this run owns the root.
  const codingProjectPath = codingProjectPathInput.trim()
  const agentMode = normalizeAgentChatMode(settings.agentMode)
  const planMode = agentMode === 'plan'
  const askMode = agentMode === 'ask'
  const teamMode = agentMode === 'team'
  const readOnlyMode = isReadOnlyAgentMode(agentMode)
  const modeLabel = planMode ? 'Plan' : askMode ? 'Ask' : null
  const handoffHint = planHandoffContext.trim()
  const handoffUserBlock = planMode && handoffHint ? formatPlanHandoffUserBlock(handoffHint) : ''
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
  // The tool record of an assistant turn opens the NEXT user message. Appended to the
  // assistant reply itself, models learned it as part of their own output and wrote
  // fake records instead of calling tools.
  let pendingToolRecord = ''
  const takeToolRecord = (): string => {
    const r = pendingToolRecord
    pendingToolRecord = ''
    return r
  }
  const priorHistory: HistoryTurn[] = historyForApi.reduce<HistoryTurn[]>((acc, x) => {
    if (x.role === 'user') {
      const toolRecord = takeToolRecord()
      const fileHint = x.fileAttachments?.length
        ? [
            'Attached files in this user turn:',
            ...x.fileAttachments.map(
              (f, idx) =>
                `- ${idx + 1}: ${f.path || f.name}${
                  f.referenceOnly ? ' (path reference — no snapshot was sent)' : ''
                }`,
            ),
            // Snapshots live in one turn only: this rebuilt history does NOT carry
            // the text, so the model must re-read the file instead of pretending it
            // still has the contents.
            'Snapshot text was sent only in the turn where the file was attached',
            'and is NOT repeated here — read the file yourself with `read_file` if you',
            'need its contents, and never claim you already have them.',
          ].join('\n')
        : ''
      const imageRecallHint = buildHistoricalImageRecallHint(x, toolImageCatalog, imageVisionCache)
      const body =
        [x.content, fileHint, imageRecallHint].filter((v) => v.trim().length > 0).join('\n\n') ||
        (x.images?.length
          ? 'Attached image(s) were provided in this message.'
          : x.fileAttachments?.length
            ? 'Attached file(s) were provided in this message.'
            : '')
      const t: HistoryTurn = {
        role: 'user',
        content: [toolRecord, body].filter((v) => v.trim().length > 0).join('\n\n'),
      }
      acc.push(t)
      return acc
    }
    // Plan replies keep an empty bubble (the plan lives in the card + file), so the
    // model still needs a compact copy to revise against.
    const planNote = x.plan ? formatPlanHistoryNote(x.plan) : ''
    pendingToolRecord = formatTurnToolRecord(x)
    if (!x.content.trim() && !planNote) return acc
    const imageVisionHint = buildAssistantImageVisionHint(x, imageVisionCache)
    // Reasoning from earlier turns is not replayed: it costs several times the reply
    // and carries stale conclusions ("the user only wants a confirmation") into new
    // requests. Reasoning inside the current turn's tool loop is kept by the loop.
    acc.push({
      role: 'assistant',
      content: [x.content, planNote, imageVisionHint]
        .filter((v) => v.trim().length > 0)
        .join('\n\n'),
    })
    return acc
  }, [])

  // AGENTS.md / CLAUDE.md and project skills are plain text the agent could read with
  // read_file anyway, so they load without trust. Only project .mcp.json, which starts
  // processes, waits for the trust list.
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
  // Coding tools need a bound project folder. In a General chat the option can
  // be ON while the tools are not sent at all (see buildToolsList), so every
  // coding-flavoured hint below follows these flags, not toolsEnabled.coding.
  const hasCodingFolder = codingProjectPath.length > 0
  const codingToolsOn = settings.toolsEnabled.coding && hasCodingFolder
  const codingBlockedNoFolder = settings.toolsEnabled.coding && !hasCodingFolder
  const useTools =
    anyToolEnabled({ ...settings.toolsEnabled, coding: codingToolsOn }, skillsActive, mcpActive) ||
    Boolean(settings.subAgent?.enabled)
  const skillsSystemHint = skillsActive ? buildSkillsCatalogHint(discoveredSkills) : ''
  const projectInstructionFiles =
    settings.toolsEnabled.coding && codingProjectPath
      ? await loadProjectAgentInstructions({ projectPath: codingProjectPath })
      : []
  const projectInstructionsHint = buildProjectInstructionsHint(projectInstructionFiles)
  const planModeSystemHint = planMode
    ? buildPlanModeSystemHint({ hasHandoff: Boolean(handoffHint), submitTool: useTools })
    : ''
  const askModeSystemHint = askMode ? buildAskModeSystemHint() : ''
  const toolsHintParts: string[] = []
  // Volatile hints change turn-to-turn / per tool round (coding memo, live
  // processes, concurrency warning). Emitted AFTER the history so they never
  // bust the cached stable prefix — put only genuinely-changing text here.
  const volatileHintParts: string[] = []
  if (handoffHint && planMode) toolsHintParts.push(handoffHint)
  // Approve & Build (Plan → implement) — never applies to Ask.
  if (!readOnlyMode && buildFromPlan && teamMode && settings.subAgent?.codingEnabled) {
    toolsHintParts.push(
      buildWithResearch ? BUILD_WITH_TEAM_WORKERS_SYSTEM_HINT : BUILD_TEAM_WORKERS_SYSTEM_HINT,
    )
  } else if (!readOnlyMode && buildWithResearch) {
    toolsHintParts.push(BUILD_WITH_RESEARCH_SYSTEM_HINT)
  }
  if (useTools) toolsHintParts.push(TOOLS_TRUTH_HINT)
  if (teamMode && useTools && codingToolsOn && settings.subAgent?.codingEnabled) {
    toolsHintParts.push(
      'TEAM DEFAULT: multi-file / multi-area work → call run_coding_workers early (≤2 path-disjoint tasks). You orchestrate; workers implement. Skip enter_plan_mode.',
    )
  }
  if (mcpActive) {
    const servers = [...new Set(mcpTools.map((t) => t.serverId))].sort()
    const mcpLines = [
      'MCP progressive discovery (keep context small):',
      '1) mcp_list_tools with a focused query → short catalog only (no schemas).',
      "2) mcp_get_tool with ONE qualified name → that tool's schema only.",
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
  // App-level knowledge is not tied to a connected server: keep it even when mcpActive
  // is false, otherwise "add an MCP server" cannot be answered at all.
  toolsHintParts.push(MCP_CONFIG_HINT)
  toolsHintParts.push(APP_DOCS_HINT)
  // How to use each tool lives in its description, which is sent only with the
  // tool. Hints below cover what a description cannot: mode limits and app state.
  if (useTools && readOnlyMode && settings.toolsEnabled.runwareImage) {
    toolsHintParts.push(
      `Image generation and editing are disabled in ${modeLabel} mode; image_recall still works.`,
    )
  }
  if (codingBlockedNoFolder) {
    // Option is ON but this chat has no project folder → the coding tools are
    // not even sent (see buildToolsList). Without this branch the model would
    // read a full coding prompt for tools it does not have.
    toolsHintParts.push(TOOLS_CODING_NO_FOLDER_HINT)
  } else if (codingToolsOn) {
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
            : 'No coding project folder is bound to this chat yet (the user binds one in the chat header or the coding panel).',
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
    }
    volatileHintParts.push(buildCodingMemoHint(codingContextMemo, { buildWithResearch }))
    if (codingConcurrencyAdvisory.trim()) {
      volatileHintParts.push(codingConcurrencyAdvisory.trim())
    }
    const activeHint = buildActiveProcessesHint(activeCodingProcesses)
    if (activeHint) volatileHintParts.push(activeHint)
  }
  if (useTools && !readOnlyMode) {
    // Current values change when the user edits Options, so they ride in the
    // volatile tail: a theme switch must not bust the cached system prompt.
    const visible = getAgentVisibleSettings(settings)
    volatileHintParts.push(
      `Current app settings: llmNumCtx ${String(visible.llmNumCtx ?? '')}, llmTemperature ${String(visible.llmTemperature ?? '')}, uiTheme ${String(visible.uiTheme ?? '')}, autoVoice ${String(visible.autoVoice ?? '')}, runwareImageModel ${String(visible.runwareImageModel ?? '')}, runwareEditModel ${String(visible.runwareEditModel ?? '')}.`,
    )
    if (teamMode) {
      toolsHintParts.push(
        [
          'Team mode stays active for the whole turn — do not switch to Plan.',
          'enter_plan_mode is unavailable.',
          settings.subAgent?.codingEnabled
            ? 'Non-trivial coding: run_coding_workers is the default path (≤2 path-disjoint tasks + path_prefix). The runtime appends git_status, git_diff, and check_types verification after workers; review it, fix glue if needed, then answer once. Direct tools only for tiny single-file work or glue.'
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

  const lastToolRecord = takeToolRecord()
  const userTextWithRecord = lastToolRecord
    ? `${lastToolRecord}\n\n${ollamaUserText}`
    : ollamaUserText
  const history = buildOllamaMessages(priorHistory, userTextWithRecord, {
    systemPrompt: settings.llmSystemPrompt,
    projectInstructionsHint: projectInstructionsHint || undefined,
    planModeSystemHint: planModeSystemHint || undefined,
    askModeSystemHint: askModeSystemHint || undefined,
    skillsSystemHint: skillsSystemHint || undefined,
    runtimeSystemHint: runtimeTimeHint,
    hiddenContextSummary: hiddenContextSummary.trim() || undefined,
    longTermMemoryContext: longMemoryContext,
    toolsSystemHint:
      useTools && toolsHintParts.length > 0 ? toolsHintParts.join('\n\n') : undefined,
    volatileSystemHint: volatileHintParts.length > 0 ? volatileHintParts.join('\n\n') : undefined,
    newUserImages:
      visionImagesForCurrentMessage.length > 0 ? visionImagesForCurrentMessage : undefined,
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
