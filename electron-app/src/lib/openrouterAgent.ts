import { buildToolsList } from '@/lib/toolDefinitions'
import { AGENT_MAX_TOOL_ROUNDS_DEFAULT, clampAgentMaxToolRounds } from '@/lib/settings'
import {
  type ChatWithToolsCommonParams,
  buildToolExecutorOptions,
} from '@/lib/agentParams'
import {
  CODING_CLEAR_KEEP_RECENT_ROUNDS,
  CODING_CLEAR_MIN_CHARS,
  clearedCodingToolResultPlaceholder,
  isClearableCodingToolResult,
  shouldTrimCodingResult,
  trimNoisyCodingResult,
} from '@/lib/codingSubAgent'
import type { OllamaChatUsage } from '@/lib/ollama'
import {
  ollamaMessagesToOpenRouter,
  streamOpenRouterChat,
  type OpenRouterMessage,
  type OpenRouterToolCall,
} from '@/lib/openrouter'
import { executeToolCall, resolveImageRecallRequest } from '@/lib/agentToolExecutor'
import { toolPhaseForAgentTool } from '@/lib/agentToolPhase'
import { runSharedToolLoop } from '@/lib/agentToolLoop'
import {
  FALSE_CODING_CLAIM_REPROMPT_MESSAGE,
  FALSE_IMAGE_CLAIM_REPROMPT_MESSAGE,
  FALSE_MUSIC_CLAIM_REPROMPT_MESSAGE,
  getLastUserText,
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

function toDataImageUri(base64: string, mime: string): string {
  const safeMime = /^image\/[a-z0-9.+-]+$/i.test(mime) ? mime : 'image/png'
  return `data:${safeMime};base64,${base64.replace(/\s+/g, '')}`
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
  const tools = buildToolsList(params.toolsEnabled, Boolean(params.skillsEnabled), {
    agentMode: params.agentMode,
    mcpTools: params.mcpEnabled ? params.mcpTools : undefined,
    subAgentCodingEnabled: Boolean(params.subAgent?.codingEnabled),
  })
  if (tools.length === 0) throw new Error('runOpenRouterChatWithTools called with no tools enabled')

  const rawUserText = (params.rawUserText ?? getLastUserText(params.initialMessages)).trim()
  const codingContextEnabled = Boolean(params.subAgent?.codingEnabled)
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
    guardFalseImageClaims: params.toolsEnabled.runwareImage,
    guardFalseImageClaimsUserText: rawUserText,
    maxFalseImageClaimReprompts: MAX_REQUIRED_TOOL_REPROMPTS,
    appendFalseImageClaimReprompt: (messages) => {
      messages.push({
        role: 'user',
        content: FALSE_IMAGE_CLAIM_REPROMPT_MESSAGE,
      })
    },
    guardFalseMusicClaims: params.toolsEnabled.runwareMusic,
    guardFalseMusicClaimsUserText: rawUserText,
    maxFalseMusicClaimReprompts: MAX_REQUIRED_TOOL_REPROMPTS,
    appendFalseMusicClaimReprompt: (messages) => {
      messages.push({
        role: 'user',
        content: FALSE_MUSIC_CLAIM_REPROMPT_MESSAGE,
      })
    },
    guardFalseCodingClaims: params.toolsEnabled.coding && params.agentMode !== 'plan',
    guardFalseCodingClaimsUserText: rawUserText,
    maxFalseCodingClaimReprompts: MAX_REQUIRED_TOOL_REPROMPTS,
    appendFalseCodingClaimReprompt: (messages) => {
      messages.push({
        role: 'user',
        content: FALSE_CODING_CLAIM_REPROMPT_MESSAGE,
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
    toolPhaseForName: (name) => toolPhaseForAgentTool(name),
    onToolResult: params.onToolResult,
    onEscalateToPlan: params.onEscalateToPlan,
  })
}
