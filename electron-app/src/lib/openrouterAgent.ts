import { buildOllamaToolsList } from '@/lib/toolDefinitions'
import type { ToolsEnabled } from '@/lib/settings'
import type { OllamaApiMessage, OllamaChatUsage, OllamaModelOptions } from '@/lib/ollama'
import type { RunwareImageConfig } from '@/lib/runware'
import {
  ollamaMessagesToOpenRouter,
  streamOpenRouterChat,
  type OpenRouterMessage,
  type OpenRouterToolCall,
} from '@/lib/openrouter'
import { executeToolCall } from '@/lib/agentToolExecutor'
import { toolPhaseForAgentTool, type AgentToolUiPhase } from '@/lib/agentToolPhase'
import { runSharedToolLoop } from '@/lib/agentToolLoop'
import {
  getLastUserText,
  parseToolArguments,
  shouldRequireToolCall,
} from '@/lib/agentToolUtils'

const MAX_TOOL_ROUNDS = 18
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
}

export async function runOpenRouterChatWithTools(
  params: RunOpenRouterChatWithToolsParams,
): Promise<{ content: string; usage?: OllamaChatUsage }> {
  const tools = buildOllamaToolsList(params.toolsEnabled)
  if (tools.length === 0) throw new Error('runOpenRouterChatWithTools called with no tools enabled')

  const initialMessages: OpenRouterMessage[] = ollamaMessagesToOpenRouter(params.initialMessages)
  const originalUserText = getLastUserText(params.initialMessages)
  const mustCallTool = shouldRequireToolCall(originalUserText, params.toolsEnabled)
  return runSharedToolLoop<OpenRouterMessage, OpenRouterToolCall>({
    initialMessages,
    maxToolRounds: MAX_TOOL_ROUNDS,
    maxRequiredToolReprompts: MAX_REQUIRED_TOOL_REPROMPTS,
    mustCallTool,
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
    appendToolRequiredReprompt: (messages) => {
      messages.push({
        role: 'user',
        content:
          'Tool call required: do not answer with plain text. Call the appropriate available tool now and only then provide the final answer from real tool output.',
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
    collectRecalledImages: ({ name, result }) => {
      if (name !== 'image_recall') return []
      let parsed: unknown
      try {
        parsed = JSON.parse(result)
      } catch {
        parsed = null
      }
      const payload = parsed as { recalled_images?: Array<{ index: number; mime: string }> } | null
      if (!payload?.recalled_images?.length) return []
      const recalled: Array<{ base64: string; mime: string }> = []
      for (const ref of payload.recalled_images) {
        const oneBased = Math.round(ref.index) - 1
        if (oneBased < 0) continue
        const base64 = params.userImages?.[oneBased]
        if (!base64) continue
        recalled.push({ base64, mime: ref.mime || 'image/png' })
      }
      return recalled
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
      }),
    parseArgsForToolResult: parseToolArguments,
    onDelta: params.onDelta,
    onThinkingDelta: params.onThinkingDelta,
    onToolPhase: params.onToolPhase,
    toolPhaseForName: (name) => toolPhaseForAgentTool(name),
    onToolResult: params.onToolResult,
  })
}
