import {
  AGENT_MAX_TOOL_ROUNDS_DEFAULT,
  clampAgentMaxToolRounds,
  normalizeBaseUrl,
  type LlmThinkLevel,
} from '@/lib/settings'
import { buildToolsList } from '@/lib/toolDefinitions'
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
import type {
  OllamaApiMessage,
  OllamaChatUsage,
  OllamaModelOptions,
  OllamaToolCall,
} from '@/lib/ollama'
import {
  fetchOllamaWithRetry,
  isThinkingUiEnabled,
  mergeOllamaUsage,
  parseChatStreamUsage,
  toOllamaThinkBodyValue,
} from '@/lib/ollama'
import { toolPhaseForAgentTool } from '@/lib/agentToolPhase'
import { runSharedToolLoop } from '@/lib/agentToolLoop'
import { executeToolCall, resolveImageRecallRequest } from '@/lib/agentToolExecutor'
import {
  deriveSearchQuery,
  FALSE_CODING_CLAIM_REPROMPT_MESSAGE,
  FALSE_IMAGE_CLAIM_REPROMPT_MESSAGE,
  FALSE_MUSIC_CLAIM_REPROMPT_MESSAGE,
  getLastUserText,
  pickFirstHttpUrl,
  shouldForceWebSearchOnRoundZero,
  TOOL_BUDGET_EXHAUSTED_REPROMPT_MESSAGE,
  TOOL_BUDGET_WARNING_REPROMPT_MESSAGE,
} from '@/lib/agentToolUtils'

const MAX_REQUIRED_TOOL_REPROMPTS = 2

function compactModelOptions(
  o: OllamaModelOptions | undefined,
): Record<string, number> | undefined {
  if (!o) return undefined
  const out: Record<string, number> = {}
  if (o.temperature !== undefined) out.temperature = o.temperature
  if (o.num_ctx !== undefined) out.num_ctx = o.num_ctx
  return Object.keys(out).length ? out : undefined
}

/** Merge streaming tool_call fragments (by index) into accumulated array */
function mergeToolCallDeltas(
  acc: OllamaToolCall[],
  incoming: OllamaToolCall[] | undefined,
): void {
  if (!incoming?.length) return
  for (const delta of incoming) {
    const idx =
      typeof delta.index === 'number'
        ? delta.index
        : Math.max(0, acc.length - 1)
    while (acc.length <= idx) {
      acc.push({ function: {} })
    }
    const cur = acc[idx]
    if (!cur.function) cur.function = {}
    if (delta.function?.name) cur.function.name = delta.function.name
    if (delta.function?.arguments != null) {
      const arg = delta.function.arguments
      if (typeof arg === 'object' && arg !== null && !Array.isArray(arg)) {
        cur.function.arguments = JSON.stringify(arg)
      } else {
        cur.function.arguments =
          (typeof cur.function.arguments === 'string' ? cur.function.arguments : '') +
          String(arg)
      }
    }
    if (delta.id) cur.id = delta.id
    if (delta.type) cur.type = delta.type
    if (typeof delta.index === 'number') cur.index = delta.index
  }
}

/**
 * Ollama expects `tool_calls[].function.arguments` as a JSON **object** in the
 * request body. After streaming, arguments are often a string; replaying that
 * string breaks the server parser ("can't find closing '}' symbol").
 */
function argumentsStringToObject(
  raw: string | Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (raw == null) return {}
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>
  }
  const s = String(raw).trim()
  if (!s) return {}
  try {
    const v = JSON.parse(s) as unknown
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return v as Record<string, unknown>
    }
  } catch {
    /* incomplete or invalid JSON from stream */
  }
  return {}
}
function normalizeToolCallsForReplay(calls: OllamaToolCall[]): OllamaToolCall[] {
  return calls
    .filter((t) => t.function?.name)
    .map((tc) => ({
      id: tc.id,
      type: 'function' as const,
      index: tc.index,
      function: {
        name: tc.function!.name,
        arguments: argumentsStringToObject(tc.function!.arguments),
      },
    }))
}
/**
 * One streaming /api/chat round; accumulates assistant content and tool_calls.
 */
export async function streamOllamaChatOnce(options: {
  baseUrl: string
  model: string
  messages: OllamaApiMessage[]
  modelOptions?: OllamaModelOptions
  tools: unknown[] | undefined
  signal?: AbortSignal
  onDelta: (fullText: string) => void
  thinkLevel?: LlmThinkLevel
  onThinkingDelta?: (fullThinking: string) => void
}): Promise<{
  content: string
  thinking: string
  tool_calls: OllamaToolCall[]
  usage?: OllamaChatUsage
}> {
  const root = normalizeBaseUrl(options.baseUrl)
  const opts = compactModelOptions(options.modelOptions)
  const body: Record<string, unknown> = {
    model: options.model,
    messages: options.messages,
    stream: true,
  }
  if (opts) body.options = opts
  if (options.tools !== undefined && options.tools.length > 0) {
    body.tools = options.tools
  }
  body.think = toOllamaThinkBodyValue(options.thinkLevel ?? 'off')
  const streamThinking = isThinkingUiEnabled(options.thinkLevel ?? 'off')

  const res = await fetchOllamaWithRetry(
    `${root}/api/chat`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: options.signal,
      body: JSON.stringify(body),
    },
    options.signal,
  )
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`Ollama /api/chat ${res.status}: ${errText || res.statusText}`)
  }
  if (!res.body) throw new Error('No response body')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let fullContent = ''
  let fullThinking = ''
  const toolCalls: OllamaToolCall[] = []
  let usage: OllamaChatUsage | undefined

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      let obj: unknown
      try {
        obj = JSON.parse(trimmed)
      } catch {
        continue
      }
      const chunk = obj as {
        message?: {
          content?: string
          thinking?: string
          tool_calls?: OllamaToolCall[]
        }
        error?: string
      }
      if (chunk.error) throw new Error(chunk.error)
      usage = mergeOllamaUsage(usage, parseChatStreamUsage(obj))
      const msg = chunk.message
      if (msg?.tool_calls?.length) {
        mergeToolCallDeltas(toolCalls, msg.tool_calls)
      }
      const thinkPiece = msg?.thinking
      if (thinkPiece && streamThinking) {
        fullThinking += thinkPiece
        options.onThinkingDelta?.(fullThinking)
      }
      const piece = msg?.content
      if (piece) {
        fullContent += piece
        options.onDelta(fullContent)
      }
    }
  }
  const tail = buffer.trim()
  if (tail) {
    try {
      const last = JSON.parse(tail) as {
        message?: {
          content?: string
          thinking?: string
          tool_calls?: OllamaToolCall[]
        }
        error?: string
      }
      if (last.error) throw new Error(last.error)
      usage = mergeOllamaUsage(usage, parseChatStreamUsage(last))
      if (last.message?.tool_calls?.length) {
        mergeToolCallDeltas(toolCalls, last.message.tool_calls)
      }
      const thinkPiece = last.message?.thinking
      if (thinkPiece && streamThinking) {
        fullThinking += thinkPiece
        options.onThinkingDelta?.(fullThinking)
      }
      const piece = last.message?.content
      if (piece) {
        fullContent += piece
        options.onDelta(fullContent)
      }
    } catch {
      /* ignore */
    }
  }

  return {
    content: fullContent,
    thinking: fullThinking,
    tool_calls: toolCalls.filter((t) => Boolean(t.function?.name)),
    usage,
  }
}

export type RunChatWithToolsParams = ChatWithToolsCommonParams & {
  /** Called when the agent requests to escalate into Plan mode (enter_plan_mode tool). */
  onEscalateToPlan?: (ctx: { messages: OllamaApiMessage[] }) => void
}

/**
 * Agent loop: stream, run tools, append tool messages, repeat until text reply or cap.
 */
export async function runOllamaChatWithTools(
  params: RunChatWithToolsParams,
): Promise<{ content: string; usage?: OllamaChatUsage }> {
  const tools = buildToolsList(params.toolsEnabled, Boolean(params.skillsEnabled), {
    agentMode: params.agentMode,
    mcpTools: params.mcpEnabled ? params.mcpTools : undefined,
    subAgentCodingEnabled: Boolean(params.subAgent?.codingEnabled),
  })
  if (tools.length === 0) {
    throw new Error('runOllamaChatWithTools called with no tools enabled')
  }
  let forcedWebDone = false
  let forcedScrapeDone = false
  const rawUserText = (params.rawUserText ?? getLastUserText(params.initialMessages)).trim()
  const originalUserUrl = pickFirstHttpUrl(rawUserText)
  const originalNeedsFresh = shouldForceWebSearchOnRoundZero(rawUserText, params.toolsEnabled)
  const codingContextEnabled = Boolean(params.subAgent?.codingEnabled)
  return runSharedToolLoop<OllamaApiMessage, OllamaToolCall>({
    initialMessages: [...params.initialMessages],
    maxToolRounds: clampAgentMaxToolRounds(
      params.maxToolRounds ?? AGENT_MAX_TOOL_ROUNDS_DEFAULT,
    ),
    maxRequiredToolReprompts: MAX_REQUIRED_TOOL_REPROMPTS,
    mustCallTool: false,
    signal: params.signal,
    streamRound: async ({ messages, signal, onDelta, onThinkingDelta }) => {
      const out = await streamOllamaChatOnce({
        baseUrl: params.baseUrl,
        model: params.model,
        messages,
        modelOptions: params.modelOptions,
        tools,
        signal,
        thinkLevel: params.thinkLevel,
        onDelta,
        onThinkingDelta: params.thinkLevel && isThinkingUiEnabled(params.thinkLevel)
          ? onThinkingDelta
          : undefined,
      })
      return {
        content: out.content,
        thinking: out.thinking,
        toolCalls: out.tool_calls,
        usage: out.usage,
      }
    },
    toSharedToolCalls: (calls) =>
      calls
        .filter((t) => t.function?.name)
        .map((call) => ({ name: call.function!.name!, argsRaw: call.function!.arguments, raw: call })),
    appendAssistantWithToolCalls: ({ messages, content, thinking, toolCalls }) => {
      const includeThinking =
        params.thinkLevel != null && isThinkingUiEnabled(params.thinkLevel)
      messages.push({
        role: 'assistant',
        content: content ?? '',
        ...(includeThinking && thinking.trim() ? { thinking } : {}),
        tool_calls: normalizeToolCallsForReplay(toolCalls.filter((t) => t.function?.name)),
      })
    },
    appendToolResult: ({ messages, name, result }) => {
      messages.push({
        role: 'tool',
        tool_name: name,
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
        content: 'Image recall payload for current turn.',
        images: recalled.map((x) => x.base64),
      })
    },
    collectRecalledImages: async ({ name, argsRaw }) => {
      if (name !== 'image_recall') return []
      // When vision sub-agent is active, descriptions are already in the tool result —
      // do NOT push base64 into messages (main model can't use them).
      if (params.subAgent?.enabled) return []
      const argsObj = argumentsStringToObject(argsRaw)
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
    onNoToolCalls: async ({ round, runSyntheticTool }) => {
      if (round !== 0) return false
      if (
        !forcedScrapeDone &&
        params.toolsEnabled.scrape &&
        typeof originalUserUrl === 'string' &&
        originalUserUrl.length > 0
      ) {
        forcedScrapeDone = true
        params.onToolPhase?.('scrape')
        await runSyntheticTool(
          'scrape_url',
          { url: originalUserUrl, max_chars: 40000 },
          () => ({
            type: 'function',
            function: {
              name: 'scrape_url',
              arguments: { url: originalUserUrl, max_chars: 40000 },
            },
          }),
        )
        params.onToolPhase?.(null)
        return true
      }
      if (!forcedWebDone && params.toolsEnabled.webSearch && originalNeedsFresh) {
        const forcedQuery = deriveSearchQuery(rawUserText)
        if (forcedQuery) {
          forcedWebDone = true
          params.onToolPhase?.('search')
          await runSyntheticTool(
            'web_search',
            { query: forcedQuery },
            () => ({
              type: 'function',
              function: {
                name: 'web_search',
                arguments: { query: forcedQuery },
              },
            }),
          )
          params.onToolPhase?.(null)
          return true
        }
      }
      return false
    },
    executeToolCall: (name, argsRaw) =>
      executeToolCall(
        name,
        argsRaw,
        params.toolsEnabled,
        buildToolExecutorOptions({ ...params, rawUserText }),
      ),
    parseArgsForToolResult: argumentsStringToObject,
    onDelta: params.onDelta,
    onThinkingDelta:
      params.thinkLevel && isThinkingUiEnabled(params.thinkLevel)
        ? params.onThinkingDelta
        : undefined,
    onToolPhase: params.onToolPhase,
    onIntermediateResponse: params.onIntermediateResponse,
    onToolStart: params.onToolStart,
    onToolFinish: params.onToolFinish,
    toolPhaseForName: (name) => toolPhaseForAgentTool(name),
    onToolResult: params.onToolResult,
    onEscalateToPlan: params.onEscalateToPlan,
  })
}
