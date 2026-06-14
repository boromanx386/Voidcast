export type CloudLlmPreset = { id: string; label: string }

/** Curated OpenRouter chat models (verified against GET /api/v1/models). */
export const OPENROUTER_LLM_PRESET_MODELS: CloudLlmPreset[] = [
  { id: 'openrouter/free', label: 'Auto Free Router' },
  { id: 'openrouter/owl-alpha', label: 'OpenRouter Owl Alpha' },
  { id: 'deepseek/deepseek-v4-pro', label: 'DeepSeek V4 Pro (coding · value)' },
  { id: 'deepseek/deepseek-v4-flash', label: 'DeepSeek V4 Flash (fast · cheap)' },
  { id: 'anthropic/claude-sonnet-4.6', label: 'Claude Sonnet 4.6' },
  { id: 'anthropic/claude-opus-4.8', label: 'Claude Opus 4.8' },
  { id: 'anthropic/claude-fable-5', label: 'Claude Fable 5 (long-horizon coding)' },
  { id: 'openai/gpt-5.5', label: 'GPT-5.5' },
  { id: 'openai/gpt-5.3-codex', label: 'GPT-5.3 Codex' },
  { id: 'google/gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
  { id: 'google/gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro Preview' },
  { id: 'moonshotai/kimi-k2.6', label: 'Kimi K2.6 (agentic coding)' },
  { id: 'moonshotai/kimi-k2.7-code', label: 'Kimi K2.7 Code (coding)' },
  { id: 'minimax/minimax-m2.7', label: 'MiniMax M2.7' },
  { id: 'minimax/minimax-m3', label: 'MiniMax M3' },
  { id: 'qwen/qwen3-coder', label: 'Qwen3 Coder' },
  { id: 'qwen/qwen3-coder:free', label: 'Qwen3 Coder (Free)' },
  { id: 'qwen/qwen3.7-plus', label: 'Qwen3.7 Plus' },
  { id: 'qwen/qwen3.7-max', label: 'Qwen3.7 Max' },
  { id: 'z-ai/glm-4.7-flash', label: 'GLM 4.7 Flash' },
  { id: 'z-ai/glm-5.1', label: 'GLM 5.1' },
  { id: 'xiaomi/mimo-v2.5-pro', label: 'MiMo V2.5 Pro' },
  { id: 'stepfun/step-3.7-flash', label: 'Step 3.7 Flash' },
  { id: 'poolside/laguna-m.1:free', label: 'Poolside Laguna M.1 (Free)' },
  { id: 'nex-agi/nex-n2-pro:free', label: 'Nex N2 Pro (Free)' },
  { id: 'nvidia/nemotron-3-ultra-550b-a55b:free', label: 'Nemotron 3 Ultra (Free)' },
  { id: 'nvidia/nemotron-3-super-120b-a12b:free', label: 'Nemotron 3 Super 120B (Free)' },
  { id: 'google/gemma-4-31b-it:free', label: 'Gemma 4 31B IT (Free)' },
  { id: 'openai/gpt-oss-120b:free', label: 'GPT-OSS 120B (Free)' },
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
  { id: 'z-ai/glm-5.1', label: 'GLM 5.1' },
  { id: 'minimaxai/minimax-m2.7', label: 'MiniMax M2.7' },
  { id: 'minimaxai/minimax-m3', label: 'MiniMax M3' },
  { id: 'moonshotai/kimi-k2.6', label: 'Kimi K2.6' },
  { id: 'qwen/qwen3.5-397b-a17b', label: 'Qwen 3.5 397B' },
  { id: 'qwen/qwen3.5-122b-a10b', label: 'Qwen 3.5 122B' },
  { id: 'mistralai/mistral-medium-3.5-128b', label: 'Mistral Medium 3.5 128B' },
  { id: 'stepfun-ai/step-3.7-flash', label: 'Step 3.7 Flash' },
  { id: 'google/gemma-4-31b-it', label: 'Gemma 4 31B IT' },
  { id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B' },
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
  'z-ai/glm5': 'z-ai/glm-5.1',
  'z-ai/glm4.7': 'z-ai/glm-5.1',
  'z-ai/glm-4.7': 'z-ai/glm-5.1',
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
