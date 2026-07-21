import { buildOllamaToolsList } from '@/lib/toolDefinitions'
import type { McpToolInfo } from '@/lib/mcpTools'
import type { AgentChatMode, PlanArtifact } from '@/types/chat'
import type { ToolsEnabled, SubAgentConfig, LlmThinkLevel } from '@/lib/settings'
import type { SubAgentUiCallbacks } from '@/lib/subAgent'
import {
  CODING_CLEAR_KEEP_RECENT_ROUNDS,
  CODING_CLEAR_MIN_CHARS,
  clearedCodingToolResultPlaceholder,
  isClearableCodingToolResult,
  shouldTrimCodingResult,
  trimNoisyCodingResult,
} from '@/lib/codingSubAgent'
import type { ImageVisionCache } from '@/lib/imageVisionCache'
import type { OllamaApiMessage, OllamaChatUsage, OllamaModelOptions } from '@/lib/ollama'
import type { RunwareImageConfig } from '@/lib/runware'
import {
  ollamaMessagesToOpenRouter,
  streamOpenRouterChat,
  type OpenRouterMessage,
  type OpenRouterToolCall,
} from '@/lib/openrouter'
import { executeToolCall } from '@/lib/agentToolExecutor'
import { resolveImageRecallRequest } from '@/lib/ollamaAgent'
import { toolPhaseForAgentTool, type AgentToolUiPhase } from '@/lib/agentToolPhase'
import { runSharedToolLoop } from '@/lib/agentToolLoop'
import { FALSE_IMAGE_CLAIM_REPROMPT_MESSAGE, FALSE_MUSIC_CLAIM_REPROMPT_MESSAGE, parseToolArguments } from '@/lib/agentToolUtils'

const MAX_TOOL_ROUNDS = 70
const MAX_REQUIRED_TOOL_REPROMPTS = 2

function toOpenRouterToolCalls(calls: OpenRouterToolCall[]): OpenRouterToolCall[] {
  return calls
    .filter((t) => t.function?.name)
    .map((t, idx) => ({
      id: t.id || `tool_call_${idx + 1}`,
      type: 'function',
      index: t.index ?? idx,
      function: {
        name: t.function.name,
        arguments: t.function.arguments || '{}',
      },
    }))
}

function toDataImageUri(base64: string, mime: string): string {
  const safeMime = /^image\/[a-z0-9.+-]+$/i.test(mime) ? mime : 'image/png'
  return `data:${safeMime};base64,${base64.replace(/\s+/g, '')}`
}

export type RunOpenRouterChatWithToolsParams = {
  baseUrl: string
  apiKey: string
  model: string
  initialMessages: OllamaApiMessage[]
  modelOptions?: OllamaModelOptions
  toolsEnabled: ToolsEnabled
  /** When true, register read_skill and allow loading SKILL.md bodies. */
  skillsEnabled?: boolean
  /** MCP tools discovered from configured servers (qualified names). */
  mcpTools?: McpToolInfo[]
  /** When true, allow executing mcp__* tools. */
  mcpEnabled?: boolean
  /** Per-server enable map passed through to MCP execute. */
  mcpServerEnabled?: Record<string, boolean>
  mcpTrustedProjectPaths?: string[]
  /** Plan mode: read-only tool subset + executor hard gate. */
  agentMode?: AgentChatMode
  /** Live approved plan during Approve & Build (for update_plan_progress). */
  getActiveBuildPlan?: () => PlanArtifact | undefined
  ttsBaseUrl: string
  signal?: AbortSignal
  onDelta: (fullText: string) => void
  onThinkingDelta?: (fullReasoning: string) => void
  onToolPhase?: (phase: AgentToolUiPhase | null) => void
  pdfOutputDir?: string
  onToolResult?: (payload: { name: string; result: string; args?: Record<string, unknown> }) => void
  runware?: RunwareImageConfig
  userImages?: string[]
  userImageMimes?: string[]
  userImagePaths?: string[]
  codingProjectPath?: string
  /** Recently touched files from coding session memo (boosts search ranking). */
  codingRecentFiles?: string[]
  /** Ignored by OpenRouter path (no round-0 synthetic web); kept for shared App call site. */
  rawUserText?: string
  /** Sub-agent config for image_recall delegation. */
  subAgent?: SubAgentConfig
  /** Keys for sub-agent API calls (from main app settings). */
  ollamaBaseUrlForSubAgent?: string
  openrouterBaseUrlForSubAgent?: string
  openrouterApiKeyForSubAgent?: string
  deepseekBaseUrlForSubAgent?: string
  deepseekApiKeyForSubAgent?: string
  thinkLevel?: LlmThinkLevel
  /** OpenRouter provider slug lock from settings. */
  providerOnly?: string
  subAgentUi?: SubAgentUiCallbacks
  onImageVisionCacheUpdate?: (entries: ImageVisionCache) => void
  imageVisionCache?: ImageVisionCache
  /** Called when the agent requests to escalate into Plan mode (enter_plan_mode tool). */
  onEscalateToPlan?: (ctx: { messages: OpenRouterMessage[] }) => void
}

export async function runOpenRouterChatWithTools(
  params: RunOpenRouterChatWithToolsParams,
): Promise<{ content: string; usage?: OllamaChatUsage }> {
  const tools = buildOllamaToolsList(params.toolsEnabled, Boolean(params.skillsEnabled), {
    agentMode: params.agentMode,
    mcpTools: params.mcpEnabled ? params.mcpTools : undefined,
    subAgentCodingEnabled: Boolean(params.subAgent?.codingEnabled),
  })
  if (tools.length === 0) throw new Error('runOpenRouterChatWithTools called with no tools enabled')

  const codingContextEnabled = Boolean(params.subAgent?.codingEnabled)
  const initialMessages: OpenRouterMessage[] = ollamaMessagesToOpenRouter(params.initialMessages)
  return runSharedToolLoop<OpenRouterMessage, OpenRouterToolCall>({
    initialMessages,
    maxToolRounds: MAX_TOOL_ROUNDS,
    maxRequiredToolReprompts: MAX_REQUIRED_TOOL_REPROMPTS,
    mustCallTool: false,
    signal: params.signal,
    streamRound: async ({ messages, signal, onDelta, onThinkingDelta }) => {
      const res = await streamOpenRouterChat({
        baseUrl: params.baseUrl,
        apiKey: params.apiKey,
        model: params.model,
        messages,
        modelOptions: params.modelOptions,
        tools,
        signal,
        onDelta,
        onThinkingDelta,
        thinkLevel: params.thinkLevel,
        providerOnly: params.providerOnly,
      })
      return {
        content: res.content,
        thinking: res.reasoning,
        toolCalls: res.tool_calls,
        usage: res.usage,
      }
    },
    toSharedToolCalls: (calls) =>
      calls
        .filter((t) => t.function?.name)
        .map((call) => ({ name: call.function.name, argsRaw: call.function.arguments, raw: call })),
    appendAssistantWithToolCalls: ({ messages, content, thinking, toolCalls }) => {
      messages.push({
        role: 'assistant',
        content,
        ...(thinking.trim() ? { reasoning: thinking.trim() } : {}),
        tool_calls: toOpenRouterToolCalls(toolCalls.filter((t) => t.function?.name)),
      })
    },
    appendToolResult: ({ messages, call, name, result, round }) => {
      messages.push({
        role: 'tool',
        tool_call_id: call.id || `tool_call_${name}_${round}`,
        name,
        content: result,
      })
    },
    trimToolResultForLlm: codingContextEnabled
      ? (name, resultForLlm) =>
          shouldTrimCodingResult(name, resultForLlm, true)
            ? trimNoisyCodingResult(resultForLlm)
            : resultForLlm
      : undefined,
    oldToolResultClearing: codingContextEnabled
      ? {
          keepRecentRounds: CODING_CLEAR_KEEP_RECENT_ROUNDS,
          minChars: CODING_CLEAR_MIN_CHARS,
          shouldClear: isClearableCodingToolResult,
          placeholder: clearedCodingToolResultPlaceholder,
        }
      : undefined,
    appendToolRequiredReprompt: (messages) => {
      messages.push({
        role: 'user',
        content:
          'Tool call required: do not answer with plain text. Call the appropriate available tool now and only then provide the final answer from real tool output.',
      })
    },
    guardFalseImageClaims: params.toolsEnabled.runwareImage,
    guardFalseImageClaimsUserText: params.rawUserText ?? '',
    maxFalseImageClaimReprompts: MAX_REQUIRED_TOOL_REPROMPTS,
    appendFalseImageClaimReprompt: (messages) => {
      messages.push({
        role: 'user',
        content: FALSE_IMAGE_CLAIM_REPROMPT_MESSAGE,
      })
    },
    guardFalseMusicClaims: params.toolsEnabled.runwareMusic,
    guardFalseMusicClaimsUserText: params.rawUserText ?? '',
    maxFalseMusicClaimReprompts: MAX_REQUIRED_TOOL_REPROMPTS,
    appendFalseMusicClaimReprompt: (messages) => {
      messages.push({
        role: 'user',
        content: FALSE_MUSIC_CLAIM_REPROMPT_MESSAGE,
      })
    },
    appendRuntimeRecalledImages: (messages, recalled) => {
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: 'Image recall payload for current turn.' },
          ...recalled.map((x) => ({ type: 'image_url' as const, image_url: { url: toDataImageUri(x.base64, x.mime) } })),
        ],
      })
    },
    collectRecalledImages: async ({ name, argsRaw }) => {
      if (name !== 'image_recall') return []
      // When vision sub-agent is active, descriptions are already in the tool result.
      if (params.subAgent?.enabled) return []
      const argsObj =
        typeof argsRaw === 'string'
          ? parseToolArguments(argsRaw)
          : (argsRaw as Record<string, unknown>) ?? {}
      const recall = await resolveImageRecallRequest(
        argsObj,
        {
          userImages: params.userImages,
          userImageMimes: params.userImageMimes,
          userImagePaths: params.userImagePaths,
          codingProjectPath: params.codingProjectPath,
        },
        { codingEnabled: params.toolsEnabled.coding },
      )
      return recall.recalled.map((img) => ({ base64: img.base64, mime: img.mime }))
    },
    executeToolCall: (name, argsRaw) =>
      executeToolCall(name, argsRaw, params.toolsEnabled, {
        ttsBaseUrl: params.ttsBaseUrl,
        signal: params.signal,
        pdfOutputDir: params.pdfOutputDir,
        runware: params.runware,
        userImages: params.userImages,
        userImageMimes: params.userImageMimes,
        userImagePaths: params.userImagePaths,
        codingProjectPath: params.codingProjectPath,
        codingRecentFiles: params.codingRecentFiles,
        skillsEnabled: Boolean(params.skillsEnabled),
        mcpEnabled: Boolean(params.mcpEnabled),
        mcpTools: params.mcpTools,
        mcpServerEnabled: params.mcpServerEnabled,
        mcpTrustedProjectPaths: params.mcpTrustedProjectPaths,
        agentMode: params.agentMode,
        getActiveBuildPlan: params.getActiveBuildPlan,
        subAgent: params.subAgent,
        ollamaBaseUrl: params.ollamaBaseUrlForSubAgent,
        openrouterBaseUrl: params.openrouterBaseUrlForSubAgent,
        openrouterApiKey: params.openrouterApiKeyForSubAgent,
        deepseekBaseUrl: params.deepseekBaseUrlForSubAgent,
        deepseekApiKey: params.deepseekApiKeyForSubAgent,
        subAgentUi: params.subAgentUi,
        onImageVisionCacheUpdate: params.onImageVisionCacheUpdate,
        imageVisionCache: params.imageVisionCache,
      }),
    parseArgsForToolResult: parseToolArguments,
    onDelta: params.onDelta,
    onThinkingDelta: params.onThinkingDelta,
    onToolPhase: params.onToolPhase,
    toolPhaseForName: (name) => toolPhaseForAgentTool(name),
    onToolResult: params.onToolResult,
    onEscalateToPlan: params.onEscalateToPlan,
  })
}
