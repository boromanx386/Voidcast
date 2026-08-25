import {
  DEEPSEEK_LLM_PRESET_MODELS,
  NVIDIA_LLM_PRESET_MODELS,
  OPENAI_LLM_PRESET_MODELS,
  OPENCODE_GO_LLM_PRESET_MODELS,
  OPENROUTER_LLM_PRESET_MODELS,
  normalizeDeepSeekModelId,
  normalizeNvidiaModelId,
  normalizeOpenAiModelId,
  normalizeOpenCodeGoModelId,
  normalizeOpenRouterModelId,
} from '@/lib/cloudLlmPresets'
import type { AppSettings, LlmProvider } from '@/lib/settings'

export type ContextLimitSource =
  | 'ollama_num_ctx'
  | 'preset'
  | 'heuristic'
  | 'provider_default'

export type ResolvedContextLimit = {
  maxTokens: number
  source: ContextLimitSource
  modelId: string
  provider: LlmProvider
}

const PROVIDER_DEFAULT_CONTEXT: Record<Exclude<LlmProvider, 'ollama'>, number> = {
  openrouter: 256_000,
  nvidia: 256_000,
  deepseek: 1_000_000,
  openai: 256_000,
  'opencode-go': 256_000,
}

/** Explicit overrides for models where heuristics would be wrong. */
const MODEL_CONTEXT_OVERRIDES: Record<string, number> = {
  'openrouter/free': 200_000,
  'openrouter/auto-beta': 2_000_000,
  'openrouter/fusion': 1_000_000,
  'google/gemini-3.6-flash': 1_048_576,
  'meituan/longcat-2.0': 1_048_576,
  'moonshotai/kimi-k3': 1_048_576,
  'meta/muse-spark-1.1': 1_048_576,
  'openai/gpt-5.6-sol': 1_050_000,
  'openai/gpt-5.6-terra': 1_050_000,
  'openai/gpt-5.6-luna': 1_050_000,
  'openai/gpt-5.6-sol-pro': 1_050_000,
  'openai/gpt-5.6-terra-pro': 1_050_000,
  'openai/gpt-5.6-luna-pro': 1_050_000,
  'gpt-5.6-sol': 1_050_000,
  'gpt-5.6-terra': 1_050_000,
  'gpt-5.6-luna': 1_050_000,
  'gpt-5.6-sol-pro': 1_050_000,
  'gpt-5.6-terra-pro': 1_050_000,
  'gpt-5.6-luna-pro': 1_050_000,
  'x-ai/grok-4.5': 500_000,
  'x-ai/grok-4.6': 500_000,
  'anthropic/claude-opus-4.8': 1_000_000,
  'anthropic/claude-sonnet-5': 1_000_000,
  'anthropic/claude-fable-5': 1_000_000,
  'deepseek/deepseek-v4-pro-0813': 1_048_576,
  'deepseek/deepseek-v4-flash': 1_000_000,
  'deepseek/deepseek-v4-flash-vision-exp': 1_048_576,
  'stealth/ox-alpha': 1_048_576,
  'deepseek-v4-pro': 1_000_000,
  'deepseek-v4-flash': 1_000_000,
  'deepseek-v4-flash-vision-exp': 1_000_000,
  'ox-alpha-free': 1_000_000,
  'longcat-2.0': 1_000_000,
  'z-ai/glm-5.2': 1_048_576,
  'z-ai/glm-5.3': 1_048_576,
  'moonshotai/kimi-k2.7-code': 262_144,
  'google/gemma-4-31b-it': 131_072,
  'google/gemma-4-31b-it:free': 262_144,
  'nvidia/nemotron-3.5-lightning': 262_144,
  'nvidia/nemotron-3.5-lightning:free': 1_000_000,
  'nvidia/nemotron-3-super-120b-a12b:free': 262_144,
  'nvidia/nemotron-3-ultra-550b-a55b:free': 1_000_000,
  'poolside/laguna-s-2.1': 1_048_576,
  'poolside/laguna-s-2.1:free': 262_144,
  'tencent/hy3-preview': 262_144,
  'tencent/hy3': 262_144,
  'kimi-k2.7-code': 262_144,
  'kimi-k2.6': 262_144,
  'kimi-k3': 1_048_576,
  'glm-5.3': 1_000_000,
  'glm-5.2': 1_000_000,
  'glm-5.1': 202_752,
  'mimo-v2.5': 1_000_000,
  'mimo-v2.5-pro': 1_048_576,
  'grok-4.5': 500_000,
  hy3: 262_144,
}

function buildPresetLookup(
  presets: Array<{ id: string; contextTokens?: number }>,
): Map<string, number> {
  const map = new Map<string, number>()
  for (const preset of presets) {
    if (preset.contextTokens && preset.contextTokens > 0) {
      map.set(preset.id, preset.contextTokens)
    }
  }
  return map
}

const OPENROUTER_PRESET_CONTEXT = buildPresetLookup(OPENROUTER_LLM_PRESET_MODELS)
const DEEPSEEK_PRESET_CONTEXT = buildPresetLookup(DEEPSEEK_LLM_PRESET_MODELS)
const OPENAI_PRESET_CONTEXT = buildPresetLookup(OPENAI_LLM_PRESET_MODELS)
const NVIDIA_PRESET_CONTEXT = buildPresetLookup(NVIDIA_LLM_PRESET_MODELS)
const OPENCODE_GO_PRESET_CONTEXT = buildPresetLookup(OPENCODE_GO_LLM_PRESET_MODELS)

export function activeLlmModelId(
  settings: Pick<
    AppSettings,
    | 'llmProvider'
    | 'ollamaModel'
    | 'openrouterModel'
    | 'deepseekModel'
    | 'openaiModel'
    | 'nvidiaModel'
    | 'opencodeGoModel'
  >,
): string {
  switch (settings.llmProvider) {
    case 'openrouter':
      return normalizeOpenRouterModelId(settings.openrouterModel)
    case 'deepseek':
      return normalizeDeepSeekModelId(settings.deepseekModel)
    case 'openai':
      return normalizeOpenAiModelId(settings.openaiModel)
    case 'nvidia':
      return normalizeNvidiaModelId(settings.nvidiaModel)
    case 'opencode-go':
      return normalizeOpenCodeGoModelId(settings.opencodeGoModel)
    default:
      return settings.ollamaModel.trim()
  }
}

function inferCloudContextTokens(modelId: string): number | undefined {
  const key = modelId.trim().toLowerCase()
  if (!key) return undefined

  if (MODEL_CONTEXT_OVERRIDES[modelId] || MODEL_CONTEXT_OVERRIDES[key]) {
    return MODEL_CONTEXT_OVERRIDES[modelId] ?? MODEL_CONTEXT_OVERRIDES[key]
  }

  if (key.endsWith(':free') || key.includes(':free')) return 32_768

  if (key.includes('opus') || key.includes('claude-sonnet') || key.includes('claude-fable')) {
    return 200_000
  }
  if (key.includes('gemini') && (key.includes('pro') || key.includes('flash'))) {
    return 1_048_576
  }
  if (key.includes('gpt-5') || key.includes('gpt-4') || key.includes('gpt-oss')) {
    return 128_000
  }
  if (key.includes('grok')) return 131_072
  if (key.includes('kimi')) return 128_000
  if (key.includes('deepseek')) {
    return 1_000_000
  }
  if (key.includes('qwen')) return 128_000
  if (key.includes('nemotron')) return 128_000
  if (key.includes('minimax')) return 128_000
  if (key.includes('glm')) return 128_000
  if (key.includes('gemma')) return 131_072
  if (key.includes('mistral')) return 128_000
  if (key.includes('step')) return 128_000
  if (key.includes('hy3')) return 262_144

  return undefined
}

function lookupPresetContext(
  provider: Exclude<LlmProvider, 'ollama'>,
  modelId: string,
): number | undefined {
  const maps: Record<Exclude<LlmProvider, 'ollama'>, Map<string, number>> = {
    openrouter: OPENROUTER_PRESET_CONTEXT,
    deepseek: DEEPSEEK_PRESET_CONTEXT,
    openai: OPENAI_PRESET_CONTEXT,
    nvidia: NVIDIA_PRESET_CONTEXT,
    'opencode-go': OPENCODE_GO_PRESET_CONTEXT,
  }
  return maps[provider].get(modelId)
}

export function resolveContextLimit(
  settings: Pick<
    AppSettings,
    | 'llmProvider'
    | 'llmNumCtx'
    | 'ollamaModel'
    | 'openrouterModel'
    | 'deepseekModel'
    | 'openaiModel'
    | 'nvidiaModel'
    | 'opencodeGoModel'
  >,
): ResolvedContextLimit {
  const provider = settings.llmProvider
  const modelId = activeLlmModelId(settings)

  if (provider === 'ollama') {
    const maxTokens =
      Number.isFinite(settings.llmNumCtx) && settings.llmNumCtx > 0
        ? Math.round(settings.llmNumCtx)
        : 100_000
    return { maxTokens, source: 'ollama_num_ctx', modelId, provider }
  }

  const override = MODEL_CONTEXT_OVERRIDES[modelId]
  if (override) {
    return { maxTokens: override, source: 'preset', modelId, provider }
  }

  const preset = lookupPresetContext(provider, modelId)
  if (preset) {
    return { maxTokens: preset, source: 'preset', modelId, provider }
  }

  const inferred = inferCloudContextTokens(modelId)
  if (inferred) {
    return { maxTokens: inferred, source: 'heuristic', modelId, provider }
  }

  return {
    maxTokens: PROVIDER_DEFAULT_CONTEXT[provider],
    source: 'provider_default',
    modelId,
    provider,
  }
}

export function contextLimitSourceLabel(source: ContextLimitSource): string {
  switch (source) {
    case 'ollama_num_ctx':
      return 'Ollama num_ctx'
    case 'preset':
      return 'model preset'
    case 'heuristic':
      return 'model heuristic'
    case 'provider_default':
      return 'provider default'
  }
}
