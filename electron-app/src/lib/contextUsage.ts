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
}

export const CONTEXT_WARN_RATIO = 0.78
export const CONTEXT_COMPRESS_RATIO = 0.9
/** Below this prompt ratio, auto-compress may run again after a prior compression. */
export const CONTEXT_COMPRESS_RATIO_RESET = 0.85

/**
 * Convert Ollama usage counters into context-window utilization estimate.
 * Uses prompt tokens for context usage, while keeping output tokens separate.
 */
export function estimateContextUsage(
  usage: OllamaChatUsage | undefined,
  limit: ResolvedContextLimit | number | undefined,
): ContextUsageInfo | null {
  const maxTokens =
    typeof limit === 'number'
      ? limit
      : limit && Number.isFinite(limit.maxTokens) && limit.maxTokens > 0
        ? Math.round(limit.maxTokens)
        : undefined
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
