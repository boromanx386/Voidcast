import type { OllamaChatUsage } from '@/lib/ollama'
import type { AgentToolUiPhase } from '@/lib/agentToolPhase'
import {
  isParallelSafeAgentTool,
  isSuccessfulRepoActionTool,
  TOOL_BUDGET_EXHAUSTED_FALLBACK_REPLY,
  TOOL_BUDGET_NO_REPO_ACTION_FALLBACK_REPLY,
} from '@/lib/agentToolUtils'
import { shouldEvictOldToolResult } from '@/lib/codingSubAgent'
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

/**
 * Fallback text when an ephemeral image payload is dropped and no per-image
 * digest is available.
 */
export const RECALLED_IMAGE_PLACEHOLDER =
  '[Recalled image payload was shown in an earlier round. Call image_recall again if you need to look at the image.]'

/** Header for the digest block that replaces dropped image pixels. */
export const RECALLED_IMAGE_DIGEST_HEADER =
  '[Raw image pixels were dropped from this turn to save context. What you looked at:]'

/** Carried by the raw recalled-image payload itself (agents append it). */
export const RECALLED_IMAGE_ROUND_MESSAGE =
  'Recalled image payload for this round — inspect the attached image(s) and continue. Call image_recall again if you need another look later.'

/** A recalled image pushed into the conversation for one round. */
export type RecalledImagePayload = {
  base64: string
  mime: string
  /** One-line digest left in place once the pixels are dropped. */
  digest?: string
}

/**
 * Remove raw image bytes from a recalled-image message IN PLACE, leaving a text
 * digest (preferred) or a generic placeholder. Handles both provider shapes:
 *   - Ollama: `content: string` + `images: string[]`
 *   - OpenRouter: `content: [{type:'text'},{type:'image_url'}]`
 * Message count and positions are preserved, so index bookkeeping
 * (toolResultRecords) stays valid.
 */
function stripRecalledImagePayload(
  msg: {
    content?: unknown
    images?: unknown[]
  },
  replacement?: string,
): boolean {
  const text = replacement?.trim() || RECALLED_IMAGE_PLACEHOLDER
  const hasImageField = Array.isArray(msg.images) && msg.images.length > 0
  const parts = Array.isArray(msg.content)
    ? (msg.content as Array<{ type?: string; text?: string }>)
    : null
  const hasImageParts = parts?.some((p) => p?.type === 'image_url') ?? false
  if (!hasImageField && !hasImageParts) return false

  if (hasImageField) msg.images = []

  if (parts && hasImageParts) {
    const kept = parts.filter((p) => p?.type !== 'image_url')
    const textPart = kept.find((p) => p?.type === 'text')
    if (textPart) textPart.text = text
    else kept.unshift({ type: 'text', text })
    msg.content = kept
  } else if (hasImageField) {
    msg.content = text
  }
  return true
}

export type SharedToolCall = {
  name: string
  argsRaw: string | Record<string, unknown> | undefined
  raw: unknown
}

export type SharedToolLoopParams<TMessage, TProviderToolCall> = {
  initialMessages: TMessage[]
  maxToolRounds: number
  /** Maximum number of adjacent read-only tool calls executed concurrently. */
  maxParallelToolCalls?: number
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
  /**
   * Soft nudge when two rounds remain: prefer wrapping up soon.
   * Called at most once per turn (entering maxToolRounds - 2).
   */
  appendToolBudgetWarningReprompt?: (messages: TMessage[]) => void
  /**
   * Hard wrap-up after the tool budget is exhausted without a final text reply.
   * Loop will stream one more round and ignore further tool calls.
   */
  appendToolBudgetExhaustedReprompt?: (messages: TMessage[]) => void
  /**
   * When true (Agent/Team + coding), budget wrap-up must not present model prose as
   * repo work unless a successful file/shell/git mutation occurred this turn.
   */
  guardRepoActionTruth?: boolean
  appendRuntimeRecalledImages?: (
    messages: TMessage[],
    recalled: RecalledImagePayload[],
  ) => void
  collectRecalledImages?: (ctx: {
    name: string
    argsRaw: string | Record<string, unknown> | undefined
    result: string
  }) => RecalledImagePayload[] | Promise<RecalledImagePayload[]>
  /**
   * How many streamRound calls may carry the raw recalled-image base64 payload.
   * 1 (default) = ephemeral: the model sees the image in the round right after
   * image_recall, then the bytes are replaced by the digest carried on
   * {@link RecalledImagePayload.digest} (or a generic placeholder).
   * 0 = never inject raw bytes (text-only recall). < 0 = legacy (bytes stay for
   * the whole turn).
   */
  keepRecalledImageRounds?: number
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
    /** Per-tool override for how many recent rounds to keep full (e.g. read_file longer). */
    keepRecentRoundsByTool?: Record<string, number>
    /**
     * Always keep the last N results of this tool full (most recent by round/index),
     * even if they fall outside keepRecentRounds — used to pin working-set reads.
     */
    pinRecentByTool?: Record<string, number>
    minChars: number
    shouldClear: (name: string) => boolean
    /** Replaces cleared body; `content` is the full result about to be evicted. */
    placeholder: (name: string, chars: number, content: string) => string
  }
  parseArgsForToolResult?: (raw: string | Record<string, unknown> | undefined) => Record<string, unknown>
  onDelta: (fullText: string) => void
  onThinkingDelta?: (fullThinking: string) => void
  onToolPhase?: (phase: AgentToolUiPhase | null) => void
  toolPhaseForName?: (name: string) => AgentToolUiPhase | null
  /** Captures a streamed draft before the next tool round replaces it. */
  onIntermediateResponse?: (ctx: { round: number; content: string }) => void
  /** Lifecycle callbacks for rendering multiple concurrent tool calls. */
  onToolStart?: (ctx: { id: string; name: string; phase: AgentToolUiPhase | null }) => void
  onToolFinish?: (ctx: { id: string; name: string; phase: AgentToolUiPhase | null }) => void
  onToolResult?: (payload: { name: string; result: string; args?: Record<string, unknown> }) => void
  /** Called at the start of each tool round; returns a user message to inject (e.g. working-set cache). Empty string = skip. */
  injectWorkingSet?: (unclearedPaths: string[]) => string
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

function preserveIntermediateResponse<TMessage>(
  params: Pick<SharedToolLoopParams<TMessage, unknown>, 'onIntermediateResponse'>,
  round: number,
  content: string,
): void {
  const trimmed = content.trim()
  if (!trimmed) return
  params.onIntermediateResponse?.({ round, content: trimmed })
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
  const runtimeRecalledImages: RecalledImagePayload[] = []
  let lastAssistantText = ''
  let persistedThinkingPrefix = ''
  let lastUsage: OllamaChatUsage | undefined
  let requiredToolRepromptCount = 0
  let hasExecutedToolInTurn = false
  let hasExecutedRepoActionInTurn = false
  const maxParallelToolCalls = Number.isFinite(params.maxParallelToolCalls)
    ? Math.max(1, Math.floor(params.maxParallelToolCalls!))
    : 4
  /** Tool-result message positions per round, for old-result clearing. */
  const toolResultRecords: Array<{ index: number; round: number; name: string; cleared: boolean }> = []
  /** Recalled-image message positions per round, for ephemeral image payloads. */
  const recalledImageRecords: Array<{
    index: number
    round: number
    cleared: boolean
    /** Digest block left in place once the raw pixels are dropped. */
    digest?: string
  }> = []
  /** How many streamRound calls may carry raw recalled-image base64 (1 = ephemeral). */
  const keepRecalledImageRounds = params.keepRecalledImageRounds ?? 1

  for (let round = 0; round < params.maxToolRounds; round++) {
    if (params.signal?.aborted) throw abortedError()

    if (
      params.appendToolBudgetWarningReprompt &&
      hasExecutedToolInTurn &&
      round === params.maxToolRounds - 2 &&
      params.maxToolRounds >= 3
    ) {
      params.appendToolBudgetWarningReprompt(messages)
    }

    const clearing = params.oldToolResultClearing
    if (clearing && round > 0) {
      for (const rec of toolResultRecords) {
        if (rec.cleared) continue
        if (
          !shouldEvictOldToolResult({
            rec,
            currentRound: round,
            keepRecentRounds: clearing.keepRecentRounds,
            keepRecentRoundsByTool: clearing.keepRecentRoundsByTool,
            pinRecentByTool: clearing.pinRecentByTool,
            allRecords: toolResultRecords,
          })
        ) {
          continue
        }
        if (!clearing.shouldClear(rec.name)) continue
        const msg = messages[rec.index] as { content?: unknown } | undefined
        if (!msg || typeof msg.content !== 'string') continue
        if (msg.content.length < clearing.minChars) continue
        msg.content = clearing.placeholder(rec.name, msg.content.length, msg.content)
        rec.cleared = true
      }
    }

    // Ephemeral recalled-image payloads. Raw base64 must reach the model once so it
    // can actually see the image, but re-sending it on every later round is what
    // inflates the context. The payload was pushed at the END of round N, so round
    // N+1 is the first request that carries it; strip before round N+2.
    if (keepRecalledImageRounds >= 0 && round > 0) {
      for (const rec of recalledImageRecords) {
        if (rec.cleared) continue
        if (round - rec.round <= keepRecalledImageRounds) continue
        const msg = messages[rec.index] as
          | { content?: unknown; images?: unknown[] }
          | undefined
        if (msg) stripRecalledImagePayload(msg, rec.digest)
        rec.cleared = true
      }
    }

    // Inject working-set cache at top of each round so the model sees current file contents.
    const inject = params.injectWorkingSet
    if (inject && round > 0) {
      const uncleared = toolResultRecords
        .filter((r) => !r.cleared && (r.name === 'read_file' || r.name === 'find_symbols'))
        .map((r) => {
          const msg = messages[r.index] as { content?: unknown } | undefined
          if (typeof msg?.content === 'string') {
            // Extract file path from content (first line typically has the path).
            const firstLine = msg.content.split('\n')[0]
            const m = firstLine?.match(/^\[File:?\s*(.+?)\]/) ?? firstLine?.match(/^(\S+?):/)
            return m ? m[1].trim() : ''
          }
          return ''
        })
        .filter(Boolean)
      const hint = inject(uncleared)
      if (hint) {
        messages.push({ role: 'user', content: hint } as unknown as TMessage)
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

    const executeToolCallSafely = async (
      name: string,
      argsRaw: string | Record<string, unknown> | undefined,
    ): Promise<string> => {
      try {
        return await params.executeToolCall(name, argsRaw)
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          throw error
        }
        const message = error instanceof Error ? error.message : String(error)
        return `Error: ${message}`
      }
    }

    const executeToolCallWithActivity = async (
      name: string,
      argsRaw: string | Record<string, unknown> | undefined,
      id: string,
    ) => {
      const phase = params.toolPhaseForName?.(name) ?? null
      params.onToolPhase?.(phase)
      params.onToolStart?.({ id, name, phase })
      try {
        return await executeToolCallSafely(name, argsRaw)
      } finally {
        params.onToolFinish?.({ id, name, phase })
      }
    }

    const runSyntheticTool = async (
      name: string,
      argsRaw: string | Record<string, unknown> | undefined,
      callFactory: () => TProviderToolCall,
    ) => {
      const result = await executeToolCallWithActivity(
        name,
        argsRaw,
        `round-${round}-synthetic-${name}`,
      )
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
        preserveIntermediateResponse(params, round, lastAssistantText || content)
        lastAssistantText = ''
        persistedThinkingPrefix = appendThinkingRound(persistedThinkingPrefix, thinking)
        clearStreamedAssistantContent(params)
        continue
      }

      const assistantText = (lastAssistantText || content).trim()
      if (
        params.mustCallTool &&
        !hasExecutedToolInTurn &&
        requiredToolRepromptCount < params.maxRequiredToolReprompts
      ) {
        requiredToolRepromptCount += 1
        params.appendToolRequiredReprompt(messages)
        preserveIntermediateResponse(params, round, assistantText)
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
      const result = await executeToolCallWithActivity(
        'enter_plan_mode',
        shared.argsRaw,
        `round-${round}-plan`,
      )
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
      // Refuse (e.g. Team mode) must not flip the composer into Plan.
      const refused = /^\s*error\s*:/i.test(result.trim())
      if (refused) {
        hasExecutedToolInTurn = true
        continue
      }
      params.onEscalateToPlan?.({ messages })
      // Keep the pre-escalation draft instead of discarding it: the UI can show it
      // as a "plan handoff" note rather than making the answer vanish.
      return { content: lastAssistantText || content, usage: lastUsage }
    }

    preserveIntermediateResponse(params, round, content ?? lastAssistantText)

    const executeToolCallForLoop = async (
      valid: (typeof validCalls)[number],
      index: number,
    ) => {
      return executeToolCallWithActivity(
        valid.shared.name,
        valid.shared.argsRaw,
        `round-${round}-tool-${index}`,
      )
    }

    const commitToolResult = async (
      valid: (typeof validCalls)[number],
      result: string,
    ) => {
      const shared = valid.shared
      const call = valid.provider
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
      if (isSuccessfulRepoActionTool(shared.name, result)) {
        hasExecutedRepoActionInTurn = true
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

    // Execute adjacent read-only calls concurrently, but commit all results in
    // provider order. Any serial tool acts as a barrier for the surrounding batch.
    for (let index = 0; index < validCalls.length; ) {
      const current = validCalls[index]!
      if (!isParallelSafeAgentTool(current.shared.name)) {
        const result = await executeToolCallForLoop(current, index)
        await commitToolResult(current, result)
        index += 1
        continue
      }

      const batch = [] as Array<(typeof validCalls)[number]>
      while (
        index + batch.length < validCalls.length &&
        batch.length < maxParallelToolCalls &&
        isParallelSafeAgentTool(validCalls[index + batch.length]!.shared.name)
      ) {
        batch.push(validCalls[index + batch.length]!)
      }

      const results = await Promise.all(
        batch.map((valid, batchIndex) =>
          executeToolCallForLoop(valid, index + batchIndex),
        ),
      )
      for (let batchIndex = 0; batchIndex < batch.length; batchIndex++) {
        await commitToolResult(batch[batchIndex]!, results[batchIndex]!)
      }
      index += batch.length
    }

    if (runtimeRecalledImages.length > 0 && params.appendRuntimeRecalledImages) {
      const consumed = runtimeRecalledImages.splice(0, runtimeRecalledImages.length)
      // keepRecalledImageRounds === 0 → never inject raw bytes (recall stays text-only).
      if (keepRecalledImageRounds !== 0) {
        // Digest left behind once the pixels are dropped, so later rounds still know
        // *what* was looked at (see RecalledImagePayload.digest).
        const digestLines = consumed
          .map((img) => img.digest?.trim())
          .filter((line): line is string => !!line)
        const digestBlock =
          digestLines.length > 0
            ? [RECALLED_IMAGE_DIGEST_HEADER, ...digestLines].join('\n')
            : RECALLED_IMAGE_PLACEHOLDER
        const beforeImagePushLen = messages.length
        params.appendRuntimeRecalledImages(messages, consumed)
        if (keepRecalledImageRounds > 0) {
          for (let i = beforeImagePushLen; i < messages.length; i++) {
            recalledImageRecords.push({ index: i, round, cleared: false, digest: digestBlock })
          }
        }
      }
    }

    params.onToolPhase?.(null)
    lastAssistantText = ''
    persistedThinkingPrefix = appendThinkingRound(persistedThinkingPrefix, thinking)
    clearStreamedAssistantContent(params)
  }

  // Budget exhausted after tool rounds often leaves empty streamed content — ask once for a final reply.
  if (
    !(lastAssistantText || '').trim() &&
    hasExecutedToolInTurn &&
    params.appendToolBudgetExhaustedReprompt
  ) {
    if (params.signal?.aborted) throw abortedError()
    params.appendToolBudgetExhaustedReprompt(messages)
    params.onToolPhase?.(null)
    const wrap = await params.streamRound({
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
    lastUsage = wrap.usage ?? lastUsage
    const text = (wrap.content || lastAssistantText || '').trim()
    const rejectWrapAsRepoTruth =
      params.guardRepoActionTruth && !hasExecutedRepoActionInTurn && Boolean(text)
    // Ignore further tool calls — budget is done; force a user-visible close.
    if (text && !rejectWrapAsRepoTruth) {
      lastAssistantText = text
      params.onDelta(lastAssistantText)
    } else if (rejectWrapAsRepoTruth) {
      lastAssistantText = TOOL_BUDGET_NO_REPO_ACTION_FALLBACK_REPLY
      params.onDelta(lastAssistantText)
    } else {
      lastAssistantText = TOOL_BUDGET_EXHAUSTED_FALLBACK_REPLY
      params.onDelta(lastAssistantText)
    }
  }

  return { content: lastAssistantText, usage: lastUsage }
}
