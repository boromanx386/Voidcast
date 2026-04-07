import { normalizeBaseUrl } from '@/lib/settings'

export type WebSearchResult = { ok: boolean; text: string }

async function invokeWebSearchIpc(query: string): Promise<string> {
  const vc = window.voidcast
  if (!vc?.webSearch) {
    throw new Error(
      'Run Voidcast in Electron, or start the TTS server with duckduckgo-search for POST /tools/search.',
    )
  }
  const r: unknown = await vc.webSearch(query)
  if (typeof r === 'string') return r
  const obj = r as WebSearchResult | { text?: string; ok?: boolean }
  if (obj && typeof obj === 'object' && 'text' in obj && typeof obj.text === 'string') {
    return obj.ok === false ? `Search failed: ${obj.text}` : obj.text
  }
  return String(r)
}

/**
 * Prefer DDGS on the TTS server (`POST /tools/search`), then DuckDuckGo Instant
 * Answer via Electron main.
 */
export async function invokeWebSearch(
  query: string,
  ttsBaseUrl: string,
  signal?: AbortSignal,
): Promise<string> {
  const root = normalizeBaseUrl(ttsBaseUrl || 'http://127.0.0.1:8765')
  try {
    const res = await fetch(`${root}/tools/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
      signal,
    })
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean
      text?: string
      detail?: string
    }
    if (res.ok && data.ok && typeof data.text === 'string' && data.text.length > 0) {
      return data.text
    }
  } catch {
    /* TTS off or unreachable */
  }

  try {
    return await invokeWebSearchIpc(query)
  } catch (e) {
    throw e instanceof Error ? e : new Error(String(e))
  }
}
