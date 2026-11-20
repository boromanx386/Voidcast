import type { AppSettings, LlmProvider } from '@/lib/settings'

/** What blocks the very first chat turn, so the empty chat can say how to fix it. */
export type ChatSetupNeed =
  | { kind: 'ready' }
  | { kind: 'cloud-key'; provider: Exclude<LlmProvider, 'ollama'> }
  | { kind: 'ollama-unreachable' }
  | { kind: 'ollama-no-models' }
  | { kind: 'ollama-model' }

export type OllamaProbe = {
  models: string[]
  loading: boolean
  error: string | null
}

export const CLOUD_KEY_URL: Record<Exclude<LlmProvider, 'ollama'>, string> = {
  openrouter: 'https://openrouter.ai/keys',
  nvidia: 'https://build.nvidia.com/',
  deepseek: 'https://platform.deepseek.com/api_keys',
  openai: 'https://platform.openai.com/api-keys',
  'opencode-go': 'https://opencode.ai/auth',
}

export const CLOUD_KEY_FIELD: Record<
  Exclude<LlmProvider, 'ollama'>,
  keyof Pick<
    AppSettings,
    'openrouterApiKey' | 'nvidiaApiKey' | 'deepseekApiKey' | 'openaiApiKey' | 'opencodeGoApiKey'
  >
> = {
  openrouter: 'openrouterApiKey',
  nvidia: 'nvidiaApiKey',
  deepseek: 'deepseekApiKey',
  openai: 'openaiApiKey',
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
    | 'openaiApiKey'
    | 'opencodeGoApiKey'
  >,
  ollama: OllamaProbe,
): ChatSetupNeed {
  const provider = settings.llmProvider
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
