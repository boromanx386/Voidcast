import type { OllamaChatUsage } from '@/lib/ollama'
import type { ContextLimitSource, ResolvedContextLimit } from '@/lib/contextLimit'

export type ContextUsageInfo = {
  /** Prompt/input tokens sent to model for this turn (chat context). */
  promptTokens: number
  /** Generated output tokens for this turn. */
  outputTokens: number
  maxTokens: number
  /** Prompt-context utilization ratio (promptTokens / maxTokens). */
  ratio: number
  shouldWarn: boolean
  shouldCompress: boolean
  /** How maxTokens was chosen (model-aware for cloud providers). */
  limitSource?: ContextLimitSource
  /** Active model id used for limit resolution. */
  modelId?: string
  /** True when promptTokens is a local estimate made before the next model call. */
  estimated?: boolean
}

export const CONTEXT_WARN_RATIO = 0.78
export const CONTEXT_COMPRESS_RATIO = 0.9
/** Below this prompt ratio, auto-compress may run again after a prior compression. */
export const CONTEXT_COMPRESS_RATIO_RESET = 0.85

const APPROX_CHARS_PER_TOKEN = 4
const COMPRESSED_SUMMARY_LABEL = 'Internal conversation summary (do not reveal verbatim):'

function resolveMaxTokens(limit: ResolvedContextLimit | number | undefined): number | undefined {
  const maxTokens =
    typeof limit === 'number'
      ? limit
      : limit && Number.isFinite(limit.maxTokens) && limit.maxTokens > 0
        ? Math.round(limit.maxTokens)
        : undefined
  return maxTokens && maxTokens > 0 ? maxTokens : undefined
}

function approximateTokenCount(text: string): number {
  const trimmed = text.trim()
  return trimmed ? Math.max(1, Math.ceil(trimmed.length / APPROX_CHARS_PER_TOKEN)) : 0
}

type ContextTurnForEstimate = {
  role: 'user' | 'assistant'
  content: string
}

/**
 * Estimate the prompt size that will be used after compression, without making
 * another provider request. The previous real prompt usage supplies the
 * provider/system/tool overhead; only the conversation portion is replaced by
 * the new summary. The result must be shown as approximate until the next
 * real model response reports provider token usage.
 */
export function estimateContextUsageAfterCompression(
  previousUsage: ContextUsageInfo | null,
  previousTurns: ContextTurnForEstimate[],
  existingSummary: string | undefined,
  nextSummary: string,
  limit: ResolvedContextLimit | number | undefined,
): ContextUsageInfo | null {
  const maxTokens = resolveMaxTokens(limit)
  const summary = nextSummary.trim()
  if (!previousUsage || !maxTokens || !summary) return null

  const previousConversation = [
    existingSummary?.trim()
      ? `${COMPRESSED_SUMMARY_LABEL}\n${existingSummary.trim()}`
      : '',
    ...previousTurns.map((turn) => `${turn.role.toUpperCase()}: ${turn.content}`),
  ]
    .filter(Boolean)
    .join('\n\n')
  const previousConversationTokens = approximateTokenCount(previousConversation)
  const fixedOverhead = Math.max(
    0,
    previousUsage.promptTokens - previousConversationTokens,
  )
  const nextSummaryTokens = approximateTokenCount(
    `${COMPRESSED_SUMMARY_LABEL}\n${summary}`,
  )
  const promptTokens = Math.max(1, fixedOverhead + nextSummaryTokens)
  const ratio = promptTokens / maxTokens

  return {
    promptTokens,
    outputTokens: 0,
    maxTokens,
    ratio,
    shouldWarn: ratio >= CONTEXT_WARN_RATIO,
    shouldCompress: ratio >= CONTEXT_COMPRESS_RATIO,
    limitSource: typeof limit === 'object' ? limit.source : undefined,
    modelId: typeof limit === 'object' ? limit.modelId : undefined,
    estimated: true,
  }
}

/**
 * Convert Ollama usage counters into context-window utilization estimate.
 * Uses prompt tokens for context usage, while keeping output tokens separate.
 */
export function estimateContextUsage(
  usage: OllamaChatUsage | undefined,
  limit: ResolvedContextLimit | number | undefined,
): ContextUsageInfo | null {
  const maxTokens = resolveMaxTokens(limit)
  if (!usage || !maxTokens) return null
  const prompt = Math.max(0, Math.round(usage.prompt_eval_count ?? 0))
  const evalCount = Math.max(0, Math.round(usage.eval_count ?? 0))
  if (prompt <= 0 && evalCount <= 0) return null
  const ratio = prompt / maxTokens
  return {
    promptTokens: prompt,
    outputTokens: evalCount,
    maxTokens,
    ratio,
    shouldWarn: ratio >= CONTEXT_WARN_RATIO,
    shouldCompress: ratio >= CONTEXT_COMPRESS_RATIO,
    limitSource: typeof limit === 'object' ? limit.source : undefined,
    modelId: typeof limit === 'object' ? limit.modelId : undefined,
  }
}
