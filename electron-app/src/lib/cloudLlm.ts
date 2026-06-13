import type { AppSettings, LlmProvider } from '@/lib/settings'
import { normalizeRunwareLlmModelId } from '@/lib/settings'

export type CloudLlmConfig = {
  baseUrl: string
  apiKey: string
  model: string
}

export function isCloudLlmProvider(provider: LlmProvider): boolean {
  return provider === 'openrouter' || provider === 'nvidia' || provider === 'runware'
}

export function resolveCloudLlmConfig(
  settings: AppSettings,
  options?: { provider?: LlmProvider; modelOverride?: string },
): CloudLlmConfig | null {
  const provider = options?.provider ?? settings.llmProvider
  if (!isCloudLlmProvider(provider)) return null

  if (provider === 'nvidia') {
    return {
      baseUrl: settings.nvidiaBaseUrl,
      apiKey: settings.nvidiaApiKey,
      model: options?.modelOverride?.trim() || settings.nvidiaModel,
    }
  }
  if (provider === 'runware') {
    return {
      baseUrl: settings.runwareApiBaseUrl,
      apiKey: settings.runwareApiKey,
      model: normalizeRunwareLlmModelId(options?.modelOverride?.trim() || settings.runwareLlmModel),
    }
  }
  return {
    baseUrl: settings.openrouterBaseUrl,
    apiKey: settings.openrouterApiKey,
    model: options?.modelOverride?.trim() || settings.openrouterModel,
  }
}
