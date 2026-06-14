import type { AppSettings } from '@/lib/settings'

export function llmModelLabel(settings: AppSettings): string {
  switch (settings.llmProvider) {
    case 'ollama':
      return settings.ollamaModel
    case 'nvidia':
      return settings.nvidiaModel
    case 'deepseek':
      return settings.deepseekModel
    default:
      return settings.openrouterModel
  }
}

export function llmProviderTitle(settings: AppSettings): string {
  return `${settings.llmProvider}: ${llmModelLabel(settings)}`
}
