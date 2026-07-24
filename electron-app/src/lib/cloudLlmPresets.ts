export type CloudLlmPreset = { id: string; label: string }

/** Curated OpenRouter chat models (verified against GET /api/v1/models). */
export const OPENROUTER_LLM_PRESET_MODELS: CloudLlmPreset[] = [
  { id: 'openrouter/free', label: 'Auto Free Router' },
  { id: 'openrouter/fusion', label: 'OpenRouter Fusion (multi-model)' },
  { id: 'openrouter/auto-beta', label: 'OpenRouter Auto (Beta)' },
  { id: 'deepseek/deepseek-v4-pro', label: 'DeepSeek V4 Pro (coding · value)' },
  { id: 'deepseek/deepseek-v4-flash', label: 'DeepSeek V4 Flash (fast · cheap)' },
  { id: 'anthropic/claude-sonnet-5', label: 'Claude Sonnet 5 (latest)' },
  { id: 'anthropic/claude-opus-4.8', label: 'Claude Opus 4.8' },
  { id: 'anthropic/claude-fable-5', label: 'Claude Fable 5 (long-horizon coding)' },
  { id: 'openai/gpt-5.6-sol', label: 'GPT-5.6 Sol (flagship · coding)' },
  { id: 'openai/gpt-5.6-terra', label: 'GPT-5.6 Terra (balanced)' },
  { id: 'openai/gpt-5.6-luna', label: 'GPT-5.6 Luna (fast · cheap)' },
  { id: 'openai/gpt-5.6-sol-pro', label: 'GPT-5.6 Sol Pro' },
  { id: 'openai/gpt-5.6-terra-pro', label: 'GPT-5.6 Terra Pro' },
  { id: 'openai/gpt-5.6-luna-pro', label: 'GPT-5.6 Luna Pro' },
  { id: 'x-ai/grok-4.5', label: 'Grok 4.5 (coding · STEM)' },
  { id: 'google/gemini-3.6-flash', label: 'Gemini 3.6 Flash' },
  { id: 'meituan/longcat-2.0', label: 'LongCat 2.0 (coding · agentic)' },
  { id: 'moonshotai/kimi-k3', label: 'Kimi K3' },
  { id: 'moonshotai/kimi-k2.7-code', label: 'Kimi K2.7 Code (coding)' },
  { id: 'meta/muse-spark-1.1', label: 'Meta Muse Spark 1.1' },
  { id: 'minimax/minimax-m3', label: 'MiniMax M3' },
  { id: 'qwen/qwen3.7-plus', label: 'Qwen3.7 Plus' },
  { id: 'qwen/qwen3.7-max', label: 'Qwen3.7 Max' },
  { id: 'z-ai/glm-5.2', label: 'GLM 5.2 (reasoning · coding)' },
  { id: 'tencent/hy3', label: 'Tencent Hy3 (reasoning · agentic)' },
  { id: 'tencent/hy3-preview', label: 'Tencent Hy3 Preview (agentic · 256K)' },
  { id: 'poolside/laguna-s-2.1', label: 'Poolside Laguna S 2.1' },
  { id: 'poolside/laguna-s-2.1:free', label: 'Poolside Laguna S 2.1 (Free)' },
  { id: 'nvidia/nemotron-3-ultra-550b-a55b:free', label: 'Nemotron 3 Ultra (Free)' },
  { id: 'nvidia/nemotron-3-super-120b-a12b:free', label: 'Nemotron 3 Super 120B (Free)' },
  { id: 'google/gemma-4-31b-it:free', label: 'Gemma 4 31B IT (Free)' },
]

/** Curated DeepSeek chat models (https://api.deepseek.com). */
export const DEEPSEEK_LLM_PRESET_MODELS: CloudLlmPreset[] = [
  { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro (coding)' },
  { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash (fast)' },
]

/** Curated NVIDIA NIM chat models (integrate.api.nvidia.com/v1/models). */
export const NVIDIA_LLM_PRESET_MODELS: CloudLlmPreset[] = [
  { id: 'nvidia/nemotron-3-super-120b-a12b', label: 'Nemotron 3 Super 120B' },
  { id: 'nvidia/nemotron-3-ultra-550b-a55b', label: 'Nemotron 3 Ultra 550B' },
  { id: 'deepseek-ai/deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
  { id: 'deepseek-ai/deepseek-v4-flash', label: 'DeepSeek V4 Flash' },
  { id: 'z-ai/glm-5.2', label: 'GLM 5.2' },
  { id: 'minimaxai/minimax-m2.7', label: 'MiniMax M2.7' },
  { id: 'minimaxai/minimax-m3', label: 'MiniMax M3' },
  { id: 'moonshotai/kimi-k2.6', label: 'Kimi K2.6' },
  { id: 'qwen/qwen3.5-397b-a17b', label: 'Qwen 3.5 397B' },
  { id: 'qwen/qwen3-next-80b-a3b-instruct', label: 'Qwen3 Next 80B' },
  { id: 'mistralai/mistral-medium-3.5-128b', label: 'Mistral Medium 3.5 128B' },
  { id: 'stepfun-ai/step-3.7-flash', label: 'Step 3.7 Flash' },
  { id: 'google/gemma-4-31b-it', label: 'Gemma 4 31B IT' },
  { id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B' },
]

/**
 * OpenCode Go models on OpenAI-compatible `/v1/chat/completions`
 * (https://opencode.ai/docs/go/). Anthropic `/messages` models (MiniMax, Qwen) omitted.
 */
export const OPENCODE_GO_LLM_PRESET_MODELS: CloudLlmPreset[] = [
  { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro (coding)' },
  { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash (fast)' },
  { id: 'kimi-k2.7-code', label: 'Kimi K2.7 Code' },
  { id: 'kimi-k2.6', label: 'Kimi K2.6' },
  { id: 'kimi-k3', label: 'Kimi K3' },
  { id: 'glm-5.2', label: 'GLM 5.2' },
  { id: 'glm-5.1', label: 'GLM 5.1' },
  { id: 'mimo-v2.5-pro', label: 'MiMo V2.5 Pro' },
  { id: 'mimo-v2.5', label: 'MiMo V2.5' },
  { id: 'grok-4.5', label: 'Grok 4.5' },
  { id: 'hy3', label: 'Hy3' },
]

const OPENROUTER_MODEL_ALIASES: Record<string, string> = {
  'minimax/minimax-m2.5:free': 'minimax/minimax-m2.5',
  'moonshotai/kimi-k2.6:free': 'moonshotai/kimi-k2.6',
  'baidu/cobuddy:free': 'openrouter/free',
  'z-ai/glm-4.7': 'z-ai/glm-4.7-flash',
  'inclusionai/ring-2.6-1t': 'deepseek/deepseek-v4-pro',
  'nvidia/nemotron-3-super-120b-a12b': 'nvidia/nemotron-3-super-120b-a12b:free',
}

const DEEPSEEK_MODEL_ALIASES: Record<string, string> = {
  'deepseek-chat': 'deepseek-v4-flash',
  'deepseek-reasoner': 'deepseek-v4-flash',
  'deepseek/deepseek-v4-pro': 'deepseek-v4-pro',
  'deepseek/deepseek-v4-flash': 'deepseek-v4-flash',
}

const NVIDIA_MODEL_ALIASES: Record<string, string> = {
  'z-ai/glm5': 'z-ai/glm-5.2',
  'z-ai/glm4.7': 'z-ai/glm-5.2',
  'z-ai/glm-4.7': 'z-ai/glm-5.2',
  'stepfun-ai/step-3.5-flash': 'stepfun-ai/step-3.7-flash',
}

export function normalizeOpenRouterModelId(model: string): string {
  const trimmed = model.trim()
  if (!trimmed) return OPENROUTER_LLM_PRESET_MODELS[0]?.id ?? 'openrouter/free'
  return OPENROUTER_MODEL_ALIASES[trimmed] ?? trimmed
}

export function normalizeDeepSeekModelId(model: string): string {
  const trimmed = model.trim()
  if (!trimmed) return DEEPSEEK_LLM_PRESET_MODELS[0]?.id ?? 'deepseek-v4-pro'
  return DEEPSEEK_MODEL_ALIASES[trimmed] ?? trimmed
}

export function isDeepSeekModelId(model: string): boolean {
  const trimmed = model.trim().toLowerCase()
  if (!trimmed) return false
  if (trimmed.startsWith('deepseek-')) return true
  return trimmed in DEEPSEEK_MODEL_ALIASES || DEEPSEEK_LLM_PRESET_MODELS.some((m) => m.id === trimmed)
}

export function normalizeNvidiaModelId(model: string): string {
  const trimmed = model.trim()
  if (!trimmed) return NVIDIA_LLM_PRESET_MODELS[0]?.id ?? 'nvidia/nemotron-3-super-120b-a12b'
  return NVIDIA_MODEL_ALIASES[trimmed] ?? trimmed
}

const OPENCODE_GO_MODEL_ALIASES: Record<string, string> = {
  'deepseek/deepseek-v4-pro': 'deepseek-v4-pro',
  'deepseek/deepseek-v4-flash': 'deepseek-v4-flash',
  'moonshotai/kimi-k2.7-code': 'kimi-k2.7-code',
  'moonshotai/kimi-k2.6': 'kimi-k2.6',
  'moonshotai/kimi-k3': 'kimi-k3',
  'z-ai/glm-5.2': 'glm-5.2',
  'z-ai/glm-5.1': 'glm-5.1',
  'x-ai/grok-4.5': 'grok-4.5',
  'tencent/hy3': 'hy3',
}

export function normalizeOpenCodeGoModelId(model: string): string {
  const trimmed = model.trim()
  if (!trimmed) return OPENCODE_GO_LLM_PRESET_MODELS[0]?.id ?? 'deepseek-v4-pro'
  return OPENCODE_GO_MODEL_ALIASES[trimmed] ?? trimmed
}

/** OpenRouter route suffixes after `provider/model:` (not Ollama tags). */
const OPENROUTER_ROUTE_VARIANTS = new Set([
  'free',
  'nitro',
  'floor',
  'exacto',
  'extended',
])

export type SubAgentProviderId = 'ollama' | 'openrouter' | 'deepseek'

/**
 * Resolve which backend a sub-agent model id should hit.
 *
 * Ollama supports namespaced ids like `sorc/qwen…:9b` (both `/` and `:`).
 * OpenRouter uses `org/model` and optional route variants like `:free`.
 * Prefer an explicit provider from settings when present.
 */
export function detectSubAgentProvider(
  model: string,
  explicit?: SubAgentProviderId | null,
): SubAgentProviderId {
  if (explicit === 'ollama' || explicit === 'openrouter' || explicit === 'deepseek') {
    return explicit
  }
  if (!model) return 'ollama'
  if (isDeepSeekModelId(model)) return 'deepseek'

  const hasColon = model.includes(':')
  const hasSlash = model.includes('/')

  // Classic Ollama tags: llava:13b, mistral:latest
  if (hasColon && !hasSlash) return 'ollama'

  // Both `/` and `:` — disambiguate OpenRouter variants vs Ollama namespace/name:tag
  if (hasColon && hasSlash) {
    const variant = model.slice(model.lastIndexOf(':') + 1).toLowerCase()
    if (OPENROUTER_ROUTE_VARIANTS.has(variant)) return 'openrouter'
    return 'ollama'
  }

  // Slash without colon → OpenRouter-style org/model
  return 'openrouter'
}
