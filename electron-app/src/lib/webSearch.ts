import { normalizeBaseUrl } from '@/lib/settings'

export type WebSearchResult = { ok: boolean; text: string }

async function invokeWebSearchIpc(query: string): Promise<string> {
  const vc = window.voidcast
  if (!vc?.webSearch) {
    throw new Error(
      'Run Voidcast in Electron, or start the TTS server with `pip install ddgs` for POST /tools/search.',
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
 * Prefer `ddgs` on the TTS server (`POST /tools/search`), then DuckDuckGo Instant
 * Answer API via Electron main (weaker fallback).
 */
export async function invokeWebSearch(
  query: string,
  ttsBaseUrl: string,
  signal?: AbortSignal,
): Promise<string> {
  const root = normalizeBaseUrl(ttsBaseUrl || 'http://127.0.0.1:8765')

  // Never let the chip spin forever: cap the server round-trip and merge the
  // caller's abort signal (Stop button) with our own timeout into one signal.
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, 25000)
  const onAbort = () => controller.abort()
  if (signal) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', onAbort, { once: true })
  }

  try {
    const res = await fetch(`${root}/tools/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
      signal: controller.signal,
    })
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean
      text?: string
      detail?: string
    }
    if (res.ok && data.ok && typeof data.text === 'string' && data.text.length > 0) {
      return data.text
    }
    // Server answered with a soft failure (e.g. its own 20s timeout) — surface it
    // instead of silently falling through to the weaker IPC fallback.
    if (data.detail) return `Search failed: ${data.detail}`
    if (res.status === 504) return 'Search failed: Web search timed out'
  } catch (e) {
    // Stop was pressed → propagate immediately, do NOT retry via IPC.
    if (signal?.aborted) throw e instanceof Error ? e : new Error('Search aborted')
    // Our own client-side timeout fired → report instead of hanging.
    if (timedOut) throw new Error('Search failed: Web search timed out')
    /* TTS off or unreachable → try IPC fallback below */
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }

  try {
    return await invokeWebSearchIpc(query)
  } catch (e) {
    throw e instanceof Error ? e : new Error(String(e))
  }
}
