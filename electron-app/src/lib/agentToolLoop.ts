import type { OllamaChatUsage } from '@/lib/ollama'
import type { AgentToolUiPhase } from '@/lib/agentToolPhase'
import {
  CODING_ACTION_TOOLS,
  shouldGuardFalseCodingClaims,
  shouldGuardFalseImageClaims,
  shouldGuardFalseMusicClaims,
} from '@/lib/agentToolUtils'
import { sanitizeImageToolResultForLlm } from '@/lib/openrouterImage'

/** Strip all http(s) URLs from message content so the model can't recycle
 *  hallucinated URLs from previous rounds when it skips tool calls. */
function stripUrlsFromMessages(
  messages: Array<{ content?: string | unknown }>,
): void {
  const urlRegex = /https?:\/\/[^\s)>]+/g
  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      msg.content = msg.content.replace(urlRegex, '[URL removed]')
    }
  }
}

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
  /** When true, reprompt if the model claims an image URL/result without calling image tools. */
  guardFalseImageClaims?: boolean
  /** User-typed message for this turn (skip image guard on music requests). */
  guardFalseImageClaimsUserText?: string
  appendFalseImageClaimReprompt?: (messages: TMessage[]) => void
  maxFalseImageClaimReprompts?: number
  /** When true, reprompt if the model claims music/audio without calling generate_music_runware. */
  guardFalseMusicClaims?: boolean
  guardFalseMusicClaimsUserText?: string
  appendFalseMusicClaimReprompt?: (messages: TMessage[]) => void
  maxFalseMusicClaimReprompts?: number
  /** When true, reprompt if the model claims code was edited/saved/run without calling a mutating coding tool. */
  guardFalseCodingClaims?: boolean
  guardFalseCodingClaimsUserText?: string
  appendFalseCodingClaimReprompt?: (messages: TMessage[]) => void
  maxFalseCodingClaimReprompts?: number
  appendRuntimeRecalledImages?: (
    messages: TMessage[],
    recalled: Array<{ base64: string; mime: string }>,
  ) => void
  collectRecalledImages?: (ctx: {
    name: string
    argsRaw: string | Record<string, unknown> | undefined
    result: string
  }) => Array<{ base64: string; mime: string }> | Promise<Array<{ base64: string; mime: string }>>
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
  /** Optional deterministic trim of noisy tool results for the LLM only (UI still gets raw). */
  trimToolResultForLlm?: (name: string, resultForLlm: string) => string
  /**
   * Optional clearing of old, re-fetchable tool results (ToolOutputTrimmer pattern):
   * results from rounds older than `keepRecentRounds` are replaced with a placeholder.
   */
  oldToolResultClearing?: {
    keepRecentRounds: number
    minChars: number
    shouldClear: (name: string) => boolean
    placeholder: (name: string, chars: number) => string
  }
  parseArgsForToolResult?: (raw: string | Record<string, unknown> | undefined) => Record<string, unknown>
  onDelta: (fullText: string) => void
  onThinkingDelta?: (fullThinking: string) => void
  onToolPhase?: (phase: AgentToolUiPhase | null) => void
  toolPhaseForName?: (name: string) => AgentToolUiPhase | null
  onToolResult?: (payload: { name: string; result: string; args?: Record<string, unknown> }) => void
  /** Called when the agent requests to escalate into Plan mode (enter_plan_mode tool). The orchestrator flips the composer to Plan mode and re-sends as a plan turn. */
  onEscalateToPlan?: (ctx: { messages: TMessage[] }) => void
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

/** Clear streamed reply text only; thinking stays accumulated across tool rounds. */
function clearStreamedAssistantContent(params: { onDelta: (fullText: string) => void }) {
  params.onDelta('')
}

function appendThinkingRound(
  prefix: string,
  thinking: string,
): string {
  if (!thinking.trim()) return prefix
  return `${prefix}${thinking.trim()}\n\n---\n\n`
}

export async function runSharedToolLoop<
  TMessage extends { content?: string | unknown },
  TProviderToolCall,
>(
  params: SharedToolLoopParams<TMessage, TProviderToolCall>,
): Promise<{ content: string; usage?: OllamaChatUsage }> {
  const parseArgs = params.parseArgsForToolResult ?? defaultParseArgs
  const messages = [...params.initialMessages]
  const runtimeRecalledImages: Array<{ base64: string; mime: string }> = []
  let lastAssistantText = ''
  let persistedThinkingPrefix = ''
  let lastUsage: OllamaChatUsage | undefined
  let requiredToolRepromptCount = 0
  let falseImageClaimRepromptCount = 0
  let falseMusicClaimRepromptCount = 0
  let falseCodingClaimRepromptCount = 0
  let hasExecutedToolInTurn = false
  let hasExecutedImageToolInTurn = false
  let hasExecutedMusicToolInTurn = false
  let hasExecutedCodingToolInTurn = false
  const maxFalseImageClaimReprompts = params.maxFalseImageClaimReprompts ?? 2
  const maxFalseMusicClaimReprompts = params.maxFalseMusicClaimReprompts ?? 2
  const maxFalseCodingClaimReprompts = params.maxFalseCodingClaimReprompts ?? 2
  /** Tool-result message positions per round, for old-result clearing. */
  const toolResultRecords: Array<{ index: number; round: number; name: string; cleared: boolean }> = []

  for (let round = 0; round < params.maxToolRounds; round++) {
    if (params.signal?.aborted) throw abortedError()

    const clearing = params.oldToolResultClearing
    if (clearing && round > 0) {
      for (const rec of toolResultRecords) {
        if (rec.cleared) continue
        if (rec.round >= round - clearing.keepRecentRounds) continue
        if (!clearing.shouldClear(rec.name)) continue
        const msg = messages[rec.index] as { content?: unknown } | undefined
        if (!msg || typeof msg.content !== 'string') continue
        if (msg.content.length < clearing.minChars) continue
        msg.content = clearing.placeholder(rec.name, msg.content.length)
        rec.cleared = true
      }
    }

    const { content, thinking, toolCalls, usage } = await params.streamRound({
      messages,
      signal: params.signal,
      onDelta: (full) => {
        lastAssistantText = full
        params.onDelta(full)
      },
      onThinkingDelta: (fullRound) => {
        params.onThinkingDelta?.(`${persistedThinkingPrefix}${fullRound}`)
      },
    })

    lastAssistantText = content ?? lastAssistantText
    if (lastAssistantText) {
      params.onDelta(lastAssistantText)
    }
    if (thinking.trim()) {
      params.onThinkingDelta?.(`${persistedThinkingPrefix}${thinking}`)
    }

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
      stripUrlsFromMessages(messages)

      const handled = await params.onNoToolCalls?.({
        round,
        messages,
        thinking,
        hasExecutedToolInTurn,
        runSyntheticTool,
      })
      if (handled) {
        lastAssistantText = ''
        persistedThinkingPrefix = appendThinkingRound(persistedThinkingPrefix, thinking)
        clearStreamedAssistantContent(params)
        continue
      }

      const assistantText = (lastAssistantText || content).trim()
      if (
        params.guardFalseImageClaims &&
        params.appendFalseImageClaimReprompt &&
        !hasExecutedImageToolInTurn &&
        shouldGuardFalseImageClaims(assistantText, params.guardFalseImageClaimsUserText ?? '') &&
        falseImageClaimRepromptCount < maxFalseImageClaimReprompts
      ) {
        falseImageClaimRepromptCount += 1
        params.appendAssistantWithToolCalls({
          messages,
          content: assistantText,
          thinking,
          toolCalls: [],
        })
        params.appendFalseImageClaimReprompt(messages)
        lastAssistantText = ''
        persistedThinkingPrefix = appendThinkingRound(persistedThinkingPrefix, thinking)
        clearStreamedAssistantContent(params)
        continue
      }

      if (
        params.guardFalseMusicClaims &&
        params.appendFalseMusicClaimReprompt &&
        !hasExecutedMusicToolInTurn &&
        shouldGuardFalseMusicClaims(assistantText, params.guardFalseMusicClaimsUserText ?? '') &&
        falseMusicClaimRepromptCount < maxFalseMusicClaimReprompts
      ) {
        falseMusicClaimRepromptCount += 1
        params.appendAssistantWithToolCalls({
          messages,
          content: assistantText,
          thinking,
          toolCalls: [],
        })
        params.appendFalseMusicClaimReprompt(messages)
        lastAssistantText = ''
        persistedThinkingPrefix = appendThinkingRound(persistedThinkingPrefix, thinking)
        clearStreamedAssistantContent(params)
        continue
      }

      if (
        params.guardFalseCodingClaims &&
        params.appendFalseCodingClaimReprompt &&
        !hasExecutedCodingToolInTurn &&
        shouldGuardFalseCodingClaims(assistantText, params.guardFalseCodingClaimsUserText ?? '') &&
        falseCodingClaimRepromptCount < maxFalseCodingClaimReprompts
      ) {
        falseCodingClaimRepromptCount += 1
        params.appendAssistantWithToolCalls({
          messages,
          content: assistantText,
          thinking,
          toolCalls: [],
        })
        params.appendFalseCodingClaimReprompt(messages)
        lastAssistantText = ''
        persistedThinkingPrefix = appendThinkingRound(persistedThinkingPrefix, thinking)
        clearStreamedAssistantContent(params)
        continue
      }

      if (
        params.mustCallTool &&
        !hasExecutedToolInTurn &&
        requiredToolRepromptCount < params.maxRequiredToolReprompts
      ) {
        requiredToolRepromptCount += 1
        params.appendToolRequiredReprompt(messages)
        lastAssistantText = ''
        persistedThinkingPrefix = appendThinkingRound(persistedThinkingPrefix, thinking)
        clearStreamedAssistantContent(params)
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

    const planEscalation = validCalls.find((v) => v.shared.name === 'enter_plan_mode')
    if (planEscalation) {
      const shared = planEscalation.shared
      const call = planEscalation.provider
      const phase = params.toolPhaseForName?.('enter_plan_mode') ?? null
      params.onToolPhase?.(phase)
      const result = await params.executeToolCall('enter_plan_mode', shared.argsRaw)
      params.appendToolResult({
        messages,
        call,
        name: 'enter_plan_mode',
        result,
        round,
      })
      params.onToolResult?.({
        name: 'enter_plan_mode',
        result,
        args: parseArgs(shared.argsRaw),
      })
      params.onToolPhase?.(null)
      params.onEscalateToPlan?.({ messages })
      return { content: '', usage: lastUsage }
    }

    for (const valid of validCalls) {
      const shared = valid.shared
      const call = valid.provider
      const phase = params.toolPhaseForName?.(shared.name) ?? null
      params.onToolPhase?.(phase)
      const result = await params.executeToolCall(shared.name, shared.argsRaw)
      let resultForLlm = sanitizeImageToolResultForLlm(shared.name, result)
      if (params.trimToolResultForLlm) {
        resultForLlm = params.trimToolResultForLlm(shared.name, resultForLlm)
      }
      const beforeAppendLen = messages.length
      params.appendToolResult({
        messages,
        call,
        name: shared.name,
        result: resultForLlm,
        round,
      })
      for (let i = beforeAppendLen; i < messages.length; i++) {
        toolResultRecords.push({ index: i, round, name: shared.name, cleared: false })
      }
      hasExecutedToolInTurn = true
      if (shared.name === 'generate_image' || shared.name === 'edit_image_runware') {
        hasExecutedImageToolInTurn = true
      }
      if (shared.name === 'generate_music_runware') {
        hasExecutedMusicToolInTurn = true
      }
      if (CODING_ACTION_TOOLS.has(shared.name)) {
        hasExecutedCodingToolInTurn = true
      }
      params.onToolResult?.({
        name: shared.name,
        result,
        args: parseArgs(shared.argsRaw),
      })
      if (params.collectRecalledImages) {
        const recalled = await params.collectRecalledImages({
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
    lastAssistantText = ''
    persistedThinkingPrefix = appendThinkingRound(persistedThinkingPrefix, thinking)
    clearStreamedAssistantContent(params)
  }

  return { content: lastAssistantText, usage: lastUsage }
}
