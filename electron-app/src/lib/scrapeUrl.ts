import { normalizeBaseUrl } from '@/lib/settings'

export type ScrapeUrlResult = { ok: boolean; text: string }

async function invokeScrapeUrlIpc(
  url: string,
  maxChars?: number,
): Promise<string> {
  const vc = window.voidcast
  if (!vc?.scrapeUrl) {
    throw new Error(
      'Run Voidcast in Electron to use scrape_url without the TTS server tool.',
    )
  }
  const r: unknown = await vc.scrapeUrl({ url, max_chars: maxChars })
  if (typeof r === 'string') return r
  const obj = r as ScrapeUrlResult | { text?: string; ok?: boolean }
  if (obj && typeof obj === 'object' && 'text' in obj && typeof obj.text === 'string') {
    return obj.ok === false ? `Scrape failed: ${obj.text}` : obj.text
  }
  return String(r)
}

/**
 * Prefer `POST /tools/scrape` on the TTS server, then Electron main (see `electron/main/scrape.ts`).
 */
export async function invokeScrapeUrl(
  url: string,
  maxChars: number | undefined,
  ttsBaseUrl: string,
  signal?: AbortSignal,
): Promise<string> {
  const root = normalizeBaseUrl(ttsBaseUrl || 'http://127.0.0.1:8765')
  try {
    const res = await fetch(`${root}/tools/scrape`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, max_chars: maxChars }),
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
    return await invokeScrapeUrlIpc(url, maxChars)
  } catch (e) {
    throw e instanceof Error ? e : new Error(String(e))
  }
}
