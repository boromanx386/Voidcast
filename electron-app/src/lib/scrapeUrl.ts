export type ScrapeUrlResult = { ok: boolean; text: string }

/**
 * Fetch URL in Electron main → plain text (see `electron/main/scrape.ts`).
 */
export async function invokeScrapeUrl(
  url: string,
  maxChars?: number,
): Promise<string> {
  const vc = window.voidcast
  if (!vc?.scrapeUrl) {
    throw new Error(
      'Run Voidcast in Electron to use scrape_url (URL fetch runs in the desktop app).',
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
