import type { AppSettings, LlmProvider } from '@/lib/settings'
import { withOpenRouterModel } from '@/lib/settings'

export const OLLAMA_PIN_PREFIX = 'ollama/'
export const DEEPSEEK_PIN_PREFIX = 'deepseek:'
export const OPENCODE_GO_PIN_PREFIX = 'opencode-go:'

export function toOllamaPinnedId(modelName: string): string {
  const name = modelName.trim()
  if (!name) return ''
  return name.startsWith(OLLAMA_PIN_PREFIX) ? name : `${OLLAMA_PIN_PREFIX}${name}`
}

export function fromOllamaPinnedId(pinnedId: string): string {
  return pinnedId.startsWith(OLLAMA_PIN_PREFIX)
    ? pinnedId.slice(OLLAMA_PIN_PREFIX.length)
    : pinnedId
}

/** Scoped pin id so DeepSeek and OpenCode Go can both pin the same model name. */
export function toScopedPinnedId(provider: LlmProvider, modelId: string): string {
  const model = modelId.trim()
  if (!model) return ''
  if (provider === 'ollama') return toOllamaPinnedId(model)
  if (provider === 'deepseek') {
    return model.startsWith(DEEPSEEK_PIN_PREFIX) ? model : `${DEEPSEEK_PIN_PREFIX}${model}`
  }
  if (provider === 'opencode-go') {
    return model.startsWith(OPENCODE_GO_PIN_PREFIX) ? model : `${OPENCODE_GO_PIN_PREFIX}${model}`
  }
  // OpenRouter / NVIDIA ids are already globally unique enough.
  return model
}

export function parsePinnedId(
  pinnedId: string,
): { provider: LlmProvider; modelId: string } | null {
  const id = pinnedId.trim()
  if (!id) return null
  if (id.startsWith(OLLAMA_PIN_PREFIX)) {
    return { provider: 'ollama', modelId: fromOllamaPinnedId(id) }
  }
  if (id.startsWith(DEEPSEEK_PIN_PREFIX)) {
    return { provider: 'deepseek', modelId: id.slice(DEEPSEEK_PIN_PREFIX.length) }
  }
  if (id.startsWith(OPENCODE_GO_PIN_PREFIX)) {
    return { provider: 'opencode-go', modelId: id.slice(OPENCODE_GO_PIN_PREFIX.length) }
  }
  return null
}

/** Strip provider scope from a pin/switcher id when applying to settings. */
export function unwrapPinnedModelId(provider: LlmProvider, modelId: string): string {
  const parsed = parsePinnedId(modelId)
  if (parsed && parsed.provider === provider) return parsed.modelId
  if (provider === 'ollama') return fromOllamaPinnedId(modelId)
  if (provider === 'deepseek' && modelId.startsWith(DEEPSEEK_PIN_PREFIX)) {
    return modelId.slice(DEEPSEEK_PIN_PREFIX.length)
  }
  if (provider === 'opencode-go' && modelId.startsWith(OPENCODE_GO_PIN_PREFIX)) {
    return modelId.slice(OPENCODE_GO_PIN_PREFIX.length)
  }
  return modelId.trim()
}

/** Canonical pin id for the active provider + model (matches ModelSwitcherPopup items). */
export function currentPinnedModelId(settings: AppSettings): string {
  switch (settings.llmProvider) {
    case 'ollama':
      return toOllamaPinnedId(settings.ollamaModel)
    case 'nvidia':
      return settings.nvidiaModel
    case 'deepseek':
      return toScopedPinnedId('deepseek', settings.deepseekModel)
    case 'opencode-go':
      return toScopedPinnedId('opencode-go', settings.opencodeGoModel)
    default:
      return settings.openrouterModel
  }
}

/** Display label for a pinned id (strips known scopes). */
export function pinnedIdLabel(pinnedId: string): string {
  const parsed = parsePinnedId(pinnedId)
  return parsed?.modelId ?? pinnedId
}

/** Whether a stored pin belongs to this provider (includes legacy bare DeepSeek ids). */
export function pinBelongsToProvider(
  pinnedId: string,
  provider: LlmProvider,
  legacyBareIds?: ReadonlySet<string>,
): boolean {
  const parsed = parsePinnedId(pinnedId)
  if (parsed) return parsed.provider === provider
  // Bare legacy ids are treated as DeepSeek only (OpenCode Go always uses scoped pins).
  if (provider === 'deepseek' && legacyBareIds?.has(pinnedId)) return true
  if ((provider === 'openrouter' || provider === 'nvidia') && legacyBareIds?.has(pinnedId)) {
    return true
  }
  return false
}

/** Apply a switcher selection: set provider and the matching model field. */
export function applyModelSwitcherSelection(
  settings: AppSettings,
  provider: LlmProvider,
  modelId: string,
): AppSettings {
  const model = unwrapPinnedModelId(provider, modelId)
  if (!model) return settings

  if (provider === 'openrouter') {
    return {
      ...settings,
      llmProvider: 'openrouter',
      ...withOpenRouterModel(settings, model),
    }
  }
  if (provider === 'ollama') {
    return {
      ...settings,
      llmProvider: 'ollama',
      ollamaModel: model,
    }
  }
  if (provider === 'nvidia') {
    return { ...settings, llmProvider: 'nvidia', nvidiaModel: model }
  }
  if (provider === 'deepseek') {
    return { ...settings, llmProvider: 'deepseek', deepseekModel: model }
  }
  return { ...settings, llmProvider: 'opencode-go', opencodeGoModel: model }
}
