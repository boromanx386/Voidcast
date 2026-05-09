import type { OllamaChatUsage } from '@/lib/ollama'
import type { AgentToolUiPhase } from '@/lib/agentToolPhase'

export type SharedToolCall = {
  name: string
  argsRaw: string | Record<string, unknown> | undefined
  raw: unknown
}

export type SharedToolLoopParams<TMessage, TProviderToolCall> = {
  initialMessages: TMessage[]
  maxToolRounds: number
  maxRequiredToolReprompts: number
  mustCallTool: boolean
  signal?: AbortSignal
  streamRound: (ctx: {
    messages: TMessage[]
    signal?: AbortSignal
    onDelta: (fullText: string) => void
    onThinkingDelta: (fullThinking: string) => void
  }) => Promise<{
    content: string
    thinking: string
    toolCalls: TProviderToolCall[]
    usage?: OllamaChatUsage
  }>
  toSharedToolCalls: (calls: TProviderToolCall[]) => SharedToolCall[]
  appendAssistantWithToolCalls: (ctx: {
    messages: TMessage[]
    content: string
    thinking: string
    toolCalls: TProviderToolCall[]
  }) => void
  appendToolResult: (ctx: {
    messages: TMessage[]
    call: TProviderToolCall
    name: string
    result: string
    round: number
  }) => void
  appendToolRequiredReprompt: (messages: TMessage[]) => void
  appendRuntimeRecalledImages?: (
    messages: TMessage[],
    recalled: Array<{ base64: string; mime: string }>,
  ) => void
  collectRecalledImages?: (ctx: {
    name: string
    argsRaw: string | Record<string, unknown> | undefined
    result: string
  }) => Array<{ base64: string; mime: string }>
  onNoToolCalls?: (ctx: {
    round: number
    messages: TMessage[]
    thinking: string
    hasExecutedToolInTurn: boolean
    runSyntheticTool: (
      name: string,
      argsRaw: string | Record<string, unknown> | undefined,
      callFactory: () => TProviderToolCall,
    ) => Promise<void>
  }) => Promise<boolean>
  executeToolCall: (name: string, argsRaw: string | Record<string, unknown> | undefined) => Promise<string>
  parseArgsForToolResult?: (raw: string | Record<string, unknown> | undefined) => Record<string, unknown>
  onDelta: (fullText: string) => void
  onThinkingDelta?: (fullThinking: string) => void
  onToolPhase?: (phase: AgentToolUiPhase | null) => void
  toolPhaseForName?: (name: string) => AgentToolUiPhase | null
  onToolResult?: (payload: { name: string; result: string; args?: Record<string, unknown> }) => void
}

function defaultParseArgs(
  raw: string | Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!raw) return {}
  if (typeof raw === 'object') return raw
  const s = String(raw).trim()
  if (!s) return {}
  try {
    return JSON.parse(s) as Record<string, unknown>
  } catch {
    return {}
  }
}

function abortedError(): Error {
  const err = new Error('Aborted')
  err.name = 'AbortError'
  return err
}

export async function runSharedToolLoop<TMessage, TProviderToolCall>(
  params: SharedToolLoopParams<TMessage, TProviderToolCall>,
): Promise<{ content: string; usage?: OllamaChatUsage }> {
  const parseArgs = params.parseArgsForToolResult ?? defaultParseArgs
  const messages = [...params.initialMessages]
  const runtimeRecalledImages: Array<{ base64: string; mime: string }> = []
  let lastAssistantText = ''
  let persistedAssistantPrefix = ''
  let persistedThinkingPrefix = ''
  let lastUsage: OllamaChatUsage | undefined
  let requiredToolRepromptCount = 0
  let hasExecutedToolInTurn = false

  for (let round = 0; round < params.maxToolRounds; round++) {
    if (params.signal?.aborted) throw abortedError()

    const { content, thinking, toolCalls, usage } = await params.streamRound({
      messages,
      signal: params.signal,
      onDelta: (full) => {
        const combined = `${persistedAssistantPrefix}${full}`
        lastAssistantText = combined
        params.onDelta(combined)
      },
      onThinkingDelta: (fullRound) => {
        const combined = `${persistedThinkingPrefix}${fullRound}`
        params.onThinkingDelta?.(combined)
      },
    })

    lastUsage = usage ?? lastUsage
    const sharedCalls = params.toSharedToolCalls(toolCalls)
    const validCalls = sharedCalls
      .filter((x) => Boolean(x.name))
      .map((x) => ({ shared: x, provider: x.raw as TProviderToolCall }))

    const runSyntheticTool = async (
      name: string,
      argsRaw: string | Record<string, unknown> | undefined,
      callFactory: () => TProviderToolCall,
    ) => {
      const result = await params.executeToolCall(name, argsRaw)
      const syntheticCall = callFactory()
      params.appendAssistantWithToolCalls({
        messages,
        content: '',
        thinking: '',
        toolCalls: [syntheticCall],
      })
      params.appendToolResult({
        messages,
        call: syntheticCall,
        name,
        result,
        round,
      })
      hasExecutedToolInTurn = true
      params.onToolResult?.({ name, result, args: parseArgs(argsRaw) })
    }

    if (validCalls.length === 0) {
      const handled = await params.onNoToolCalls?.({
        round,
        messages,
        thinking,
        hasExecutedToolInTurn,
        runSyntheticTool,
      })
      if (handled) {
        persistedAssistantPrefix = lastAssistantText
        if (persistedAssistantPrefix.trim() && !persistedAssistantPrefix.endsWith('\n\n')) {
          persistedAssistantPrefix = `${persistedAssistantPrefix.trimEnd()}\n\n`
        }
        if (thinking.trim()) {
          persistedThinkingPrefix += `${thinking.trim()}\n\n---\n\n`
        }
        continue
      }

      if (
        params.mustCallTool &&
        !hasExecutedToolInTurn &&
        requiredToolRepromptCount < params.maxRequiredToolReprompts
      ) {
        requiredToolRepromptCount += 1
        params.appendToolRequiredReprompt(messages)
        persistedAssistantPrefix = lastAssistantText
        if (persistedAssistantPrefix.trim() && !persistedAssistantPrefix.endsWith('\n\n')) {
          persistedAssistantPrefix = `${persistedAssistantPrefix.trimEnd()}\n\n`
        }
        if (thinking.trim()) {
          persistedThinkingPrefix += `${thinking.trim()}\n\n---\n\n`
        }
        continue
      }
      if (params.mustCallTool && !hasExecutedToolInTurn) {
        throw new Error('Tool-required request was answered without invoking any tool.')
      }
      return { content: lastAssistantText || content, usage: lastUsage }
    }

    params.appendAssistantWithToolCalls({
      messages,
      content: content ?? '',
      thinking,
      toolCalls,
    })

    for (const valid of validCalls) {
      const shared = valid.shared
      const call = valid.provider
      const phase = params.toolPhaseForName?.(shared.name) ?? null
      params.onToolPhase?.(phase)
      const result = await params.executeToolCall(shared.name, shared.argsRaw)
      params.appendToolResult({
        messages,
        call,
        name: shared.name,
        result,
        round,
      })
      hasExecutedToolInTurn = true
      params.onToolResult?.({
        name: shared.name,
        result,
        args: parseArgs(shared.argsRaw),
      })
      if (params.collectRecalledImages) {
        const recalled = params.collectRecalledImages({
          name: shared.name,
          argsRaw: shared.argsRaw,
          result,
        })
        if (recalled.length) runtimeRecalledImages.push(...recalled)
      }
    }

    if (runtimeRecalledImages.length > 0 && params.appendRuntimeRecalledImages) {
      const consumed = runtimeRecalledImages.splice(0, runtimeRecalledImages.length)
      params.appendRuntimeRecalledImages(messages, consumed)
    }

    params.onToolPhase?.(null)
    persistedAssistantPrefix = lastAssistantText
    if (persistedAssistantPrefix.trim() && !persistedAssistantPrefix.endsWith('\n\n')) {
      persistedAssistantPrefix = `${persistedAssistantPrefix.trimEnd()}\n\n`
    }
    if (thinking.trim()) {
      persistedThinkingPrefix += `${thinking.trim()}\n\n---\n\n`
    }
  }

  return { content: lastAssistantText, usage: lastUsage }
}
