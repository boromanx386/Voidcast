import type { ToolsEnabled } from '@/lib/settings'

const HTTP_URL_RE = /(https?:\/\/[^\s)]+)(?=[\s)]|$)/i
const FRESHNESS_RE =
  /\b(today|latest|recent|newest|breaking|update|updates|news|current|currently|202\d|danas|najnovije|trenutno|vesti)\b/i

export function parseToolArguments(
  raw: string | Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!raw) return {}
  if (typeof raw === 'object') return raw
  const s = raw.trim()
  if (!s) return {}
  try {
    return JSON.parse(s) as Record<string, unknown>
  } catch {
    return {}
  }
}

export function getLastUserText<T extends { role?: string; content?: unknown }>(messages: T[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m?.role === 'user') return String(m.content ?? '').trim()
  }
  return ''
}

export function pickFirstHttpUrl(text: string): string | null {
  const m = text.match(HTTP_URL_RE)
  return m?.[1]?.trim() || null
}

export function shouldForceWebSearch(userText: string): boolean {
  if (!userText.trim()) return false
  return FRESHNESS_RE.test(userText)
}

export function deriveSearchQuery(userText: string): string {
  const noUrls = userText.replace(/https?:\/\/\S+/gi, ' ')
  const single = noUrls.replace(/\s+/g, ' ').trim()
  if (!single) return userText.slice(0, 220).trim()
  return single.length > 220 ? single.slice(0, 220).trim() : single
}

export function shouldRequireToolCall(userText: string, enabled: ToolsEnabled): boolean {
  const t = userText.toLowerCase()
  if (!t) return false
  const hasUrl = /https?:\/\/\S+/i.test(userText)
  const asksImage = /\b(image|picture|draw|render|slika|fotka)\b/i.test(t)
  const asksMusic = /\b(music|song|beat|audio|muzik|pesm|traka)\b/i.test(t)
  const asksPdf = /\b(pdf|export|save as pdf|sacuvaj.*pdf)\b/i.test(t)
  const asksWeb = /\b(search|google|web|online|internet|latest|news|proveri online)\b/i.test(t)
  const asksWeather = /\b(weather|forecast|temperature|temperatura|vreme)\b/i.test(t)
  const asksYoutube = /\b(youtube|video|transcript|caption)\b/i.test(t)
  const asksScrape = hasUrl && /\b(scrape|extract|summarize|procitaj|izvuci)\b/i.test(t)
  const asksCoding = /\b(list|read|write|edit|search|glob|git|command|terminal|fajl|folder)\b/i.test(t)
  const asksSettings = /\b(change|set|update|podesi|promeni)\b/i.test(t) &&
    /\b(setting|temperature|context|theme|model|rezoluc|prompt)\b/i.test(t)
  return (
    (enabled.runwareImage && asksImage) ||
    (enabled.runwareMusic && asksMusic) ||
    (enabled.pdf && asksPdf) ||
    (enabled.webSearch && asksWeb) ||
    (enabled.weather && asksWeather) ||
    (enabled.youtube && asksYoutube) ||
    (enabled.scrape && asksScrape) ||
    (enabled.coding && asksCoding) ||
    asksSettings
  )
}
