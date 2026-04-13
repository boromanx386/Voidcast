import type { OllamaChatUsage } from '@/lib/ollama'

export type ContextUsageInfo = {
  usedTokens: number
  maxTokens: number
  ratio: number
  shouldWarn: boolean
  shouldCompress: boolean
}

export const CONTEXT_WARN_RATIO = 0.78
export const CONTEXT_COMPRESS_RATIO = 0.9

/**
 * Convert Ollama usage counters into a context-window utilization estimate.
 * Uses prompt+eval tokens from final stream chunk (if present).
 */
export function estimateContextUsage(
  usage: OllamaChatUsage | undefined,
  numCtx: number | undefined,
): ContextUsageInfo | null {
  if (!usage || !numCtx || !Number.isFinite(numCtx) || numCtx <= 0) return null
  const prompt = Math.max(0, Math.round(usage.prompt_eval_count ?? 0))
  const evalCount = Math.max(0, Math.round(usage.eval_count ?? 0))
  const used = prompt + evalCount
  if (used <= 0) return null
  const ratio = used / numCtx
  return {
    usedTokens: used,
    maxTokens: numCtx,
    ratio,
    shouldWarn: ratio >= CONTEXT_WARN_RATIO,
    shouldCompress: ratio >= CONTEXT_COMPRESS_RATIO,
  }
}
