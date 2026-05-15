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

/** Tool-result style line or markdown image with http(s) URL. */
const ASSISTANT_IMAGE_URL_LINE_RE = /^\s*image_url:\s*https?:\/\//im
const ASSISTANT_MARKDOWN_IMAGE_HTTP_RE = /!\[[^\]]*\]\(https?:\/\/[^)\s]+\)/i
/** Common "here is your image" phrasing plus a URL in the same reply. */
const ASSISTANT_IMAGE_DELIVERY_RE =
  /\b(here(?:'s| is)|evo (?:je|ti)?)\s+(?:your\s+|the\s+)?(?:(?:generated|edited|modified)\s+)?(?:image|picture|slika)\b/i
const ASSISTANT_IMAGE_ACTION_CLAIM_RE =
  /\b(i(?:'ve| have)?\s+(?:generated|created|made|drawn|edited|modified))\s+(?:an?\s+)?(?:image|picture|slika)\b/i
const RUNWARE_IMAGE_HOST_RE = /https?:\/\/[^\s)>]*(?:runware\.ai|im\.runware)/i

/**
 * True when assistant text looks like it delivered a Runware image (URL or claim)
 * without a generate_image / edit_image_runware tool result in this turn.
 */
export function assistantClaimsImageWithoutTool(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  if (ASSISTANT_IMAGE_URL_LINE_RE.test(t)) return true
  if (ASSISTANT_MARKDOWN_IMAGE_HTTP_RE.test(t)) return true
  if (RUNWARE_IMAGE_HOST_RE.test(t)) return true
  if (ASSISTANT_IMAGE_ACTION_CLAIM_RE.test(t) && /https?:\/\//.test(t)) return true
  if (ASSISTANT_IMAGE_DELIVERY_RE.test(t) && /https?:\/\//.test(t)) return true
  return false
}

/** Shown to the model only (API user turn); must not encourage meta-apologies in chat. */
export const FALSE_IMAGE_CLAIM_REPROMPT_MESSAGE = [
  '[Internal — not for the user] Your last message described or linked an image without calling generate_image or edit_image_runware.',
  'Fix it now: call the correct image tool immediately using the user’s original request, then wait for the tool result.',
  'In your next user-visible reply: short caption only (what changed in the image). Do NOT apologize, mention mistakes, fake links, tools, reprompts, or “now it is real”.',
  'If you cannot run the tool, say briefly that image generation is unavailable — no extra explanation.',
].join(' ')
