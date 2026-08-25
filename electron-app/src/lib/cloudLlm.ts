import type { AppSettings, LlmProvider, LlmThinkLevel } from '@/lib/settings'
import { opencodeGoApiBaseForRuntime, usesServerCloudProxy } from '@/lib/platform'

export function cloudLlmProviderLabel(provider: LlmProvider): string {
  switch (provider) {
    case 'openrouter':
      return 'OpenRouter'
    case 'nvidia':
      return 'NVIDIA'
    case 'deepseek':
      return 'DeepSeek'
    case 'openai':
      return 'OpenAI'
    case 'opencode-go':
      return 'OpenCode Go'
    case 'crofai':
      return 'CrofAI'
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
    provider === 'openai' ||
    provider === 'opencode-go' ||
    provider === 'crofai'
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
  openaiBaseUrl?: string
  openaiApiKey?: string
  openaiModel?: string
  opencodeGoBaseUrl?: string
  opencodeGoApiKey?: string
  opencodeGoModel?: string
  crofaiBaseUrl?: string
  crofaiApiKey?: string
  crofaiModel?: string
  /** Used to reach local TTS reverse proxy for OpenCode Go (no CORS on upstream). */
  ttsBaseUrl?: string
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
    case 'openai':
      return {
        baseUrl: settings.openaiBaseUrl || '',
        apiKey: settings.openaiApiKey || '',
        model: settings.openaiModel || '',
      }
    case 'opencode-go':
      return {
        // Upstream has no CORS; always use local TTS reverse proxy (desktop + LAN).
        baseUrl: opencodeGoApiBaseForRuntime(settings.opencodeGoBaseUrl, settings.ttsBaseUrl),
        apiKey: settings.opencodeGoApiKey || '',
        model: settings.opencodeGoModel || '',
        // Keep thinking on by default (DeepSeek/Kimi via Go); respect user think level.
        thinkLevel: settings.llmThinkLevel,
      }
    case 'crofai':
      return {
        baseUrl: settings.crofaiBaseUrl || '',
        apiKey: settings.crofaiApiKey || '',
        model: settings.crofaiModel || '',
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
    case 'openai':
      return {
        baseUrl: settings.openaiBaseUrl || '',
        apiKey: settings.openaiApiKey || '',
        model: modelOverride || settings.openaiModel || '',
      }
    case 'opencode-go':
      return {
        baseUrl: opencodeGoApiBaseForRuntime(settings.opencodeGoBaseUrl, settings.ttsBaseUrl),
        apiKey: settings.opencodeGoApiKey || '',
        model: modelOverride || settings.opencodeGoModel || '',
        thinkLevel: settings.llmThinkLevel,
      }
    case 'crofai':
      return {
        baseUrl: settings.crofaiBaseUrl || '',
        apiKey: settings.crofaiApiKey || '',
        model: modelOverride || settings.crofaiModel || '',
        thinkLevel: settings.llmThinkLevel,
      }
    default:
      return null
  }
}
