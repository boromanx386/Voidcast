import type { AppSettings, LlmProvider, LlmThinkLevel } from '@/lib/settings'
import { usesServerCloudProxy } from '@/lib/platform'

export function cloudLlmProviderLabel(provider: LlmProvider): string {
  switch (provider) {
    case 'openrouter':
      return 'OpenRouter'
    case 'nvidia':
      return 'NVIDIA'
    case 'deepseek':
      return 'DeepSeek'
    case 'opencode-go':
      return 'OpenCode Go'
    default:
      return 'Cloud LLM'
  }
}

export function assertCloudLlmApiKey(provider: LlmProvider, apiKey: string): void {
  if (usesServerCloudProxy()) return
  if (apiKey.trim()) return
  const label = cloudLlmProviderLabel(provider)
  throw new Error(
    `${label} API key is missing. Open Options → General, paste your ${label} key, and try again. ` +
      'If keys disappeared after a recent app restart, re-enter them once (a settings sync bug may have cleared them).',
  )
}

export function isOpenAiCompatibleCloudLlmProvider(provider: LlmProvider): boolean {
  return (
    provider === 'openrouter' ||
    provider === 'nvidia' ||
    provider === 'deepseek' ||
    provider === 'opencode-go'
  )
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
  opencodeGoBaseUrl?: string
  opencodeGoApiKey?: string
  opencodeGoModel?: string
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
    case 'opencode-go':
      return {
        baseUrl: settings.opencodeGoBaseUrl || '',
        apiKey: settings.opencodeGoApiKey || '',
        model: settings.opencodeGoModel || '',
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
    case 'opencode-go':
      return {
        baseUrl: settings.opencodeGoBaseUrl || '',
        apiKey: settings.opencodeGoApiKey || '',
        model: modelOverride || settings.opencodeGoModel || '',
      }
    default:
      return null
  }
}
