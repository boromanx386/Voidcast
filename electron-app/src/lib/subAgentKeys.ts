import type { AppSettings } from '@/lib/settings'
import type { SubAgentKeys } from '@/lib/subAgent'

/**
 * Sub-agent endpoints/keys mirror the ones the main LLM reads — there is no separate
 * credential path for a small side request (chat title, prompt hint). `sessionId` feeds
 * `opencodeSessionId`, which the OpenCode Go proxy uses for session affinity.
 *
 * Shared by `useChatSessions` (titles) and `useVoidcastApp` (hints): two builders would
 * drift the moment a provider gains a new endpoint field.
 */
export function subAgentKeysFromSettings(settings: AppSettings, sessionId: string): SubAgentKeys {
  return {
    ollamaBaseUrl: settings.ollamaBaseUrl,
    openrouterBaseUrl: settings.openrouterBaseUrl,
    openrouterApiKey: settings.openrouterApiKey,
    deepseekBaseUrl: settings.deepseekBaseUrl,
    deepseekApiKey: settings.deepseekApiKey,
    openaiBaseUrl: settings.openaiBaseUrl,
    openaiApiKey: settings.openaiApiKey,
    nvidiaBaseUrl: settings.nvidiaBaseUrl,
    nvidiaApiKey: settings.nvidiaApiKey,
    opencodeGoApiKey: settings.opencodeGoApiKey,
    ttsBaseUrl: settings.ttsBaseUrl,
    opencodeSessionId: sessionId,
  }
}
