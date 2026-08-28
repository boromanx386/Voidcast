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
  /\b(refactor|read_file|write_file|edit_code|execute_command|list_directory|search_files|glob_files|find_symbols|git_|fix\s+(?:the\s+)?bug|implement|codebase|repositor(?:y|ies)|\brepo\b|typescript|javascript|python|npm\s+install|cargo\s+)\b/i

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

const ASSISTANT_AUDIO_URL_LINE_RE = /^\s*audio_url:\s*https?:\/\//im
const ASSISTANT_MUSIC_DELIVERY_RE =
  /\b(here(?:'s| is)|evo (?:je|ti)?)\s+(?:your\s+|the\s+)?(?:(?:generated|created)\s+)?(?:song|music|track|beat|audio|pesm[aue])\b/i
const ASSISTANT_MUSIC_ACTION_CLAIM_RE =
  /\b(i(?:'ve| have)?\s+(?:generated|created|made|composed))\s+(?:a\s+)?(?:song|music|track|beat|audio|pesm[aue])\b/i

const IMAGE_USER_REQUEST_RE =
  /\b(generate_image|edit_image|draw|slika|picture|chart|diagram|infographic|image)\b/i

export function isImageFocusedUserText(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  if (isMusicFocusedUserText(t)) return false
  return IMAGE_USER_REQUEST_RE.test(t)
}

/**
 * True when assistant text looks like it delivered Runware music (URL or claim)
 * without a generate_music_runware tool result in this turn.
 */
export function assistantClaimsMusicWithoutTool(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  if (ASSISTANT_AUDIO_URL_LINE_RE.test(t)) return true
  if (ASSISTANT_MUSIC_ACTION_CLAIM_RE.test(t) && /https?:\/\//.test(t)) return true
  if (ASSISTANT_MUSIC_DELIVERY_RE.test(t) && /https?:\/\//.test(t)) return true
  return false
}

/** Skip music guard when the user asked for an image, not audio. */
export function shouldGuardFalseMusicClaims(
  assistantText: string,
  rawUserText: string,
): boolean {
  if (isImageFocusedUserText(rawUserText)) return false
  return assistantClaimsMusicWithoutTool(assistantText)
}

/** Coding tools whose execution proves an action claim ("edited/saved/ran") is real. */
export const CODING_ACTION_TOOLS = new Set([
  'write_file',
  'edit_code',
  'execute_command',
  'stop_process',
  'git_restore',
  'git_stash',
])

/**
 * Tools whose calls are read-only and can safely run concurrently within one
 * provider tool round. Unknown tools stay serial so newly added integrations
 * do not accidentally gain parallel side effects.
 */
export const PARALLEL_SAFE_AGENT_TOOLS: ReadonlySet<string> = new Set([
  'web_search',
  'get_weather',
  'scrape_url',
  'reddit_feed',
  'search_youtube',
  'list_directory',
  'read_file',
  'search_files',
  'glob_files',
  'find_symbols',
  'list_processes',
  'read_process_output',
  'list_reminders',
  'read_skill',
  'mcp_read_result',
])

export function isParallelSafeAgentTool(name: string): boolean {
  return PARALLEL_SAFE_AGENT_TOOLS.has(name)
}

/** User asked for a concrete coding action (change/run), not just a question. */
const CODING_ACTION_REQUEST_RE =
  /\b(fix|change|edit|update|modify|refactor|rename|implement|create|write|save|remove|delete|run|execute|build|install|apply|patch|add\s+(?:a|the|an|new|to)\b|popravi|ispravi|izmeni|promeni|sredi|dodaj|napravi|kreiraj|napiši|sačuvaj|obriši|ukloni|pokreni|izvrši|implementiraj|refaktoriši|uradi)/i

/** First-person past-tense action claim (English). */
const ASSISTANT_CODING_DONE_CLAIM_EN_RE =
  /\bi(?:'ve| have)?\s+(?:now\s+|also\s+|just\s+|successfully\s+)?(?:created|saved|wrote|written|edited|updated|modified|changed|fixed|implemented|refactored|applied|added|removed|deleted|renamed|patched)\b/i

/** First-person past-tense action claim (Serbian, both word orders). */
const ASSISTANT_CODING_DONE_CLAIM_SR_RE =
  /\b(?:(?:napravi|kreira|sačuva|snimi|izmeni|ažurira|popravi|ispravi|implementira|refaktorisa|doda|obrisa|ukloni|pokrenu|izvrši|primeni|uradi)(?:o|la)\s+sam|sam\s+(?:napravi|kreira|sačuva|snimi|izmeni|ažurira|popravi|ispravi|implementira|refaktorisa|doda|obrisa|ukloni|pokrenu|izvrši|primeni|uradi)(?:o|la))\b/i

/** Passive "file was saved / changes have been applied" phrasing. */
const ASSISTANT_CODING_PASSIVE_CLAIM_RE =
  /\b(?:(?:file|fajl)\w*\s+(?:has\s+been|have\s+been|was|were|is\s+now|are\s+now|je|su)\s+(?:created|saved|updated|edited|written|modified|kreiran\w*|sačuvan\w*|izmenjen\w*|ažuriran\w*)|(?:changes?|izmen[ae])\s+(?:have\s+been|has\s+been|are|su)\s+(?:applied|saved|made|primenjen\w*|sačuvan\w*))\b/i

/** "I ran the command/tests/build" style claim. */
const ASSISTANT_CODING_RUN_CLAIM_RE =
  /\bi(?:'ve| have)?\s+(?:ran|run|executed|started)\s+(?:the\s+)?(?:command|tests?|build|script|typecheck|npm|server)\b/i

/** Claim must be anchored to code/file context to avoid firing on generic prose. */
const CODING_CONTEXT_RE =
  /\b(file|files|fajl\w*|code|kod\w*|function|funkcij\w*|class|klas[aeu]\w*|component|komponent\w*|module|modul\w*|script|skript\w*|config|test\w*|command|komand\w*|import\w*|bug\w*)\b|\.\w{1,5}\b/i

/** Truthful references to earlier turns ("I edited it earlier") are not false claims. */
const PAST_TURN_REFERENCE_RE =
  /\b(earlier|previously|prethodno|ranije|malopre|u\s+prethodn\w+)\b/i

/**
 * True when assistant text claims a coding action (edit/write/run) was performed
 * without a write_file / edit_code / execute_command tool result in this turn.
 */
export function assistantClaimsCodingActionWithoutTool(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  if (PAST_TURN_REFERENCE_RE.test(t)) return false
  if (ASSISTANT_CODING_PASSIVE_CLAIM_RE.test(t)) return true
  if (ASSISTANT_CODING_RUN_CLAIM_RE.test(t)) return true
  if (
    (ASSISTANT_CODING_DONE_CLAIM_EN_RE.test(t) || ASSISTANT_CODING_DONE_CLAIM_SR_RE.test(t)) &&
    CODING_CONTEXT_RE.test(t)
  ) {
    return true
  }
  return false
}

/** Guard only when the user actually requested a coding action this turn. */
export function shouldGuardFalseCodingClaims(
  assistantText: string,
  rawUserText: string,
): boolean {
  if (!CODING_ACTION_REQUEST_RE.test(rawUserText.trim())) return false
  return assistantClaimsCodingActionWithoutTool(assistantText)
}

/** Shown to the model only (API user turn); must not encourage meta-apologies in chat. */
export const FALSE_CODING_CLAIM_REPROMPT_MESSAGE = [
  '[Internal — not for the user] Your last message claimed a file was created/edited/saved or a command was run, but no write_file, edit_code, or execute_command tool was called this turn. Nothing was actually done.',
  'Fix it now: call the correct coding tool(s) immediately to perform the work for real, then wait for the tool results.',
  'In your next user-visible reply: report only what the tools actually did, based on their results. Do NOT apologize, mention mistakes, tools, or reprompts, and never claim work is done without a successful tool result in this turn.',
  'If you cannot run the tools, say briefly that the coding action could not be performed — no extra explanation.',
].join(' ')

/** Shown to the model only (API user turn); must not encourage meta-apologies in chat. */
export const FALSE_MUSIC_CLAIM_REPROMPT_MESSAGE = [
  '[Internal — not for the user] Your last message described or linked music/audio without calling generate_music_runware.',
  'Fix it now: call generate_music_runware immediately using the user’s original request, then wait for the tool result.',
  'In your next user-visible reply: short caption only (title/mood of the track). Do NOT paste audio_url lines, apologize, mention mistakes, fake links, tools, or reprompts.',
  'If you cannot run the tool, say briefly that music generation is unavailable — no extra explanation.',
].join(' ')

/** Shown to the model only (API user turn); must not encourage meta-apologies in chat. */
export const FALSE_IMAGE_CLAIM_REPROMPT_MESSAGE = [
  '[Internal — not for the user] Your last message described or linked an image without calling generate_image or edit_image_runware.',
  'Fix it now: call the correct image tool immediately using the user’s original request, then wait for the tool result.',
  'In your next user-visible reply: short caption only (what changed in the image). Do NOT apologize, mention mistakes, fake links, tools, reprompts, or “now it is real”.',
  'If you cannot run the tool, say briefly that image generation is unavailable — no extra explanation.',
].join(' ')

/** Soft nudge near the end of the tool-call budget (model-only). */
export const TOOL_BUDGET_WARNING_REPROMPT_MESSAGE = [
  '[Internal — not for the user] You are nearing the tool-call budget for this turn.',
  'Prefer finishing soon: only essential remaining tool calls, then give the user a clear final answer without more tools.',
  'Do not mention this budget warning in the user-visible reply.',
].join(' ')

/** Hard wrap-up after the tool budget is exhausted (model-only). */
export const TOOL_BUDGET_EXHAUSTED_REPROMPT_MESSAGE = [
  '[Internal — not for the user] The tool-call budget for this turn is exhausted. Do NOT call any more tools.',
  'Write a final user-visible reply now: what you completed, what is still incomplete, and one concrete next step for the user.',
  'Do not apologize at length about limits; keep it practical and grounded in tool results already received.',
].join(' ')

export const TOOL_BUDGET_EXHAUSTED_FALLBACK_REPLY =
  'Stopped: tool-call budget reached this turn before a final answer. Tell me to continue and I will pick up from here.'
