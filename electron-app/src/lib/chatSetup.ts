import type { AppSettings, LlmProvider } from '@/lib/settings'

/** What blocks the very first chat turn, so the empty chat can say how to fix it. */
export type ChatSetupNeed =
  | { kind: 'ready' }
  | { kind: 'cloud-key'; provider: KeyedCloudProvider }
  | { kind: 'custom-endpoint' }
  | { kind: 'ollama-unreachable' }
  | { kind: 'ollama-no-models' }
  | { kind: 'ollama-model' }

/** Cloud providers that cannot answer without a key. Custom is left out: local servers need none. */
export type KeyedCloudProvider = Exclude<LlmProvider, 'ollama' | 'custom'>

export type OllamaProbe = {
  models: string[]
  loading: boolean
  error: string | null
}

export const CLOUD_KEY_URL: Record<KeyedCloudProvider, string> = {
  openrouter: 'https://openrouter.ai/keys',
  nvidia: 'https://build.nvidia.com/',
  deepseek: 'https://platform.deepseek.com/api_keys',
  'opencode-go': 'https://opencode.ai/auth',
}

export const CLOUD_KEY_FIELD: Record<
  KeyedCloudProvider,
  keyof Pick<
    AppSettings,
    'openrouterApiKey' | 'nvidiaApiKey' | 'deepseekApiKey' | 'opencodeGoApiKey'
  >
> = {
  openrouter: 'openrouterApiKey',
  nvidia: 'nvidiaApiKey',
  deepseek: 'deepseekApiKey',
  'opencode-go': 'opencodeGoApiKey',
}

export function chatSetupNeed(
  settings: Pick<
    AppSettings,
    | 'llmProvider'
    | 'ollamaModel'
    | 'openrouterApiKey'
    | 'nvidiaApiKey'
    | 'deepseekApiKey'
    | 'opencodeGoApiKey'
    | 'customBaseUrl'
    | 'customModel'
  >,
  ollama: OllamaProbe,
): ChatSetupNeed {
  const provider = settings.llmProvider
  if (provider === 'custom') {
    return settings.customBaseUrl.trim() && settings.customModel.trim()
      ? { kind: 'ready' }
      : { kind: 'custom-endpoint' }
  }
  if (provider !== 'ollama') {
    return settings[CLOUD_KEY_FIELD[provider]].trim()
      ? { kind: 'ready' }
      : { kind: 'cloud-key', provider }
  }
  // A chosen model is trusted even while the probe runs or fails: the send path reports
  // its own error, and a flashing setup card on every slow start would be worse.
  if (settings.ollamaModel.trim()) return { kind: 'ready' }
  if (ollama.loading) return { kind: 'ollama-model' }
  if (ollama.error) return { kind: 'ollama-unreachable' }
  if (ollama.models.length === 0) return { kind: 'ollama-no-models' }
  return { kind: 'ollama-model' }
}
