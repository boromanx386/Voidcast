import type { AppSettings, CustomLlmApiStyle, LlmProvider, LlmThinkLevel } from '@/lib/settings'
import { customLlmProxyBaseUrl, opencodeGoApiBaseUrl } from '@/lib/platform'
import { ANTHROPIC_VERSION } from '@/lib/anthropicMessages'

export function cloudLlmProviderLabel(provider: LlmProvider): string {
  switch (provider) {
    case 'openrouter':
      return 'OpenRouter'
    case 'nvidia':
      return 'NVIDIA'
    case 'deepseek':
      return 'DeepSeek'
    case 'custom':
      return 'Custom'
    case 'opencode-go':
      return 'OpenCode Go'
    default:
      return 'Cloud LLM'
  }
}

export function assertCloudLlmApiKey(provider: LlmProvider, apiKey: string): void {
  // A custom endpoint is often a local server that takes no key at all.
  if (apiKey.trim() || provider === 'custom') return
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
    provider === 'custom' ||
    provider === 'opencode-go'
  )
}

/** Header that carries a Custom endpoint's real base URL to the local tools proxy. */
export const CUSTOM_LLM_UPSTREAM_HEADER = 'x-voidcast-upstream'

/** Where a Custom provider request really goes, and which wire format it speaks. */
export type CustomLlmRoute = {
  upstream: string
  apiStyle: CustomLlmApiStyle
}

export function customLlmRoute(settings: {
  customBaseUrl?: string
  customApiStyle?: CustomLlmApiStyle
}): CustomLlmRoute {
  return {
    upstream: (settings.customBaseUrl || '').trim().replace(/\/+$/, ''),
    apiStyle: settings.customApiStyle || 'chat-completions',
  }
}

/**
 * Model ids a Custom endpoint lists on `GET {base}/models`. OpenAI, Anthropic and the local
 * servers (LM Studio, vLLM, llama.cpp, Ollama's /v1) all answer `{ data: [{ id }] }`; only the
 * auth header differs, and Anthropic wants a version header too.
 */
export async function fetchCustomLlmModels(opts: {
  route: CustomLlmRoute
  apiKey: string
  ttsBaseUrl?: string
  signal?: AbortSignal
}): Promise<string[]> {
  assertCustomLlmRoute(opts.route)
  const headers: Record<string, string> = { [CUSTOM_LLM_UPSTREAM_HEADER]: opts.route.upstream }
  const key = opts.apiKey.trim()
  if (opts.route.apiStyle === 'messages') {
    headers['anthropic-version'] = ANTHROPIC_VERSION
    if (key) headers['x-api-key'] = key
  } else if (key) {
    headers.Authorization = `Bearer ${key}`
  }
  const res = await fetch(`${customLlmProxyBaseUrl(opts.ttsBaseUrl)}/models`, {
    headers,
    signal: opts.signal,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`GET /models ${res.status}: ${text.slice(0, 300) || res.statusText}`)
  }
  const body = (await res.json()) as {
    data?: Array<{ id?: unknown }>
    models?: Array<{ id?: unknown }>
  }
  const list = Array.isArray(body.data) ? body.data : Array.isArray(body.models) ? body.models : []
  const ids = list
    .map((m) => (typeof m?.id === 'string' ? m.id.trim() : ''))
    .filter((id): id is string => Boolean(id))
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b))
}

/** A clear error before any request when Custom has no endpoint to send it to. */
export function assertCustomLlmRoute(route: CustomLlmRoute): void {
  if (/^https?:\/\/[^/]/i.test(route.upstream)) return
  throw new Error(
    'Custom provider has no base URL. Open Options → Agent, set the endpoint (for example https://api.openai.com/v1 or http://localhost:1234/v1), and try again.',
  )
}

export type CloudLlmChatConfig = {
  baseUrl: string
  apiKey: string
  model: string
  thinkLevel?: LlmThinkLevel
  /** OpenRouter provider slug lock (provider.only, no fallbacks). */
  providerOnly?: string
  /** Set for the Custom provider: `baseUrl` is then the local proxy root. */
  custom?: CustomLlmRoute
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
  customBaseUrl?: string
  customApiKey?: string
  customModel?: string
  customApiStyle?: CustomLlmApiStyle
  opencodeGoBaseUrl?: string
  opencodeGoApiKey?: string
  opencodeGoModel?: string
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
    case 'custom':
      return {
        baseUrl: customLlmProxyBaseUrl(settings.ttsBaseUrl),
        apiKey: settings.customApiKey || '',
        model: settings.customModel || '',
        thinkLevel: settings.llmThinkLevel,
        custom: customLlmRoute(settings),
      }
    case 'opencode-go':
      return {
        // Upstream has no CORS; always use local TTS reverse proxy (desktop + LAN).
        baseUrl: opencodeGoApiBaseUrl(settings.ttsBaseUrl),
        apiKey: settings.opencodeGoApiKey || '',
        model: settings.opencodeGoModel || '',
        // Keep thinking on by default (DeepSeek/Kimi via Go); respect user think level.
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
    case 'custom':
      return {
        baseUrl: customLlmProxyBaseUrl(settings.ttsBaseUrl),
        apiKey: settings.customApiKey || '',
        model: modelOverride || settings.customModel || '',
        thinkLevel: settings.llmThinkLevel,
        custom: customLlmRoute(settings),
      }
    case 'opencode-go':
      return {
        baseUrl: opencodeGoApiBaseUrl(settings.ttsBaseUrl),
        apiKey: settings.opencodeGoApiKey || '',
        model: modelOverride || settings.opencodeGoModel || '',
        thinkLevel: settings.llmThinkLevel,
      }
    default:
      return null
  }
}
