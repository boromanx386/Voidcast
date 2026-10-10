import { buildToolsList } from '@/lib/toolDefinitions'
import { sniffImageMimeOrNull } from '@/lib/imageMime'
import { AGENT_MAX_TOOL_ROUNDS_DEFAULT, clampAgentMaxToolRounds } from '@/lib/settings'
import {
  type ChatWithToolsCommonParams,
  buildToolExecutorOptions,
} from '@/lib/agentParams'
import {
  CODING_CLEAR_KEEP_RECENT_ROUNDS,
  CODING_CLEAR_KEEP_RECENT_ROUNDS_BY_TOOL,
  CODING_CLEAR_MIN_CHARS,
  CODING_PIN_RECENT_BY_TOOL,
  clearedCodingToolResultPlaceholder,
  isClearableCodingToolResult,
  shouldTrimCodingResult,
  trimNoisyCodingResult,
} from '@/lib/codingSubAgent'
import { buildWorkingSetHint } from '@/lib/codingContextMemo'
import type { OllamaChatUsage } from '@/lib/ollama'
import {
  ollamaMessagesToOpenRouter,
  streamOpenRouterChat,
  type OpenRouterMessage,
  type OpenRouterToolCall,
} from '@/lib/openrouter'
import { executeToolCall, resolveImageRecallRequest } from '@/lib/agentToolExecutor'
import { toolPhaseForAgentTool } from '@/lib/agentToolPhase'
import { RECALLED_IMAGE_ROUND_MESSAGE, runSharedToolLoop } from '@/lib/agentToolLoop'
import { buildRecalledImageDigestLine } from '@/lib/imageVisionCache'
import {
  getLastUserText,
  isImplementAgentMode,
  parseToolArguments,
  TOOL_BUDGET_EXHAUSTED_REPROMPT_MESSAGE,
  TOOL_BUDGET_WARNING_REPROMPT_MESSAGE,
} from '@/lib/agentToolUtils'

const MAX_REQUIRED_TOOL_REPROMPTS = 2

function toOpenRouterToolCalls(calls: OpenRouterToolCall[]): OpenRouterToolCall[] {
  return calls
    .filter((t) => t.function?.name)
    .map((t, idx) => {
      const id = t.id || `tool_call_${idx + 1}`
      // Keep provider call id in sync so tool results match assistant.tool_calls[].id
      if (!t.id) t.id = id
      return {
        id,
        type: 'function' as const,
        function: {
          name: t.function.name,
          arguments: t.function.arguments || '{}',
        },
      }
    })
}

function toBase64DataImageUri(base64: string, mime: string): string {
  const clean = base64.replace(/\s+/g, '')
  // The magic prefix wins over the declared type: a label can be wrong (WebP bytes declared as
  // image/png) and strict providers such as Anthropic /messages validate against the bytes.
  const declared = /^image\/[a-z0-9.+-]+$/i.test(mime) ? mime : null
  const safeMime = sniffImageMimeOrNull(clean) ?? declared ?? 'image/png'
  return `data:${safeMime};base64,${clean}`
}

export type RunOpenRouterChatWithToolsParams = ChatWithToolsCommonParams & {
  apiKey: string
  /** OpenRouter provider slug lock from settings. */
  providerOnly?: string
  /** Called when the agent requests to escalate into Plan mode (enter_plan_mode tool). */
  onEscalateToPlan?: (ctx: { messages: OpenRouterMessage[] }) => void
}

export async function runOpenRouterChatWithTools(
  params: RunOpenRouterChatWithToolsParams,
): Promise<{ content: string; usage?: OllamaChatUsage }> {
  // Coding tools are only advertised when this chat has a project folder
  // (buildToolsList drops them for `''`), so the implement-mode prompt and the
  // repo-action truth guard must follow the same rule.
  const codingToolsOn = params.toolsEnabled.coding && params.codingProjectPath !== ''
  const tools = buildToolsList(params.toolsEnabled, Boolean(params.skillsEnabled), {
    agentMode: params.agentMode,
    mcpTools: params.mcpEnabled ? params.mcpTools : undefined,
    subAgentCodingEnabled: Boolean(params.subAgent?.codingEnabled),
    codingProjectPath: params.codingProjectPath,
  })
  if (tools.length === 0) throw new Error('runOpenRouterChatWithTools called with no tools enabled')

  const rawUserText = (params.rawUserText ?? getLastUserText(params.initialMessages)).trim()
  const codingContextEnabled = Boolean(params.subAgent?.codingEnabled)
  const implementCoding = codingToolsOn && isImplementAgentMode(params.agentMode)
  const initialMessages: OpenRouterMessage[] = ollamaMessagesToOpenRouter(params.initialMessages)
  return runSharedToolLoop<OpenRouterMessage, OpenRouterToolCall>({
    initialMessages,
    maxToolRounds: clampAgentMaxToolRounds(
      params.maxToolRounds ?? AGENT_MAX_TOOL_ROUNDS_DEFAULT,
    ),
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
        opencodeSessionId: params.opencodeSessionId,
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
      const normalized = toOpenRouterToolCalls(toolCalls.filter((t) => t.function?.name))
      messages.push({
        role: 'assistant',
        content,
        // Keep thinking even when empty string is needed later — sanitize maps to reasoning_content.
        ...(thinking.trim() ? { reasoning: thinking.trim() } : {}),
        ...(normalized.length ? { tool_calls: normalized } : {}),
      })
    },
    appendToolResult: ({ messages, call, name, result, round }) => {
      let toolCallId = call.id
      if (!toolCallId) {
        for (let i = messages.length - 1; i >= 0; i--) {
          const m = messages[i]
          if (m.role !== 'assistant' || !('tool_calls' in m) || !m.tool_calls?.length) continue
          const hit = m.tool_calls.find((tc) => tc.function?.name === name)
          if (hit?.id) {
            toolCallId = hit.id
            break
          }
        }
      }
      messages.push({
        role: 'tool',
        tool_call_id: toolCallId || `tool_call_${name}_${round}`,
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
          keepRecentRoundsByTool: CODING_CLEAR_KEEP_RECENT_ROUNDS_BY_TOOL,
          pinRecentByTool: CODING_PIN_RECENT_BY_TOOL,
          minChars: CODING_CLEAR_MIN_CHARS,
          shouldClear: isClearableCodingToolResult,
          placeholder: clearedCodingToolResultPlaceholder,
        }
      : undefined,
    injectWorkingSet: codingContextEnabled
      ? (unclearedPaths) => {
          const ref = params.codingFileCacheRef
          if (!ref?.current) return ''
          return buildWorkingSetHint(ref.current, unclearedPaths)
        }
      : undefined,
    appendToolRequiredReprompt: (messages) => {
      messages.push({
        role: 'user',
        content:
          'Tool call required: do not answer with plain text. Call the appropriate available tool now and only then provide the final answer from real tool output.',
      })
    },
    appendToolBudgetWarningReprompt: (messages) => {
      messages.push({
        role: 'user',
        content: TOOL_BUDGET_WARNING_REPROMPT_MESSAGE,
      })
    },
    appendToolBudgetExhaustedReprompt: (messages) => {
      messages.push({
        role: 'user',
        content: TOOL_BUDGET_EXHAUSTED_REPROMPT_MESSAGE,
      })
    },
    guardRepoActionTruth: implementCoding,
    appendRuntimeRecalledImages: (messages, recalled) => {
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: RECALLED_IMAGE_ROUND_MESSAGE },
          ...recalled.map((x) => ({ type: 'image_url' as const, image_url: { url: toBase64DataImageUri(x.base64, x.mime) } })),
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
      const focusValue = (argsObj as { focus?: unknown } | undefined)?.focus
      const focus = typeof focusValue === 'string' ? focusValue : undefined
      const visionCache = params.imageVisionCache ?? {}
      // Digest is computed while the path/focus are still known, and travels with the
      // payload so the loop can leave it behind when the pixels are stripped.
      return recall.recalled.map((img) => ({
        base64: img.base64,
        mime: img.mime,
        digest: buildRecalledImageDigestLine(img, visionCache, focus),
      }))
    },
    executeToolCall: (name, argsRaw) =>
      executeToolCall(
        name,
        argsRaw,
        params.toolsEnabled,
        buildToolExecutorOptions({ ...params, rawUserText }),
      ),
    parseArgsForToolResult: parseToolArguments,
    onDelta: params.onDelta,
    onThinkingDelta: params.onThinkingDelta,
    onToolPhase: params.onToolPhase,
    onIntermediateResponse: params.onIntermediateResponse,
    onToolStart: params.onToolStart,
    onToolFinish: params.onToolFinish,
    toolPhaseForName: (name) => toolPhaseForAgentTool(name),
    onToolResult: params.onToolResult,
    onEscalateToPlan: params.onEscalateToPlan,
  })
}
