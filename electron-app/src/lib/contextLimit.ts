import {
  DEEPSEEK_LLM_PRESET_MODELS,
  NVIDIA_LLM_PRESET_MODELS,
  OPENCODE_GO_LLM_PRESET_MODELS,
  OPENROUTER_LLM_PRESET_MODELS,
  normalizeDeepSeekModelId,
  normalizeNvidiaModelId,
  normalizeOpenCodeGoModelId,
  normalizeOpenRouterModelId,
} from '@/lib/cloudLlmPresets'
import {
  CUSTOM_LLM_DEFAULT_CONTEXT_TOKENS,
  type AppSettings,
  type LlmProvider,
} from '@/lib/settings'

export type ContextLimitSource =
  'ollama_num_ctx' | 'custom_setting' | 'preset' | 'heuristic' | 'provider_default'

export type ResolvedContextLimit = {
  maxTokens: number
  source: ContextLimitSource
  modelId: string
  provider: LlmProvider
}

const PROVIDER_DEFAULT_CONTEXT: Record<Exclude<LlmProvider, 'ollama' | 'custom'>, number> = {
  openrouter: 256_000,
  nvidia: 256_000,
  deepseek: 1_000_000,
  'opencode-go': 256_000,
}

/** Explicit overrides for models where heuristics would be wrong. */
const MODEL_CONTEXT_OVERRIDES: Record<string, number> = {
  'openrouter/free': 200_000,
  'openrouter/auto-beta': 2_000_000,
  'openrouter/fusion': 1_000_000,
  'google/gemini-3.6-flash': 1_048_576,
  'meituan/longcat-2.0': 1_048_576,
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
  // Both ids exist on two providers and models.dev publishes two windows for them:
  // deepseek-v4-pro is 1,048,576 on `deepseek` but 1,000,000 on `opencode-go` (and
  // deepseek-flash is 1,048,576 vs 1,000,000 the same way). This map is keyed by id with
  // no provider, so the smaller window wins — deepseek-v4-pro is the Go default model and
  // a 1M budget stays inside what Go accepts.
  'deepseek-v4-pro': 1_000_000,
  'deepseek-v4-pro-0813': 1_000_000,
  'deepseek-flash': 1_000_000,
  'deepseek-v4-flash-0731': 1_000_000,
  'deepseek-v3.2': 163_840,
  'longcat-2.0': 1_000_000,
  'moonshotai/kimi-k2.7-code': 262_144,
  'google/gemma-4-31b-it': 131_072,
  'google/gemma-4-31b-it:free': 262_144,
  'gemma-4-31b-it': 262_144,
  'nvidia/nemotron-3.5-lightning': 1_048_576,
  'nvidia/nemotron-3.5-lightning:free': 1_000_000,
  'nvidia/nemotron-3-ultra-550b-a55b:free': 1_000_000,
  'tencent/hy3-preview': 262_144,
  'tencent/hy3': 262_144,
  'kimi-k2.7-code': 262_144,
  'kimi-k3': 1_048_576,
  'kimi-k3-eco': 1_000_000,
  'glm-5.3': 1_000_000,
  'glm-5.1': 202_752,
  hy3: 262_144,
  'qwen3.8-27b': 262_144,
  'qwen3.6-27b': 262_144,
  'qwen3.5-397b-a17b': 262_144,
  'qwen3.5-9b': 262_144,
  'greg-2-ultra': 229_376,
  'greg-2-super': 229_376,
  'greg-1-mini': 229_376,
  'greg-rp': 229_376,
  'z-ai/glm-5.3-flash': 1_048_576,
  'glm-5.3-flash': 1_000_000,
  'qwen/qwen3.8-flash': 1_000_000,
  'tencent/hy4-preview': 1_048_576,
  'hy4-preview': 1_024_000,
  'deepseek/deepseek-v4.1-flash': 1_048_576,
  'openai/gpt-6-astra': 1_050_000,
  'openai/gpt-6-astra-pro': 1_050_000,
  'anthropic/claude-fable-5.1': 1_000_000,
  'deepseek-v4.1-flash': 1_000_000,
  'z-ai/glm-5.3-flashx': 1_048_576,
  'google/gemini-3.8-flash': 1_048_576,
  'openai/gpt-6-luna': 1_050_000,
  'openai/gpt-6-sol': 1_050_000,
  'qwen/qwen3.8-max-0902': 1_000_000,
  'qwen/qwen3.8-omni-flash': 1_000_000,
  'x-ai/grok-4.7': 500_000,
  'xiaomi/mimo-v2.6-flash': 1_050_000,
  'mimo-v2.6-flash': 1_048_576,
  'mimo-v2.6-pro': 1_048_576,
  'anthropic/claude-opus-5.5': 1_000_000,
  'xiaomi/mimo-v2.6-pro': 1_050_000,
  'anthropic/claude-sonnet-5.5': 1_000_000,
  'openai/gpt-6.1-sol': 1_050_000,
  'anthropic/claude-haiku-5.5': 1_000_000,
  'mistralai/mistral-large-4-0': 1_048_576,
  'qwen3.8-flash': 1_000_000,
  'qwen3.8-max': 1_000_000,
  'gpt-6-luna': 1_050_000,
  'muse-spark-1.2-contributor': 1_048_576,
  'muse-spark-1.3-contributor': 1_048_576,
  'google/gemini-4-argon': 1_048_576,
  'deepseek/deepseek-v4.1-flash-1017': 1_048_576,
  'beam-free': 1_048_576,
  'minimax/minimax-m3.1-flash': 1_048_576,
  'meta/muse-spark-open': 1_048_576,
  'meta/muse-wonder': 1_048_576,
  'kimi-k3.1-pro': 1_048_576,
  'iceman-contributor-free': 262144,
  'step-5-preview': 1_000_000,
  'grok-4.7': 500_000,
  'moonshotai/kimi-k3.1-pro': 1_048_576,
  'openai/gpt-6.1-terra': 1_050_000,
  'tencent/hy4': 1_048_576,
  hy4: 1_048_576,
  'minimax-m3.1-flash': 1_000_000,
  'crouton-alpha-free': 1_048_576,
  'tencent/hy4-flash': 1_048_576,
  'google/gemini-4-hydrogen': 1_048_576,
  'google/gemini-4-neon': 1_048_576,
  'google/gemini-4-carbon': 1_048_576,
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
const NVIDIA_PRESET_CONTEXT = buildPresetLookup(NVIDIA_LLM_PRESET_MODELS)
const OPENCODE_GO_PRESET_CONTEXT = buildPresetLookup(OPENCODE_GO_LLM_PRESET_MODELS)

export function activeLlmModelId(
  settings: Pick<
    AppSettings,
    | 'llmProvider'
    | 'ollamaModel'
    | 'openrouterModel'
    | 'deepseekModel'
    | 'customModel'
    | 'nvidiaModel'
    | 'opencodeGoModel'
  >,
): string {
  switch (settings.llmProvider) {
    case 'openrouter':
      return normalizeOpenRouterModelId(settings.openrouterModel)
    case 'deepseek':
      return normalizeDeepSeekModelId(settings.deepseekModel)
    case 'custom':
      return settings.customModel.trim()
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

  // Manual (typed, non-preset) cloud models always default to the 256k provider
  // window — no low guesses. Only families with reliably larger windows keep a
  // heuristic here; exact per-model values live in MODEL_CONTEXT_OVERRIDES.
  if (key.includes('gemini') && (key.includes('pro') || key.includes('flash'))) {
    return 1_048_576
  }
  if (key.includes('deepseek')) {
    return 1_000_000
  }
  if (key.includes('hy3')) return 262_144

  return undefined
}

function lookupPresetContext(
  provider: Exclude<LlmProvider, 'ollama' | 'custom'>,
  modelId: string,
): number | undefined {
  const maps: Record<Exclude<LlmProvider, 'ollama' | 'custom'>, Map<string, number>> = {
    openrouter: OPENROUTER_PRESET_CONTEXT,
    deepseek: DEEPSEEK_PRESET_CONTEXT,
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
    | 'customModel'
    | 'customContextTokens'
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

  // A custom endpoint can serve any model under any name, so an id-keyed table would guess;
  // the window the user typed in Options is the only number that is known to be right.
  if (provider === 'custom') {
    const maxTokens =
      Number.isFinite(settings.customContextTokens) && settings.customContextTokens > 0
        ? Math.round(settings.customContextTokens)
        : CUSTOM_LLM_DEFAULT_CONTEXT_TOKENS
    return { maxTokens, source: 'custom_setting', modelId, provider }
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
    case 'custom_setting':
      return 'custom context setting'
    case 'preset':
      return 'model preset'
    case 'heuristic':
      return 'model heuristic'
    case 'provider_default':
      return 'provider default'
  }
}
