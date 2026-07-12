import { isElectron } from '@/lib/platform'
import { normalizeBaseUrl } from '@/lib/settings'

export type CloudSecretsPayload = {
  openrouterApiKey: string
  runwareApiKey: string
  nvidiaApiKey: string
  deepseekApiKey: string
}

/** Push API keys from desktop to the local TTS server for LAN web proxy (not full settings sync). */
export async function pushCloudSecretsToServer(
  ttsBaseUrl: string,
  secrets: CloudSecretsPayload,
): Promise<void> {
  if (!isElectron()) return
  const root = normalizeBaseUrl(ttsBaseUrl.trim() || 'http://127.0.0.1:8765')
  await fetch(`${root}/tools/cloud-secrets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(secrets),
  })
}

/** Clear desktop-registered keys from the TTS server (LAN web access disabled). */
export async function clearCloudSecretsFromServer(ttsBaseUrl: string): Promise<void> {
  if (!isElectron()) return
  const root = normalizeBaseUrl(ttsBaseUrl.trim() || 'http://127.0.0.1:8765')
  await fetch(`${root}/tools/cloud-secrets`, { method: 'DELETE' })
}
