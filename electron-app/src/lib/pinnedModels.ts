import type { AppSettings, LlmProvider } from '@/lib/settings'
import { withOpenRouterModel } from '@/lib/settings'

export const OLLAMA_PIN_PREFIX = 'ollama/'

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

/** Canonical pin id for the active provider + model (matches ModelSwitcherPopup items). */
export function currentPinnedModelId(settings: AppSettings): string {
  switch (settings.llmProvider) {
    case 'ollama':
      return toOllamaPinnedId(settings.ollamaModel)
    case 'nvidia':
      return settings.nvidiaModel
    case 'deepseek':
      return settings.deepseekModel
    case 'opencode-go':
      return settings.opencodeGoModel
    default:
      return settings.openrouterModel
  }
}

/** Apply a switcher selection: set provider and the matching model field. */
export function applyModelSwitcherSelection(
  settings: AppSettings,
  provider: LlmProvider,
  modelId: string,
): AppSettings {
  const model = modelId.trim()
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
      ollamaModel: fromOllamaPinnedId(model),
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
