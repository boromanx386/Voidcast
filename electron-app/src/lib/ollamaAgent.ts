import {
  AGENT_EDITABLE_SETTINGS_FIELDS,
  RUNWARE_CONFIGURED_MODELS,
  loadSettings,
  normalizeBaseUrl,
  normalizeSettingsCandidate,
  saveSettings,
  type AppSettings,
  type AgentEditableSettingsField,
  type ToolsEnabled,
  type UiTheme,
} from '@/lib/settings'
import { upsertMemories } from '@/lib/longMemoryStorage'
import { addReminder, listReminders, deleteReminder, updateReminder, searchRemindersByText } from '@/lib/reminderStorage'
import type { LongMemoryKind } from '@/types/longMemory'
import { buildOllamaToolsList } from '@/lib/toolDefinitions'
import { invokeWebSearch } from '@/lib/webSearch'
import { invokeGetWeather } from '@/lib/weather'
import { invokeScrapeUrl } from '@/lib/scrapeUrl'
import { invokeSavePdf } from '@/lib/savePdf'
import { invokeYoutubeTool } from '@/lib/youtubeTool'
import { invokeRedditTool, type RedditToolParams } from '@/lib/redditTool'
import {
  invokeRunwareEditImage,
  invokeRunwareGenerateImage,
  invokeRunwareGenerateMusic,
  type RunwareImageConfig,
} from '@/lib/runware'
import {
  invokeExecuteCodingCommand,
  invokeEditCodingFile,
  invokeCodingGit,
  invokeGlobCodingFiles,
  invokeListCodingDirectory,
  invokeReadCodingFile,
  invokeSearchCodingFiles,
  invokeWriteCodingFile,
} from '@/lib/codingTools'
import type {
  OllamaApiMessage,
  OllamaChatUsage,
  OllamaModelOptions,
  OllamaToolCall,
} from '@/lib/ollama'
import { fetchOllamaWithRetry, mergeOllamaUsage, parseChatStreamUsage } from '@/lib/ollama'
import { toolPhaseForAgentTool, type AgentToolUiPhase } from '@/lib/agentToolPhase'
import { runSharedToolLoop } from '@/lib/agentToolLoop'

const MAX_TOOL_ROUNDS = 30
const MAX_REQUIRED_TOOL_REPROMPTS = 2
const HTTP_URL_RE = /(https?:\/\/[^\s)]+)(?=[\s)]|$)/i
const FRESHNESS_RE =
  /\b(today|latest|recent|newest|breaking|update|updates|news|current|currently|202\d|danas|najnovije|trenutno|vesti)\b/i

function compactModelOptions(
  o: OllamaModelOptions | undefined,
): Record<string, number> | undefined {
  if (!o) return undefined
  const out: Record<string, number> = {}
  if (o.temperature !== undefined) out.temperature = o.temperature
  if (o.num_ctx !== undefined) out.num_ctx = o.num_ctx
  return Object.keys(out).length ? out : undefined
}

/** Merge streaming tool_call fragments (by index) into accumulated array */
function mergeToolCallDeltas(
  acc: OllamaToolCall[],
  incoming: OllamaToolCall[] | undefined,
): void {
  if (!incoming?.length) return
  for (const delta of incoming) {
    const idx =
      typeof delta.index === 'number'
        ? delta.index
        : Math.max(0, acc.length - 1)
    while (acc.length <= idx) {
      acc.push({ function: {} })
    }
    const cur = acc[idx]
    if (!cur.function) cur.function = {}
    if (delta.function?.name) cur.function.name = delta.function.name
    if (delta.function?.arguments != null) {
      const arg = delta.function.arguments
      if (typeof arg === 'object' && arg !== null && !Array.isArray(arg)) {
        cur.function.arguments = JSON.stringify(arg)
      } else {
        cur.function.arguments =
          (typeof cur.function.arguments === 'string' ? cur.function.arguments : '') +
          String(arg)
      }
    }
    if (delta.id) cur.id = delta.id
    if (delta.type) cur.type = delta.type
    if (typeof delta.index === 'number') cur.index = delta.index
  }
}

function parseToolArguments(raw: string | undefined): Record<string, unknown> {
  if (!raw?.trim()) return {}
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return {}
  }
}

/**
 * Ollama expects `tool_calls[].function.arguments` as a JSON **object** in the
 * request body. After streaming, arguments are often a string; replaying that
 * string breaks the server parser ("can't find closing '}' symbol").
 */
function argumentsStringToObject(
  raw: string | Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (raw == null) return {}
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>
  }
  const s = String(raw).trim()
  if (!s) return {}
  try {
    const v = JSON.parse(s) as unknown
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return v as Record<string, unknown>
    }
  } catch {
    /* incomplete or invalid JSON from stream */
  }
  return {}
}

/** Pick chat images for save_pdf — uses `attached_image_indices` when set; else `embed_attached_images` for all. */
function resolvePdfAttachedImages(
  args: Record<string, unknown>,
  ctx: { userImages?: string[]; userImageMimes?: string[] },
): { base64: string; mime: string }[] {
  const b64 = ctx.userImages ?? []
  const mimes = ctx.userImageMimes ?? []
  const rawIdx = args.attached_image_indices
  const embedAll = args.embed_attached_images === true

  const toIndex = (x: unknown): number | null => {
    if (typeof x === 'number' && Number.isFinite(x)) return Math.trunc(x)
    if (typeof x === 'string' && /^-?\d+$/.test(x.trim()))
      return parseInt(x.trim(), 10)
    return null
  }

  let idxs: number[] = []
  if (Array.isArray(rawIdx) && rawIdx.length > 0) {
    for (const x of rawIdx) {
      const n = toIndex(x)
      if (n !== null && n >= 0 && n < b64.length) idxs.push(n)
    }
    idxs = [...new Set(idxs)].sort((a, b) => a - b)
  } else if (embedAll) {
    idxs = b64.map((_, i) => i)
  }

  return idxs.map((i) => ({
    base64: b64[i]!,
    mime:
      typeof mimes[i] === 'string' && (mimes[i] as string).trim()
        ? (mimes[i] as string).trim()
        : 'image/png',
  }))
}

/**
 * Parse `image_urls` from save_pdf args. Accepts a single string, array of
 * strings, or comma-separated list. Only public http(s) URLs are forwarded —
 * the Python server enforces SSRF + size limits before fetching.
 */
function resolvePdfImageUrls(args: Record<string, unknown>): string[] {
  const raw = args.image_urls ?? args.imageUrls
  const out: string[] = []
  const push = (v: unknown) => {
    if (typeof v !== 'string') return
    const s = v.trim()
    if (/^https?:\/\//i.test(s)) out.push(s)
  }
  if (Array.isArray(raw)) {
    for (const item of raw) push(item)
  } else if (typeof raw === 'string') {
    for (const part of raw.split(/[\s,]+/)) push(part)
  }
  return [...new Set(out)]
}

function normalizeToolCallsForReplay(calls: OllamaToolCall[]): OllamaToolCall[] {
  return calls
    .filter((t) => t.function?.name)
    .map((tc) => ({
      id: tc.id,
      type: 'function' as const,
      index: tc.index,
      function: {
        name: tc.function!.name,
        arguments: argumentsStringToObject(tc.function!.arguments),
      },
    }))
}

function getLastUserText(messages: OllamaApiMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role === 'user') return (m.content || '').trim()
  }
  return ''
}

function pickFirstHttpUrl(text: string): string | null {
  const m = text.match(HTTP_URL_RE)
  return m?.[1]?.trim() || null
}

function shouldForceWebSearch(userText: string): boolean {
  if (!userText.trim()) return false
  return FRESHNESS_RE.test(userText)
}

function shouldRequireToolCall(userText: string, enabled: ToolsEnabled): boolean {
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
  const asksReminders = /\b(remind|reminder|schedule|podseti|podsetnik|napomena)\b/i.test(t)
  return (
    (enabled.runwareImage && asksImage) ||
    (enabled.runwareMusic && asksMusic) ||
    (enabled.pdf && asksPdf) ||
    (enabled.webSearch && asksWeb) ||
    (enabled.weather && asksWeather) ||
    (enabled.youtube && asksYoutube) ||
    (enabled.scrape && asksScrape) ||
    (enabled.coding && asksCoding) ||
    asksSettings ||
    asksReminders
  )
}

function deriveSearchQuery(userText: string): string {
  const noUrls = userText.replace(/https?:\/\/\S+/gi, ' ')
  const single = noUrls.replace(/\s+/g, ' ').trim()
  if (!single) return userText.slice(0, 220).trim()
  return single.length > 220 ? single.slice(0, 220).trim() : single
}

const AGENT_EDITABLE_SETTINGS_FIELD_SET = new Set<string>(AGENT_EDITABLE_SETTINGS_FIELDS)
const CONFIGURED_RUNWARE_MODEL_IDS = new Set<string>(RUNWARE_CONFIGURED_MODELS.map((x) => x.id))
const UI_THEME_SET = new Set<UiTheme>(['dystopian', 'minimal', 'matrix', 'light'])
const LONG_MEMORY_KIND_SET = new Set<LongMemoryKind>([
  'preference',
  'project',
  'fact',
  'constraint',
  'task',
])

function parseToolValueAsString(raw: unknown): string {
  if (typeof raw === 'string') return raw
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw)
  return ''
}

function parseToolValueAsNumber(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw === 'string') {
    const n = Number(raw.trim())
    if (Number.isFinite(n)) return n
  }
  return null
}

function parseResolutionPair(raw: unknown): { width: number; height: number } | null {
  const s = parseToolValueAsString(raw).trim().toLowerCase()
  if (!s) return null
  const m = s.match(/^(\d{2,5})\s*[x,]\s*(\d{2,5})$/)
  if (!m) return null
  const width = Number(m[1])
  const height = Number(m[2])
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null
  return { width: Math.round(width), height: Math.round(height) }
}

function parseLongMemoryCandidate(raw: unknown): {
  text: string
  kind: LongMemoryKind
  importance?: number
  confidence?: number
  tags?: string[]
} | null {
  const textValue = parseToolValueAsString(raw).trim()
  if (!textValue) return null
  if (textValue.startsWith('{') && textValue.endsWith('}')) {
    try {
      const obj = JSON.parse(textValue) as Record<string, unknown>
      const text = parseToolValueAsString(obj.text).trim()
      if (!text) return null
      const kindRaw = parseToolValueAsString(obj.kind).trim().toLowerCase() as LongMemoryKind
      const kind: LongMemoryKind = LONG_MEMORY_KIND_SET.has(kindRaw) ? kindRaw : 'fact'
      const importance = parseToolValueAsNumber(obj.importance) ?? undefined
      const confidence = parseToolValueAsNumber(obj.confidence) ?? undefined
      const tagsRaw = Array.isArray(obj.tags) ? obj.tags : []
      const tags = tagsRaw
        .map((x) => parseToolValueAsString(x).trim())
        .filter(Boolean)
      return { text, kind, importance, confidence, tags: tags.length ? tags : undefined }
    } catch {
      return null
    }
  }
  return { text: textValue, kind: 'fact' }
}

function userRequestedStepsOverride(text: string): boolean {
  const t = (text || '').toLowerCase()
  if (!t.trim()) return false
  return /\b(step|steps|korak|koraka)\b/.test(t)
}

function userRequestedCfgOverride(text: string): boolean {
  const t = (text || '').toLowerCase()
  if (!t.trim()) return false
  return /\b(cfg|cfg[_\s-]?scale|guidance|guidance[_\s-]?scale)\b/.test(t)
}

function parseImageIndexes(raw: unknown): number[] {
  if (Array.isArray(raw)) {
    return raw
      .map((x) => (typeof x === 'number' ? x : Number(String(x).trim())))
      .filter((n) => Number.isFinite(n))
      .map((n) => Math.round(n))
      .filter((n) => n > 0)
  }
  if (typeof raw !== 'string') return []
  return raw
    .split(/[,\s]+/)
    .map((x) => Number(x.trim()))
    .filter((n) => Number.isFinite(n))
    .map((n) => Math.round(n))
    .filter((n) => n > 0)
}

function parseImagePaths(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return Array.from(
      new Set(
        raw
          .map((x) => String(x ?? '').trim())
          .filter(Boolean),
      ),
    )
  }
  if (typeof raw !== 'string') return []
  return Array.from(
    new Set(
      raw
        .split(/[\n,]+/)
        .map((x) => x.trim())
        .filter(Boolean),
    ),
  )
}

function normalizePathForMatch(p: string): string {
  return p.trim().replace(/\\/g, '/').toLowerCase()
}

function indexesFromReferencePaths(
  catalogPaths: string[] | undefined,
  requestedPaths: string[],
): { indexes: number[]; missingPaths: string[] } {
  if (!catalogPaths?.length || !requestedPaths.length) {
    return { indexes: [], missingPaths: requestedPaths }
  }
  const indexByPath = new Map<string, number>()
  for (let i = 0; i < catalogPaths.length; i++) {
    const raw = (catalogPaths[i] || '').trim()
    if (!raw) continue
    const key = normalizePathForMatch(raw)
    if (!key || indexByPath.has(key)) continue
    indexByPath.set(key, i + 1)
  }
  const indexes: number[] = []
  const missingPaths: string[] = []
  for (const p of requestedPaths) {
    const hit = indexByPath.get(normalizePathForMatch(p))
    if (!hit) {
      missingPaths.push(p)
      continue
    }
    indexes.push(hit)
  }
  return { indexes, missingPaths }
}

function resolveReferenceImageIndexes(
  args: Record<string, unknown>,
  catalogPaths: string[] | undefined,
): { indexes: number[]; missingPaths: string[] } {
  const fromIndexes = parseImageIndexes(args.reference_image_indexes)
  const requestedPaths = parseImagePaths(args.reference_image_paths)
  const fromPaths = indexesFromReferencePaths(catalogPaths, requestedPaths)
  return {
    indexes: Array.from(new Set([...fromIndexes, ...fromPaths.indexes])),
    missingPaths: fromPaths.missingPaths,
  }
}

function pickImageByOneBasedIndex(
  images: string[] | undefined,
  imageMimes: string[] | undefined,
  idx: number | null,
): string | undefined {
  if (!images || images.length === 0 || idx == null || !Number.isFinite(idx)) return undefined
  const i = Math.round(idx) - 1
  if (i < 0 || i >= images.length) return undefined
  const raw = (images[i] || '').trim()
  if (!raw) return undefined
  if (raw.startsWith('data:image/')) return raw
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw
  const mimeRaw = (imageMimes?.[i] || 'image/png').trim().toLowerCase()
  const mime = /^image\/[a-z0-9.+-]+$/.test(mimeRaw) ? mimeRaw : 'image/png'
  return `data:${mime};base64,${raw.replace(/\s+/g, '')}`
}

type ResolvedRecallImage = {
  index: number
  mime: string
  base64: string
  path?: string
}

function parseDataImageUri(value: string): { mime: string; base64: string } | null {
  const raw = value.trim()
  const m = raw.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i)
  if (!m) return null
  const mime = m[1].toLowerCase()
  const base64 = m[2].replace(/\s+/g, '')
  if (!base64) return null
  return { mime, base64 }
}

function resolveCatalogImageByOneBasedIndex(
  images: string[] | undefined,
  imageMimes: string[] | undefined,
  imagePaths: string[] | undefined,
  idx: number | null,
): ResolvedRecallImage | undefined {
  if (!images || images.length === 0 || idx == null || !Number.isFinite(idx)) return undefined
  const i = Math.round(idx) - 1
  if (i < 0 || i >= images.length) return undefined
  const raw = (images[i] || '').trim()
  if (!raw) return undefined
  const parsed = parseDataImageUri(raw)
  if (parsed) {
    return {
      index: Math.round(idx),
      mime: parsed.mime,
      base64: parsed.base64,
      path: (imagePaths?.[i] || '').trim() || undefined,
    }
  }
  if (raw.startsWith('http://') || raw.startsWith('https://')) return undefined
  const mimeRaw = (imageMimes?.[i] || 'image/png').trim().toLowerCase()
  const mime = /^image\/[a-z0-9.+-]+$/.test(mimeRaw) ? mimeRaw : 'image/png'
  return {
    index: Math.round(idx),
    mime,
    base64: raw.replace(/\s+/g, ''),
    path: (imagePaths?.[i] || '').trim() || undefined,
  }
}

type ImageRecallToolResult = {
  ok: boolean
  source: 'internal_catalog'
  purpose?: 'vision' | 'edit'
  recalled_images: Array<{ index: number; mime: string; path?: string }>
  errors?: string[]
}

function resolveImageRecallRequest(
  args: Record<string, unknown>,
  ctx: {
    userImages?: string[]
    userImageMimes?: string[]
    userImagePaths?: string[]
    codingProjectPath?: string
  },
): {
  purpose?: 'vision' | 'edit'
  recalled: ResolvedRecallImage[]
  errors: string[]
  maxAvailable: number
} {
  const selected = resolveReferenceImageIndexes(args, ctx.userImagePaths)
  const indexes = selected.indexes
  const purposeRaw = typeof args.purpose === 'string' ? args.purpose.trim().toLowerCase() : ''
  const purpose: 'vision' | 'edit' | undefined =
    purposeRaw === 'vision' ? 'vision' : purposeRaw === 'edit' ? 'edit' : undefined
  const recalled: ResolvedRecallImage[] = []
  const errors: string[] = selected.missingPaths.map((p) => `path not found in catalog: ${p}`)
  for (const idx of indexes) {
    const hit = resolveCatalogImageByOneBasedIndex(
      ctx.userImages,
      ctx.userImageMimes,
      ctx.userImagePaths,
      idx,
    )
    if (!hit) {
      errors.push(`index ${idx}: not found or not convertible to base64`)
      continue
    }
    recalled.push(hit)
  }
  return {
    purpose,
    recalled,
    errors,
    maxAvailable: ctx.userImages?.length ?? 0,
  }
}

export async function executeToolCall(
  name: string,
  argsJson: string | Record<string, unknown> | undefined,
  toolsEnabled: ToolsEnabled,
  ctx: {
    ttsBaseUrl: string
    signal?: AbortSignal
    /** Required for save_pdf when the tool is enabled */
    pdfOutputDir?: string
    runware?: RunwareImageConfig
    userImages?: string[]
    userImageMimes?: string[]
    userImagePaths?: string[]
    codingProjectPath?: string
    /** Latest user message text for override-policy checks. */
    userText?: string
  },
): Promise<string> {
  const args =
    typeof argsJson === 'string'
      ? parseToolArguments(argsJson)
      : (argsJson as Record<string, unknown>) ?? {}
  if (name === 'web_search') {
    if (!toolsEnabled.webSearch) {
      return 'Error: web_search tool is disabled in settings.'
    }
    const q = typeof args.query === 'string' ? args.query.trim() : ''
    if (!q) return 'Error: missing query parameter for web_search.'
    try {
      return await invokeWebSearch(q, ctx.ttsBaseUrl, ctx.signal)
    } catch (e) {
      return e instanceof Error ? e.message : String(e)
    }
  }
  if (name === 'search_youtube') {
    if (!toolsEnabled.youtube) {
      return 'Error: search_youtube tool is disabled in settings.'
    }
    const query = typeof args.query === 'string' ? args.query.trim() : ''
    const videoUrl =
      typeof args.video_url === 'string' ? args.video_url.trim() : ''
    if (!query && !videoUrl) {
      return 'Error: provide query (search) or video_url (video details / transcript).'
    }
    const getTranscript = Boolean(args.get_transcript)
    const maxRaw = args.max_results
    const maxResults =
      typeof maxRaw === 'number' && Number.isFinite(maxRaw)
        ? Math.min(20, Math.max(1, Math.round(maxRaw)))
        : undefined
    try {
      return await invokeYoutubeTool(
        {
          query: query || undefined,
          video_url: videoUrl || undefined,
          get_transcript: getTranscript,
          max_results: maxResults,
        },
        ctx.ttsBaseUrl,
        ctx.signal,
      )
    } catch (e) {
      return e instanceof Error ? e.message : String(e)
    }
  }
  if (name === 'reddit_feed') {
    if (!toolsEnabled.reddit) {
      return 'Error: reddit_feed tool is disabled in settings.'
    }
    const subreddit =
      typeof args.subreddit === 'string' ? args.subreddit.trim() : ''
    const sortRaw = typeof args.sort === 'string' ? args.sort.trim().toLowerCase() : ''
    const timeRaw = typeof args.time === 'string' ? args.time.trim().toLowerCase() : ''
    const allowedSorts: RedditToolParams['sort'][] = [
      'hot',
      'new',
      'top',
      'rising',
      'controversial',
      'best',
    ]
    const allowedTimes: RedditToolParams['time'][] = [
      'hour',
      'day',
      'week',
      'month',
      'year',
      'all',
    ]
    const sort = allowedSorts.find((s) => s === sortRaw)
    const time = allowedTimes.find((t) => t === timeRaw)
    const limitRaw = args.limit
    const limit =
      typeof limitRaw === 'number' && Number.isFinite(limitRaw)
        ? Math.min(25, Math.max(1, Math.round(limitRaw)))
        : undefined
    const query = typeof args.query === 'string' ? args.query.trim() : ''
    const postUrl = typeof args.post_url === 'string' ? args.post_url.trim() : ''
    const maxCommentsRaw = args.max_comments
    const maxComments =
      typeof maxCommentsRaw === 'number' && Number.isFinite(maxCommentsRaw)
        ? Math.min(50, Math.max(1, Math.round(maxCommentsRaw)))
        : undefined
    try {
      return await invokeRedditTool(
        {
          subreddit: subreddit || undefined,
          sort,
          time,
          limit,
          query: query || undefined,
          post_url: postUrl || undefined,
          max_comments: maxComments,
        },
        ctx.ttsBaseUrl,
        ctx.signal,
      )
    } catch (e) {
      return e instanceof Error ? e.message : String(e)
    }
  }
  if (name === 'get_weather') {
    if (!toolsEnabled.weather) {
      return 'Error: get_weather tool is disabled in settings.'
    }
    const city = typeof args.city === 'string' ? args.city.trim() : ''
    if (!city) return 'Error: missing city parameter for get_weather.'
    const forecast = Boolean(args.forecast)
    try {
      return await invokeGetWeather(city, forecast, ctx.ttsBaseUrl, ctx.signal)
    } catch (e) {
      return e instanceof Error ? e.message : String(e)
    }
  }
  if (name === 'scrape_url') {
    if (!toolsEnabled.scrape) {
      return 'Error: scrape_url tool is disabled in settings.'
    }
    const url = typeof args.url === 'string' ? args.url.trim() : ''
    if (!url) return 'Error: missing url parameter for scrape_url.'
    const maxChars =
      typeof args.max_chars === 'number' && Number.isFinite(args.max_chars)
        ? args.max_chars
        : undefined
    try {
      return await invokeScrapeUrl(url, maxChars, ctx.ttsBaseUrl, ctx.signal)
    } catch (e) {
      return e instanceof Error ? e.message : String(e)
    }
  }
  if (name === 'save_pdf') {
    if (!toolsEnabled.pdf) {
      return 'Error: save_pdf tool is disabled in settings.'
    }
    const dir = ctx.pdfOutputDir?.trim() ?? ''
    if (!dir) {
      return 'Error: set a PDF output folder in Options → Tools (under Save as PDF).'
    }
    const content = typeof args.content === 'string' ? args.content : ''
    if (!content.trim()) return 'Error: missing or empty content for save_pdf.'
    const title = typeof args.title === 'string' ? args.title : undefined
    const filename = typeof args.filename === 'string' ? args.filename : undefined
    const images = resolvePdfAttachedImages(args as Record<string, unknown>, {
      userImages: ctx.userImages,
      userImageMimes: ctx.userImageMimes,
    })
    const imageUrls = resolvePdfImageUrls(args as Record<string, unknown>)
    try {
      return await invokeSavePdf({
        ttsBaseUrl: ctx.ttsBaseUrl,
        content,
        title,
        filename,
        outputDir: dir,
        images: images.length ? images : undefined,
        imageUrls: imageUrls.length ? imageUrls : undefined,
        signal: ctx.signal,
      })
    } catch (e) {
      return e instanceof Error ? e.message : String(e)
    }
  }
  if (name === 'generate_image') {
    if (!toolsEnabled.runwareImage) {
      return 'Error: generate_image tool is disabled in settings.'
    }
    if (!ctx.runware) {
      return 'Error: Runware settings are missing.'
    }
    const prompt =
      typeof args.prompt === 'string'
        ? args.prompt.trim()
        : typeof args.positivePrompt === 'string'
          ? args.positivePrompt.trim()
          : ''
    if (!prompt) return 'Error: missing prompt parameter for generate_image.'
    const canOverrideSteps = userRequestedStepsOverride(ctx.userText || '')
    const canOverrideCfg = userRequestedCfgOverride(ctx.userText || '')
    try {
      return await invokeRunwareGenerateImage(
        {
          prompt,
          negativePrompt:
            typeof args.negative_prompt === 'string'
              ? args.negative_prompt
              : typeof args.negativePrompt === 'string'
                ? args.negativePrompt
                : undefined,
          width: typeof args.width === 'number' ? args.width : undefined,
          height: typeof args.height === 'number' ? args.height : undefined,
          steps:
            canOverrideSteps && typeof args.steps === 'number'
              ? args.steps
              : undefined,
          cfgScale:
            canOverrideCfg && typeof args.cfg_scale === 'number'
              ? args.cfg_scale
              : canOverrideCfg && typeof args.cfgScale === 'number'
                ? args.cfgScale
                : undefined,
          model: typeof args.model === 'string' ? args.model : undefined,
        },
        ctx.runware,
        ctx.signal,
      )
    } catch (e) {
      return e instanceof Error ? e.message : String(e)
    }
  }
  if (name === 'edit_image_runware') {
    if (!toolsEnabled.runwareImage) {
      return 'Error: edit_image_runware tool is disabled in settings.'
    }
    if (!ctx.runware) {
      return 'Error: Runware settings are missing.'
    }
    const prompt =
      typeof args.prompt === 'string'
        ? args.prompt.trim()
        : typeof args.positivePrompt === 'string'
          ? args.positivePrompt.trim()
          : ''
    if (!prompt) return 'Error: missing prompt parameter for edit_image_runware.'
    const canOverrideSteps = userRequestedStepsOverride(ctx.userText || '')
    const canOverrideCfg = userRequestedCfgOverride(ctx.userText || '')
    const selected = resolveReferenceImageIndexes(args, ctx.userImagePaths)
    const indexes = selected.indexes
    if (!indexes.length) {
      return 'Error: missing image references for edit_image_runware. Provide reference_image_indexes (e.g. "1" or "1,2") and/or reference_image_paths.'
    }
    const refs = indexes
      .map((i) => pickImageByOneBasedIndex(ctx.userImages, ctx.userImageMimes, i))
      .filter((x): x is string => typeof x === 'string' && x.length > 0)
    if (!refs.length) {
      const max = ctx.userImages?.length ?? 0
      const missing = selected.missingPaths.length
        ? ` Missing paths: ${selected.missingPaths.join(' | ')}.`
        : ''
      return `Error: no valid reference images resolved from provided indexes/paths. Available image count: ${max}.${missing}`
    }
    try {
      return await invokeRunwareEditImage(
        {
          prompt,
          referenceImages: refs,
          negativePrompt:
            typeof args.negative_prompt === 'string'
              ? args.negative_prompt
              : typeof args.negativePrompt === 'string'
                ? args.negativePrompt
                : undefined,
          width: typeof args.width === 'number' ? args.width : undefined,
          height: typeof args.height === 'number' ? args.height : undefined,
          steps:
            canOverrideSteps && typeof args.steps === 'number'
              ? args.steps
              : undefined,
          cfgScale:
            canOverrideCfg && typeof args.cfg_scale === 'number'
              ? args.cfg_scale
              : canOverrideCfg && typeof args.cfgScale === 'number'
                ? args.cfgScale
                : undefined,
          model: typeof args.model === 'string' ? args.model : undefined,
        },
        ctx.runware,
        ctx.signal,
      )
    } catch (e) {
      return e instanceof Error ? e.message : String(e)
    }
  }
  if (name === 'image_recall') {
    if (!toolsEnabled.runwareImage) {
      return 'Error: image_recall tool is disabled in settings.'
    }
    const selected = resolveReferenceImageIndexes(args, ctx.userImagePaths)
    const indexes = selected.indexes
    if (!indexes.length) {
      return 'Error: missing image references for image_recall. Provide reference_image_indexes and/or reference_image_paths.'
    }
    const recall = resolveImageRecallRequest(args, ctx)
    if (!recall.recalled.length) {
      const max = recall.maxAvailable
      return `Error: image_recall could not resolve any requested images. Available image count: ${max}.`
    }
    const payload: ImageRecallToolResult = {
      ok: true,
      source: 'internal_catalog',
      purpose: recall.purpose,
      recalled_images: recall.recalled.map((x) => ({
        index: x.index,
        mime: x.mime,
        path: x.path,
      })),
      ...(recall.errors.length > 0 ? { errors: recall.errors } : {}),
    }
    return JSON.stringify(payload)
  }
  if (name === 'generate_music_runware') {
    if (!toolsEnabled.runwareMusic) {
      return 'Error: generate_music_runware tool is disabled in settings.'
    }
    if (!ctx.runware) {
      return 'Error: Runware settings are missing.'
    }
    const prompt =
      typeof args.prompt === 'string'
        ? args.prompt.trim()
        : typeof args.positivePrompt === 'string'
          ? args.positivePrompt.trim()
          : ''
    if (!prompt) return 'Error: missing prompt parameter for generate_music_runware.'
    try {
      // Audio engine tuning (steps, cfg_scale, output_format, seed, guidance_type) is intentionally
      // sourced from settings only; any values the model attempts to send in tool args are ignored.
      return await invokeRunwareGenerateMusic(
        {
          prompt,
          negativePrompt:
            typeof args.negative_prompt === 'string'
              ? args.negative_prompt
              : typeof args.negativePrompt === 'string'
                ? args.negativePrompt
                : undefined,
          lyrics: typeof args.lyrics === 'string' ? args.lyrics : undefined,
          durationSec:
            typeof args.duration_sec === 'number'
              ? args.duration_sec
              : typeof args.durationSec === 'number'
                ? args.durationSec
                : undefined,
          bpm: typeof args.bpm === 'number' ? args.bpm : undefined,
          keyScale:
            typeof args.key_scale === 'string'
              ? args.key_scale
              : typeof args.keyScale === 'string'
                ? args.keyScale
                : undefined,
          vocalLanguage:
            typeof args.vocal_language === 'string'
              ? args.vocal_language
              : typeof args.vocalLanguage === 'string'
                ? args.vocalLanguage
                : undefined,
        },
        ctx.runware,
        ctx.signal,
      )
    } catch (e) {
      return e instanceof Error ? e.message : String(e)
    }
  }
  if (name === 'update_settings') {
    const fieldRaw = parseToolValueAsString(args.field).trim()
    const valueRaw = args.value
    if (!fieldRaw) return 'Error: missing field parameter for update_settings.'
    if (!AGENT_EDITABLE_SETTINGS_FIELD_SET.has(fieldRaw)) {
      return `Error: field "${fieldRaw}" is not editable by update_settings.`
    }
    const field = fieldRaw as AgentEditableSettingsField
    const current = loadSettings()
    const candidate: AppSettings = { ...current }
    const updateActiveRunwareProfile = (patch: { width?: number; height?: number }) => {
      const activeModelId = candidate.runwareImageModel
      const currentProfile = candidate.runwareModelProfiles[activeModelId] ?? {
        width: candidate.runwareWidth,
        height: candidate.runwareHeight,
        steps: candidate.runwareSteps,
        cfgScale: candidate.runwareCfgScale,
      }
      candidate.runwareModelProfiles = {
        ...candidate.runwareModelProfiles,
        [activeModelId]: {
          ...currentProfile,
          ...(typeof patch.width === 'number' ? { width: Math.round(patch.width) } : {}),
          ...(typeof patch.height === 'number' ? { height: Math.round(patch.height) } : {}),
        },
      }
      if (typeof patch.width === 'number') candidate.runwareWidth = Math.round(patch.width)
      if (typeof patch.height === 'number') candidate.runwareHeight = Math.round(patch.height)
    }
    if (field === 'llmSystemPrompt') {
      const next = parseToolValueAsString(valueRaw)
      candidate.llmSystemPrompt = next
    } else if (field === 'llmNumCtx') {
      const n = parseToolValueAsNumber(valueRaw)
      if (n === null) return 'Error: llmNumCtx expects a numeric value.'
      candidate.llmNumCtx = Math.round(n)
    } else if (field === 'llmTemperature') {
      const n = parseToolValueAsNumber(valueRaw)
      if (n === null) return 'Error: llmTemperature expects a numeric value.'
      candidate.llmTemperature = n
    } else if (field === 'uiTheme') {
      const next = parseToolValueAsString(valueRaw).trim().toLowerCase() as UiTheme
      if (!UI_THEME_SET.has(next)) {
        return 'Error: uiTheme must be one of: dystopian, minimal, matrix, light.'
      }
      candidate.uiTheme = next
    } else if (field === 'longMemoryAdd') {
      const parsed = parseLongMemoryCandidate(valueRaw)
      if (!parsed) {
        return 'Error: longMemoryAdd expects plain text or JSON with at least {"text":"..."}'
      }
      try {
        const saved = await upsertMemories(
          [
            {
              kind: parsed.kind,
              text: parsed.text,
              importance: parsed.importance,
              confidence: parsed.confidence,
              tags: parsed.tags,
            },
          ],
          'agent-tool',
        )
        if (saved.length === 0) {
          return 'Error: long memory entry was empty and was not saved.'
        }
        return `OK: added long memory (${saved[0].kind}): ${saved[0].text}`
      } catch (e) {
        return e instanceof Error ? `Error: failed to add long memory: ${e.message}` : String(e)
      }
    } else if (field === 'autoVoice') {
      const next = parseToolValueAsString(valueRaw).trim().toLowerCase()
      if (next === 'true' || next === '1' || next === 'yes' || next === 'on') {
        candidate.autoVoice = true
      } else if (next === 'false' || next === '0' || next === 'no' || next === 'off') {
        candidate.autoVoice = false
      } else {
        return 'Error: autoVoice expects a boolean value (true/false, on/off, yes/no, 1/0).'
      }
    } else if (field === 'runwareResolution') {
      const pair = parseResolutionPair(valueRaw)
      if (!pair) {
        return 'Error: runwareResolution expects "WIDTHxHEIGHT" (for example 1920x1080).'
      }
      updateActiveRunwareProfile(pair)
    } else if (field === 'runwareWidth') {
      const n = parseToolValueAsNumber(valueRaw)
      if (n === null) return 'Error: runwareWidth expects a numeric value.'
      updateActiveRunwareProfile({ width: n })
    } else if (field === 'runwareHeight') {
      const n = parseToolValueAsNumber(valueRaw)
      if (n === null) return 'Error: runwareHeight expects a numeric value.'
      updateActiveRunwareProfile({ height: n })
    } else if (field === 'runwareImageModel') {
      const next = parseToolValueAsString(valueRaw).trim()
      if (!next) return 'Error: runwareImageModel cannot be empty.'
      if (!CONFIGURED_RUNWARE_MODEL_IDS.has(next)) {
        return `Error: unsupported runwareImageModel "${next}".`
      }
      candidate.runwareImageModel = next
    } else if (field === 'runwareEditModel') {
      const next = parseToolValueAsString(valueRaw).trim()
      if (!next) return 'Error: runwareEditModel cannot be empty.'
      if (!CONFIGURED_RUNWARE_MODEL_IDS.has(next)) {
        return `Error: unsupported runwareEditModel "${next}".`
      }
      candidate.runwareEditModel = next
    } else {
      return `Error: unsupported field "${fieldRaw}".`
    }
    const normalized = normalizeSettingsCandidate(candidate)
    saveSettings(normalized)
    if (field === 'runwareResolution') {
      return `OK: updated runwareResolution to ${normalized.runwareWidth}x${normalized.runwareHeight}.`
    }
    const applied = normalized[field]
    return `OK: updated ${field} to ${String(applied)}.`
  }
  if (name === 'add_reminder') {
    const text = parseToolValueAsString(args.text).trim()
    if (!text) return 'Error: missing text parameter for add_reminder.'
    const whenRaw = parseToolValueAsString(args.when).trim()
    let when: number | null = null
    if (whenRaw) {
      const parsed = new Date(whenRaw).getTime()
      if (Number.isNaN(parsed)) {
        return 'Error: when must be a valid ISO datetime (e.g. 2026-05-10T09:00).'
      }
      when = parsed
    }
    const tagsRaw = Array.isArray(args.tags) ? args.tags : []
    const tags = tagsRaw
      .map((x) => parseToolValueAsString(x).trim())
      .filter(Boolean)
    try {
      const item = await addReminder({ text, when: when ?? undefined, tags, source: 'agent-tool' })
      if (item.when != null) {
        const dateStr = new Date(item.when).toLocaleString('en-US', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
        return `OK: reminder set for ${dateStr} — "${item.text}".`
      }
      return `OK: reminder added — "${item.text}".`
    } catch (e) {
      return e instanceof Error ? `Error: failed to add reminder: ${e.message}` : String(e)
    }
  }
  if (name === 'list_reminders') {
    const fromRaw = parseToolValueAsString(args.from).trim()
    const toRaw = parseToolValueAsString(args.to).trim()
    const includeGeneral = args.include_general !== false
    let fromMs: number | undefined
    let toMs: number | undefined
    if (fromRaw) {
      const d = new Date(fromRaw)
      if (Number.isNaN(d.getTime())) {
        return 'Error: from must be a valid date (e.g. 2026-05-10 or today).'
      }
      fromMs = d.setHours(0, 0, 0, 0)
    }
    if (toRaw) {
      const d = new Date(toRaw)
      if (Number.isNaN(d.getTime())) {
        return 'Error: to must be a valid date (e.g. 2026-05-10 or tomorrow).'
      }
      toMs = d.setHours(23, 59, 59, 999)
    } else if (fromMs != null) {
      toMs = new Date(fromMs).setHours(23, 59, 59, 999)
    }
    try {
      const items = await listReminders({ from: fromMs, to: toMs, includeGeneral })
      if (items.length === 0) {
        return 'No reminders found for that period.'
      }
      const lines = items.map((r) => {
        const time = r.when != null
          ? new Date(r.when).toLocaleString('en-US', {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })
          : 'General'
        const tags = r.tags.length ? ` [${r.tags.join(', ')}]` : ''
        return `• ${time} — "${r.text}"${tags}`
      })
      return `Reminders:\n${lines.join('\n')}`
    } catch (e) {
      return e instanceof Error ? `Error: failed to list reminders: ${e.message}` : String(e)
    }
  }
  if (name === 'delete_reminder') {
    const searchText = parseToolValueAsString(args.search_text).trim()
    if (!searchText) return 'Error: missing search_text parameter for delete_reminder.'
    try {
      const matches = await searchRemindersByText(searchText)
      if (matches.length === 0) {
        return `Error: no reminder found matching "${searchText}".`
      }
      const target = matches[0]
      await deleteReminder(target.id)
      return `OK: deleted reminder — "${target.text}".`
    } catch (e) {
      return e instanceof Error ? `Error: failed to delete reminder: ${e.message}` : String(e)
    }
  }
  if (name === 'update_reminder') {
    const searchText = parseToolValueAsString(args.search_text).trim()
    if (!searchText) return 'Error: missing search_text parameter for update_reminder.'
    const newTextRaw = parseToolValueAsString(args.text).trim()
    const whenRaw = parseToolValueAsString(args.when).trim()
    const tagsRaw = Array.isArray(args.tags) ? args.tags : []
    try {
      const matches = await searchRemindersByText(searchText)
      if (matches.length === 0) {
        return `Error: no reminder found matching "${searchText}".`
      }
      const target = matches[0]
      const patch: Parameters<typeof updateReminder>[1] = {}
      if (newTextRaw) patch.text = newTextRaw
      if (whenRaw === '') {
        patch.when = null
      } else if (whenRaw) {
        const parsed = new Date(whenRaw).getTime()
        if (Number.isNaN(parsed)) {
          return 'Error: when must be a valid ISO datetime (e.g. 2026-05-10T09:00) or empty string to remove time.'
        }
        patch.when = parsed
      }
      if (tagsRaw.length > 0) {
        patch.tags = tagsRaw.map((x) => parseToolValueAsString(x).trim()).filter(Boolean)
      }
      const updated = await updateReminder(target.id, patch)
      if (!updated) return 'Error: reminder was not found during update.'
      const timeStr = updated.when != null
        ? new Date(updated.when).toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })
        : 'General'
      return `OK: updated reminder — "${updated.text}" (${timeStr}).`
    } catch (e) {
      return e instanceof Error ? `Error: failed to update reminder: ${e.message}` : String(e)
    }
  }
  if (name === 'list_directory') {
    if (!toolsEnabled.coding) return 'Error: list_directory tool is disabled in settings.'
    const projectPath = (ctx.codingProjectPath || '').trim()
    if (!projectPath) return 'Error: coding project folder is not set in settings.'
    const relativePath = typeof args.path === 'string' ? args.path.trim() : ''
    try {
      const listed = await invokeListCodingDirectory(projectPath, relativePath)
      if (!listed.ok) return `Error: ${listed.error}`
      if (listed.entries.length === 0) return 'Directory is empty.'
      return listed.entries
        .map((e) => `${e.type === 'directory' ? '[dir]' : '[file]'} ${e.path}`)
        .join('\n')
    } catch (e) {
      return e instanceof Error ? e.message : String(e)
    }
  }
  if (name === 'read_file') {
    if (!toolsEnabled.coding) return 'Error: read_file tool is disabled in settings.'
    const projectPath = (ctx.codingProjectPath || '').trim()
    if (!projectPath) return 'Error: coding project folder is not set in settings.'
    const relativePath = typeof args.path === 'string' ? args.path.trim() : ''
    if (!relativePath) return 'Error: missing path parameter for read_file.'
    const startLine =
      typeof args.start_line === 'number' && Number.isFinite(args.start_line)
        ? Math.floor(args.start_line)
        : undefined
    const endLine =
      typeof args.end_line === 'number' && Number.isFinite(args.end_line)
        ? Math.floor(args.end_line)
        : undefined
    const maxChars =
      typeof args.max_chars === 'number' && Number.isFinite(args.max_chars)
        ? Math.floor(args.max_chars)
        : undefined
    return (
      await invokeReadCodingFile(projectPath, relativePath, {
        startLine,
        endLine,
        maxChars,
      })
    ).text
  }
  if (name === 'write_file') {
    if (!toolsEnabled.coding) return 'Error: write_file tool is disabled in settings.'
    const projectPath = (ctx.codingProjectPath || '').trim()
    if (!projectPath) return 'Error: coding project folder is not set in settings.'
    const relativePath = typeof args.path === 'string' ? args.path.trim() : ''
    const content = typeof args.content === 'string' ? args.content : ''
    if (!relativePath) return 'Error: missing path parameter for write_file.'
    return (await invokeWriteCodingFile(projectPath, relativePath, content)).text
  }
  if (name === 'edit_code') {
    if (!toolsEnabled.coding) return 'Error: edit_code tool is disabled in settings.'
    const projectPath = (ctx.codingProjectPath || '').trim()
    if (!projectPath) return 'Error: coding project folder is not set in settings.'
    const relativePath = typeof args.path === 'string' ? args.path.trim() : ''
    const findText = typeof args.find_text === 'string' ? args.find_text : ''
    const replaceText = typeof args.replace_text === 'string' ? args.replace_text : ''
    const replaceAll = args.replace_all === true
    if (!relativePath) return 'Error: missing path parameter for edit_code.'
    return (await invokeEditCodingFile(projectPath, relativePath, findText, replaceText, replaceAll)).text
  }
  if (name === 'search_files') {
    if (!toolsEnabled.coding) return 'Error: search_files tool is disabled in settings.'
    const projectPath = (ctx.codingProjectPath || '').trim()
    if (!projectPath) return 'Error: coding project folder is not set in settings.'
    const query = typeof args.query === 'string' ? args.query.trim() : ''
    if (!query) return 'Error: missing query parameter for search_files.'
    const pathPrefix = typeof args.path_prefix === 'string' ? args.path_prefix.trim() : ''
    return (
      await invokeSearchCodingFiles(projectPath, query, pathPrefix ? { pathPrefix } : undefined)
    ).text
  }
  if (name === 'glob_files') {
    if (!toolsEnabled.coding) return 'Error: glob_files tool is disabled in settings.'
    const projectPath = (ctx.codingProjectPath || '').trim()
    if (!projectPath) return 'Error: coding project folder is not set in settings.'
    const pathPrefix = typeof args.path_prefix === 'string' ? args.path_prefix.trim() : ''
    const extensions = Array.isArray(args.extensions)
      ? args.extensions.filter((x): x is string => typeof x === 'string')
      : undefined
    const maxResults =
      typeof args.max_results === 'number' && Number.isFinite(args.max_results)
        ? args.max_results
        : undefined
    return (
      await invokeGlobCodingFiles(projectPath, {
        pathPrefix: pathPrefix || undefined,
        extensions,
        maxResults,
      })
    ).text
  }
  if (name === 'git_status') {
    if (!toolsEnabled.coding) return 'Error: git_status tool is disabled in settings.'
    const projectPath = (ctx.codingProjectPath || '').trim()
    if (!projectPath) return 'Error: coding project folder is not set in settings.'
    return (await invokeCodingGit(projectPath, { mode: 'status' })).text
  }
  if (name === 'git_diff') {
    if (!toolsEnabled.coding) return 'Error: git_diff tool is disabled in settings.'
    const projectPath = (ctx.codingProjectPath || '').trim()
    if (!projectPath) return 'Error: coding project folder is not set in settings.'
    const relPath = typeof args.path === 'string' ? args.path.trim() : ''
    const staged = args.staged === true
    return (
      await invokeCodingGit(projectPath, {
        mode: 'diff',
        path: relPath || undefined,
        staged,
      })
    ).text
  }
  if (name === 'git_log') {
    if (!toolsEnabled.coding) return 'Error: git_log tool is disabled in settings.'
    const projectPath = (ctx.codingProjectPath || '').trim()
    if (!projectPath) return 'Error: coding project folder is not set in settings.'
    const maxCommits =
      typeof args.max_commits === 'number' && Number.isFinite(args.max_commits)
        ? Math.floor(args.max_commits)
        : undefined
    const logPath = typeof args.path === 'string' ? args.path.trim() : ''
    return (
      await invokeCodingGit(projectPath, {
        mode: 'log',
        logMaxCount: maxCommits,
        logPath: logPath || undefined,
      })
    ).text
  }
  if (name === 'git_show') {
    if (!toolsEnabled.coding) return 'Error: git_show tool is disabled in settings.'
    const projectPath = (ctx.codingProjectPath || '').trim()
    if (!projectPath) return 'Error: coding project folder is not set in settings.'
    const ref = typeof args.ref === 'string' && args.ref.trim() ? args.ref.trim() : undefined
    const showPath = typeof args.path === 'string' ? args.path.trim() : ''
    return (
      await invokeCodingGit(projectPath, {
        mode: 'show',
        showRef: ref,
        showPath: showPath || undefined,
      })
    ).text
  }
  if (name === 'execute_command') {
    if (!toolsEnabled.coding) return 'Error: execute_command tool is disabled in settings.'
    const projectPath = (ctx.codingProjectPath || '').trim()
    if (!projectPath) return 'Error: coding project folder is not set in settings.'
    const command = typeof args.command === 'string' ? args.command.trim() : ''
    const timeoutSec =
      typeof args.timeout_sec === 'number' && Number.isFinite(args.timeout_sec)
        ? args.timeout_sec
        : undefined
    const runInBackground = args.run_in_background === true
    if (!command) return 'Error: missing command parameter for execute_command.'
    return (
      await invokeExecuteCodingCommand(projectPath, command, {
        timeoutSec,
        runInBackground,
      })
    ).text
  }
  return `Error: unknown tool "${name}".`
}

/**
 * One streaming /api/chat round; accumulates assistant content and tool_calls.
 */
export async function streamOllamaChatOnce(options: {
  baseUrl: string
  model: string
  messages: OllamaApiMessage[]
  modelOptions?: OllamaModelOptions
  tools: unknown[] | undefined
  signal?: AbortSignal
  onDelta: (fullText: string) => void
  think?: boolean
  onThinkingDelta?: (fullThinking: string) => void
}): Promise<{
  content: string
  thinking: string
  tool_calls: OllamaToolCall[]
  usage?: OllamaChatUsage
}> {
  const root = normalizeBaseUrl(options.baseUrl)
  const opts = compactModelOptions(options.modelOptions)
  const body: Record<string, unknown> = {
    model: options.model,
    messages: options.messages,
    stream: true,
  }
  if (opts) body.options = opts
  if (options.tools !== undefined && options.tools.length > 0) {
    body.tools = options.tools
  }
  if (options.think) body.think = true

  const res = await fetchOllamaWithRetry(
    `${root}/api/chat`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: options.signal,
      body: JSON.stringify(body),
    },
    options.signal,
  )
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`Ollama /api/chat ${res.status}: ${errText || res.statusText}`)
  }
  if (!res.body) throw new Error('No response body')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let fullContent = ''
  let fullThinking = ''
  const toolCalls: OllamaToolCall[] = []
  let usage: OllamaChatUsage | undefined

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      let obj: unknown
      try {
        obj = JSON.parse(trimmed)
      } catch {
        continue
      }
      const chunk = obj as {
        message?: {
          content?: string
          thinking?: string
          tool_calls?: OllamaToolCall[]
        }
        error?: string
      }
      if (chunk.error) throw new Error(chunk.error)
      usage = mergeOllamaUsage(usage, parseChatStreamUsage(obj))
      const msg = chunk.message
      if (msg?.tool_calls?.length) {
        mergeToolCallDeltas(toolCalls, msg.tool_calls)
      }
      const thinkPiece = msg?.thinking
      if (thinkPiece) {
        fullThinking += thinkPiece
        options.onThinkingDelta?.(fullThinking)
      }
      const piece = msg?.content
      if (piece) {
        fullContent += piece
        options.onDelta(fullContent)
      }
    }
  }
  const tail = buffer.trim()
  if (tail) {
    try {
      const last = JSON.parse(tail) as {
        message?: {
          content?: string
          thinking?: string
          tool_calls?: OllamaToolCall[]
        }
        error?: string
      }
      if (last.error) throw new Error(last.error)
      usage = mergeOllamaUsage(usage, parseChatStreamUsage(last))
      if (last.message?.tool_calls?.length) {
        mergeToolCallDeltas(toolCalls, last.message.tool_calls)
      }
      const thinkPiece = last.message?.thinking
      if (thinkPiece) {
        fullThinking += thinkPiece
        options.onThinkingDelta?.(fullThinking)
      }
      const piece = last.message?.content
      if (piece) {
        fullContent += piece
        options.onDelta(fullContent)
      }
    } catch {
      /* ignore */
    }
  }

  return {
    content: fullContent,
    thinking: fullThinking,
    tool_calls: toolCalls.filter((t) => Boolean(t.function?.name)),
    usage,
  }
}

export type RunChatWithToolsParams = {
  baseUrl: string
  model: string
  initialMessages: OllamaApiMessage[]
  modelOptions?: OllamaModelOptions
  toolsEnabled: ToolsEnabled
  /** Same host as TTS; used for `POST /tools/search` (DDGS). */
  ttsBaseUrl: string
  signal?: AbortSignal
  onDelta: (fullText: string) => void
  /** Ollama: send `think: true` when enabled in settings. */
  think?: boolean
  /** Accumulated thinking across tool rounds + current stream. */
  onThinkingDelta?: (fullThinking: string) => void
  /** Called when a tool phase starts; pass null to clear (e.g. before next model stream). */
  onToolPhase?: (phase: AgentToolUiPhase | null) => void
  /** Folder for `save_pdf` (from app settings). */
  pdfOutputDir?: string
  /** After each tool runs; use to show real outcomes (e.g. PDF path) in the UI. */
  onToolResult?: (payload: { name: string; result: string; args?: Record<string, unknown> }) => void
  runware?: RunwareImageConfig
  /** Attached images from the latest user message (raw base64). */
  userImages?: string[]
  /** MIME list matching `userImages` indexes. */
  userImageMimes?: string[]
  /** Optional source paths matching `userImages` indexes. */
  userImagePaths?: string[]
  codingProjectPath?: string
}

/**
 * Agent loop: stream, run tools, append tool messages, repeat until text reply or cap.
 */
export async function runOllamaChatWithTools(
  params: RunChatWithToolsParams,
): Promise<{ content: string; usage?: OllamaChatUsage }> {
  const tools = buildOllamaToolsList(params.toolsEnabled)
  if (tools.length === 0) {
    throw new Error('runOllamaChatWithTools called with no tools enabled')
  }
  let forcedWebDone = false
  let forcedScrapeDone = false
  const originalUserText = getLastUserText(params.initialMessages)
  const originalUserUrl = pickFirstHttpUrl(originalUserText)
  const originalNeedsFresh = shouldForceWebSearch(originalUserText)
  const mustCallTool = shouldRequireToolCall(originalUserText, params.toolsEnabled)
  return runSharedToolLoop<OllamaApiMessage, OllamaToolCall>({
    initialMessages: [...params.initialMessages],
    maxToolRounds: MAX_TOOL_ROUNDS,
    maxRequiredToolReprompts: MAX_REQUIRED_TOOL_REPROMPTS,
    mustCallTool,
    signal: params.signal,
    streamRound: async ({ messages, signal, onDelta, onThinkingDelta }) => {
      const out = await streamOllamaChatOnce({
        baseUrl: params.baseUrl,
        model: params.model,
        messages,
        modelOptions: params.modelOptions,
        tools,
        signal,
        think: params.think,
        onDelta,
        onThinkingDelta,
      })
      return {
        content: out.content,
        thinking: out.thinking,
        toolCalls: out.tool_calls,
        usage: out.usage,
      }
    },
    toSharedToolCalls: (calls) =>
      calls
        .filter((t) => t.function?.name)
        .map((call) => ({ name: call.function!.name!, argsRaw: call.function!.arguments, raw: call })),
    appendAssistantWithToolCalls: ({ messages, content, thinking, toolCalls }) => {
      messages.push({
        role: 'assistant',
        content: content ?? '',
        ...(thinking.trim() ? { thinking } : {}),
        tool_calls: normalizeToolCallsForReplay(toolCalls.filter((t) => t.function?.name)),
      })
    },
    appendToolResult: ({ messages, name, result }) => {
      messages.push({
        role: 'tool',
        tool_name: name,
        content: result,
      })
    },
    appendToolRequiredReprompt: (messages) => {
      messages.push({
        role: 'user',
        content:
          'Tool call required: do not answer with plain text. Call the appropriate available tool now and only then provide the final answer from real tool output.',
      })
    },
    appendRuntimeRecalledImages: (messages, recalled) => {
      messages.push({
        role: 'user',
        content: 'Image recall payload for current turn.',
        images: recalled.map((x) => x.base64),
      })
    },
    collectRecalledImages: ({ name, argsRaw }) => {
      if (name !== 'image_recall') return []
      const argsObj = argumentsStringToObject(argsRaw)
      const recall = resolveImageRecallRequest(argsObj, {
        userImages: params.userImages,
        userImageMimes: params.userImageMimes,
        userImagePaths: params.userImagePaths,
      })
      return recall.recalled.map((img) => ({ base64: img.base64, mime: img.mime }))
    },
    onNoToolCalls: async ({ round, runSyntheticTool }) => {
      if (round !== 0) return false
      if (
        !forcedScrapeDone &&
        params.toolsEnabled.scrape &&
        typeof originalUserUrl === 'string' &&
        originalUserUrl.length > 0
      ) {
        forcedScrapeDone = true
        params.onToolPhase?.('scrape')
        await runSyntheticTool(
          'scrape_url',
          { url: originalUserUrl, max_chars: 40000 },
          () => ({
            type: 'function',
            function: {
              name: 'scrape_url',
              arguments: { url: originalUserUrl, max_chars: 40000 },
            },
          }),
        )
        params.onToolPhase?.(null)
        return true
      }
      if (!forcedWebDone && params.toolsEnabled.webSearch && originalNeedsFresh) {
        const forcedQuery = deriveSearchQuery(originalUserText)
        if (forcedQuery) {
          forcedWebDone = true
          params.onToolPhase?.('search')
          await runSyntheticTool(
            'web_search',
            { query: forcedQuery },
            () => ({
              type: 'function',
              function: {
                name: 'web_search',
                arguments: { query: forcedQuery },
              },
            }),
          )
          params.onToolPhase?.(null)
          return true
        }
      }
      return false
    },
    executeToolCall: (name, argsRaw) =>
      executeToolCall(name, argsRaw, params.toolsEnabled, {
        ttsBaseUrl: params.ttsBaseUrl,
        signal: params.signal,
        pdfOutputDir: params.pdfOutputDir,
        runware: params.runware,
        userImages: params.userImages,
        userImageMimes: params.userImageMimes,
        userImagePaths: params.userImagePaths,
        codingProjectPath: params.codingProjectPath,
        userText: originalUserText,
      }),
    parseArgsForToolResult: argumentsStringToObject,
    onDelta: params.onDelta,
    onThinkingDelta: params.onThinkingDelta,
    onToolPhase: params.onToolPhase,
    toolPhaseForName: (name) => toolPhaseForAgentTool(name),
    onToolResult: params.onToolResult,
  })
}
