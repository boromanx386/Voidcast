import type { AppSettings, LlmProvider, LlmThinkLevel } from '@/lib/settings'

export function isOpenAiCompatibleCloudLlmProvider(provider: LlmProvider): boolean {
  return provider === 'openrouter' || provider === 'nvidia' || provider === 'deepseek'
}

export type CloudLlmChatConfig = {
  baseUrl: string
  apiKey: string
  model: string
  thinkLevel?: LlmThinkLevel
  /** OpenRouter provider slug lock (provider.only, no fallbacks). */
  providerOnly?: string
}

export type CloudLlmSettingsSlice = {
  openrouterBaseUrl: string
  openrouterApiKey: string
  openrouterModel: string
  openrouterProviderOnly?: string
  nvidiaBaseUrl?: string
  nvidiaApiKey?: string
  nvidiaModel?: string
  deepseekBaseUrl?: string
  deepseekApiKey?: string
  deepseekModel?: string
  llmThinkLevel?: LlmThinkLevel
}

export function resolveCloudLlmChatConfig(
  settings: Pick<AppSettings, 'llmProvider'> & CloudLlmSettingsSlice,
): CloudLlmChatConfig | null {
  switch (settings.llmProvider) {
    case 'openrouter':
      return {
        baseUrl: settings.openrouterBaseUrl,
        apiKey: settings.openrouterApiKey,
        model: settings.openrouterModel,
        providerOnly: settings.openrouterProviderOnly?.trim() || undefined,
      }
    case 'nvidia':
      return {
        baseUrl: settings.nvidiaBaseUrl || '',
        apiKey: settings.nvidiaApiKey || '',
        model: settings.nvidiaModel || '',
      }
    case 'deepseek':
      return {
        baseUrl: settings.deepseekBaseUrl || '',
        apiKey: settings.deepseekApiKey || '',
        model: settings.deepseekModel || '',
        thinkLevel: settings.llmThinkLevel,
      }
    default:
      return null
  }
}

export function resolveCloudLlmChatConfigForProvider(
  provider: LlmProvider,
  settings: CloudLlmSettingsSlice,
  modelOverride?: string,
): CloudLlmChatConfig | null {
  switch (provider) {
    case 'openrouter':
      return {
        baseUrl: settings.openrouterBaseUrl,
        apiKey: settings.openrouterApiKey,
        model: modelOverride || settings.openrouterModel,
        providerOnly: settings.openrouterProviderOnly?.trim() || undefined,
      }
    case 'nvidia':
      return {
        baseUrl: settings.nvidiaBaseUrl || '',
        apiKey: settings.nvidiaApiKey || '',
        model: modelOverride || settings.nvidiaModel || '',
      }
    case 'deepseek':
      return {
        baseUrl: settings.deepseekBaseUrl || '',
        apiKey: settings.deepseekApiKey || '',
        model: modelOverride || settings.deepseekModel || '',
        thinkLevel: settings.llmThinkLevel,
      }
    default:
      return null
  }
}
