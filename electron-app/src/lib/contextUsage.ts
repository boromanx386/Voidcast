import type { OllamaChatUsage } from '@/lib/ollama'

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
}

export const CONTEXT_WARN_RATIO = 0.78
export const CONTEXT_COMPRESS_RATIO = 0.9

/**
 * Convert Ollama usage counters into context-window utilization estimate.
 * Uses prompt tokens for context usage, while keeping output tokens separate.
 */
export function estimateContextUsage(
  usage: OllamaChatUsage | undefined,
  numCtx: number | undefined,
): ContextUsageInfo | null {
  if (!usage || !numCtx || !Number.isFinite(numCtx) || numCtx <= 0) return null
  const prompt = Math.max(0, Math.round(usage.prompt_eval_count ?? 0))
  const evalCount = Math.max(0, Math.round(usage.eval_count ?? 0))
  if (prompt <= 0 && evalCount <= 0) return null
  const ratio = prompt / numCtx
  return {
    promptTokens: prompt,
    outputTokens: evalCount,
    maxTokens: numCtx,
    ratio,
    shouldWarn: ratio >= CONTEXT_WARN_RATIO,
    shouldCompress: ratio >= CONTEXT_COMPRESS_RATIO,
  }
}
