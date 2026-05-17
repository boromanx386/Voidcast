import type { ToolsEnabled } from '@/lib/settings'

const HTTP_URL_RE = /(https?:\/\/[^\s)]+)(?=[\s)]|$)/i

/** User explicitly asked to search the web. */
const EXPLICIT_WEB_SEARCH_RE =
  /\b(web\s+search|search\s+(?:the\s+)?web|google|check\s+online|look\s+up\s+online|pretraži\s+(?:web|internet)|potraži\s+online|na\s+internetu|na\s+webu)\b/i

/** News / current-events phrasing (not bare "update" or "current"). */
const NEWS_FRESHNESS_RE =
  /\b(breaking\s+news|latest\s+news|news\s+today|current\s+events|headlines?\s+today|vesti\s+danas|najnovije\s+vesti|šta\s+je\s+novo)\b/i

const TIME_SENSITIVE_RE =
  /\b(what(?:'s|\s+is)\s+(?:happening|new)\s+(?:today|now)|danas\s+(?:najnovije|vesti)|trenutno\s+stanje)\b/i

const SOFT_FRESHNESS_RE =
  /\b(check\s+online|na\s+internetu|danas|najnovije|trenutno|vesti)\b/i

/** Typical coding turn — do not auto-inject web_search on round 0 unless user asked for web/news. */
const CODING_TASK_RE =
  /\b(refactor|read_file|write_file|edit_code|execute_command|list_directory|search_files|glob_files|git_|fix\s+(?:the\s+)?bug|implement|codebase|repositor(?:y|ies)|\brepo\b|typescript|javascript|python|npm\s+install|cargo\s+)\b/i

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

/**
 * Whether round-0 synthetic web_search is appropriate.
 * Uses only the user's typed message — not catalog/file hints appended to the API user blob.
 */
export function shouldForceWebSearch(
  rawUserText: string,
  opts?: { codingEnabled?: boolean },
): boolean {
  const t = rawUserText.trim()
  if (!t) return false

  const explicitWeb = EXPLICIT_WEB_SEARCH_RE.test(t)
  if (explicitWeb) return true
  if (NEWS_FRESHNESS_RE.test(t)) return true
  if (TIME_SENSITIVE_RE.test(t)) return true
  if (/\b20[2-3]\d\b/.test(t) && /\b(news|vesti|price|cena|release)\b/i.test(t)) return true
  if (SOFT_FRESHNESS_RE.test(t)) return true

  if (opts?.codingEnabled && CODING_TASK_RE.test(t) && !explicitWeb) {
    return false
  }

  return false
}

/** Search query from the user's message only (first line, no internal hints). */
export function deriveSearchQuery(rawUserText: string): string {
  const trimmed = rawUserText.trim()
  if (!trimmed) return ''
  const firstBlock = trimmed.split(/\n{2,}/)[0]?.trim() || trimmed
  const firstLine = firstBlock.split('\n')[0]?.trim() || firstBlock
  const noUrls = firstLine.replace(/https?:\/\/\S+/gi, ' ')
  const single = noUrls.replace(/\s+/g, ' ').trim()
  if (!single) return ''
  return single.length > 220 ? single.slice(0, 220).trim() : single
}

export function shouldForceWebSearchOnRoundZero(
  rawUserText: string,
  toolsEnabled: Pick<ToolsEnabled, 'webSearch' | 'coding'>,
): boolean {
  if (!toolsEnabled.webSearch) return false
  return shouldForceWebSearch(rawUserText, { codingEnabled: toolsEnabled.coding })
}

/** Tool-result style line or markdown image with http(s) URL. */
const ASSISTANT_IMAGE_URL_LINE_RE = /^\s*image_url:\s*https?:\/\//im
const ASSISTANT_MARKDOWN_IMAGE_HTTP_RE = /!\[[^\]]*\]\(https?:\/\/[^)\s]+\)/i
/** Common "here is your image" phrasing plus a URL in the same reply. */
const ASSISTANT_IMAGE_DELIVERY_RE =
  /\b(here(?:'s| is)|evo (?:je|ti)?)\s+(?:your\s+|the\s+)?(?:(?:generated|edited|modified)\s+)?(?:image|picture|slika)\b/i
const ASSISTANT_IMAGE_ACTION_CLAIM_RE =
  /\b(i(?:'ve| have)?\s+(?:generated|created|made|drawn|edited|modified))\s+(?:an?\s+)?(?:image|picture|slika)\b/i
/** Runware image CDN host only — not api.runware.ai and not music audio_url lines. */
const RUNWARE_IMAGE_CDN_RE = /https?:\/\/[^\s)>]*\bim\.runware\b/i

const MUSIC_USER_REQUEST_RE =
  /\b(music|song|songs|beat|beats|soundtrack|jingle|pesm[aue]|muzik|audio\s+track|generate\s+music|napravi\s+pesmu|runware\s+music)\b/i

export function isMusicFocusedUserText(text: string): boolean {
  return MUSIC_USER_REQUEST_RE.test(text.trim())
}

function stripMusicUrlArtifacts(text: string): string {
  return text
    .replace(/^\s*audio_url:\s*https?:\/\/\S+\s*$/gim, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * True when assistant text looks like it delivered a Runware image (URL or claim)
 * without a generate_image / edit_image_runware tool result in this turn.
 */
export function assistantClaimsImageWithoutTool(text: string): boolean {
  const t = stripMusicUrlArtifacts(text)
  if (!t) return false
  if (ASSISTANT_IMAGE_URL_LINE_RE.test(t)) return true
  if (ASSISTANT_MARKDOWN_IMAGE_HTTP_RE.test(t)) return true
  if (RUNWARE_IMAGE_CDN_RE.test(t)) return true
  if (ASSISTANT_IMAGE_ACTION_CLAIM_RE.test(t) && /https?:\/\//.test(t)) return true
  if (ASSISTANT_IMAGE_DELIVERY_RE.test(t) && /https?:\/\//.test(t)) return true
  return false
}

/** Skip image guard when the user asked for music (audio_url / generate_music_runware turn). */
export function shouldGuardFalseImageClaims(
  assistantText: string,
  rawUserText: string,
): boolean {
  if (isMusicFocusedUserText(rawUserText)) return false
  return assistantClaimsImageWithoutTool(assistantText)
}

/** Shown to the model only (API user turn); must not encourage meta-apologies in chat. */
export const FALSE_IMAGE_CLAIM_REPROMPT_MESSAGE = [
  '[Internal — not for the user] Your last message described or linked an image without calling generate_image or edit_image_runware.',
  'Fix it now: call the correct image tool immediately using the user’s original request, then wait for the tool result.',
  'In your next user-visible reply: short caption only (what changed in the image). Do NOT apologize, mention mistakes, fake links, tools, reprompts, or “now it is real”.',
  'If you cannot run the tool, say briefly that image generation is unavailable — no extra explanation.',
].join(' ')
