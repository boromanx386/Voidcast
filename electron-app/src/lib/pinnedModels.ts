import {
  DEEPSEEK_LLM_PRESET_MODELS,
  NVIDIA_LLM_PRESET_MODELS,
  OPENAI_LLM_PRESET_MODELS,
  OPENCODE_GO_LLM_PRESET_MODELS,
  OPENROUTER_LLM_PRESET_MODELS,
} from '@/lib/cloudLlmPresets'
import type { AppSettings, LlmProvider } from '@/lib/settings'

/** Longest-first so `opencode-go:` wins over shorter prefixes. */
const SCOPED_PROVIDERS: LlmProvider[] = [
  'opencode-go',
  'openrouter',
  'deepseek',
  'openai',
  'nvidia',
  'ollama',
]

/** Canonical pin: `provider:modelId` (never collide across providers). */
export function toScopedPinnedId(provider: LlmProvider, modelId: string): string {
  const raw = unwrapPinnedModelId(provider, modelId.trim())
  if (!raw) return ''
  return `${provider}:${raw}`
}

export function parsePinnedId(
  pinnedId: string,
): { provider: LlmProvider; modelId: string } | null {
  const id = pinnedId.trim()
  if (!id) return null

  for (const provider of SCOPED_PROVIDERS) {
    const prefix = `${provider}:`
    if (id.startsWith(prefix)) {
      const modelId = id.slice(prefix.length).trim()
      if (modelId) return { provider, modelId }
    }
  }

  // Legacy ollama/ prefix from earlier pin format.
  if (id.startsWith('ollama/')) {
    const modelId = id.slice('ollama/'.length).trim()
    if (modelId) return { provider: 'ollama', modelId }
  }

  return null
}

/** Strip provider scope (and legacy ollama/) when writing into settings model fields. */
export function unwrapPinnedModelId(provider: LlmProvider, modelId: string): string {
  const id = modelId.trim()
  if (!id) return ''
  const parsed = parsePinnedId(id)
  if (parsed) return parsed.modelId
  if (provider === 'ollama' && id.startsWith('ollama/')) {
    return id.slice('ollama/'.length).trim()
  }
  return id
}

/** @deprecated Use toScopedPinnedId('ollama', name) */
export function toOllamaPinnedId(modelName: string): string {
  return toScopedPinnedId('ollama', modelName)
}

/** @deprecated Use unwrapPinnedModelId('ollama', id) */
export function fromOllamaPinnedId(pinnedId: string): string {
  return unwrapPinnedModelId('ollama', pinnedId)
}

export function currentPinnedModelId(settings: AppSettings): string {
  switch (settings.llmProvider) {
    case 'ollama':
      return toScopedPinnedId('ollama', settings.ollamaModel)
    case 'nvidia':
      return toScopedPinnedId('nvidia', settings.nvidiaModel)
    case 'deepseek':
      return toScopedPinnedId('deepseek', settings.deepseekModel)
    case 'openai':
      return toScopedPinnedId('openai', settings.openaiModel)
    case 'opencode-go':
      return toScopedPinnedId('opencode-go', settings.opencodeGoModel)
    default:
      return toScopedPinnedId('openrouter', settings.openrouterModel)
  }
}

export function pinnedIdLabel(pinnedId: string): string {
  return parsePinnedId(pinnedId)?.modelId ?? pinnedId
}

export function pinBelongsToProvider(pinnedId: string, provider: LlmProvider): boolean {
  return parsePinnedId(pinnedId)?.provider === provider
}

export function pinsForProvider(pinned: string[], provider: LlmProvider): string[] {
  return pinned.filter((id) => pinBelongsToProvider(id, provider))
}

/**
 * Migrate legacy bare / partially-scoped pins into `provider:modelId`.
 * Ambiguous bare ids that exist in OpenRouter + NVIDIA prefer OpenRouter.
 */
export function normalizePinnedModels(raw: unknown, fallback?: string[]): string[] {
  const input = Array.isArray(raw)
    ? raw.filter((m): m is string => typeof m === 'string' && m.trim().length > 0)
    : null
  if (input == null) return fallback ? [...fallback] : []

  const out: string[] = []
  const seen = new Set<string>()

  for (const entry of input) {
    const migrated = migrateLegacyPin(entry.trim())
    if (!migrated || seen.has(migrated)) continue
    seen.add(migrated)
    out.push(migrated)
  }
  return out
}

function migrateLegacyPin(id: string): string | null {
  const parsed = parsePinnedId(id)
  if (parsed) return toScopedPinnedId(parsed.provider, parsed.modelId)

  if (OPENROUTER_LLM_PRESET_MODELS.some((p) => p.id === id)) {
    return toScopedPinnedId('openrouter', id)
  }
  if (NVIDIA_LLM_PRESET_MODELS.some((p) => p.id === id)) {
    return toScopedPinnedId('nvidia', id)
  }
  if (DEEPSEEK_LLM_PRESET_MODELS.some((p) => p.id === id)) {
    return toScopedPinnedId('deepseek', id)
  }
  if (OPENAI_LLM_PRESET_MODELS.some((p) => p.id === id)) {
    return toScopedPinnedId('openai', id)
  }
  if (OPENCODE_GO_LLM_PRESET_MODELS.some((p) => p.id === id)) {
    return toScopedPinnedId('opencode-go', id)
  }

  return toScopedPinnedId('openrouter', id)
}

export function applyModelSwitcherSelection(
  settings: AppSettings,
  provider: LlmProvider,
  modelId: string,
): AppSettings {
  const model = unwrapPinnedModelId(provider, modelId)
  if (!model) return settings

  if (provider === 'openrouter') {
    const map = settings.openrouterProviderByModel || {}
    return {
      ...settings,
      llmProvider: 'openrouter',
      openrouterModel: model,
      openrouterProviderOnly: (map[model] || '').trim(),
    }
  }
  if (provider === 'ollama') {
    return { ...settings, llmProvider: 'ollama', ollamaModel: model }
  }
  if (provider === 'nvidia') {
    return { ...settings, llmProvider: 'nvidia', nvidiaModel: model }
  }
  if (provider === 'deepseek') {
    return { ...settings, llmProvider: 'deepseek', deepseekModel: model }
  }
  if (provider === 'openai') {
    return { ...settings, llmProvider: 'openai', openaiModel: model }
  }
  return { ...settings, llmProvider: 'opencode-go', opencodeGoModel: model }
}
