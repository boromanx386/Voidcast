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
import type { LongMemoryKind } from '@/types/longMemory'
import { buildOllamaToolsList } from '@/lib/toolDefinitions'
import { invokeWebSearch } from '@/lib/webSearch'
import { invokeGetWeather } from '@/lib/weather'
import { invokeScrapeUrl } from '@/lib/scrapeUrl'
import { invokeSavePdf } from '@/lib/savePdf'
import { invokeYoutubeTool } from '@/lib/youtubeTool'
import {
  invokeRunwareEditImage,
  invokeRunwareGenerateImage,
  invokeRunwareGenerateMusic,
  type RunwareImageConfig,
} from '@/lib/runware'
import {
  invokeExecuteCodingCommand,
  invokeEditCodingFile,
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
import { mergeOllamaUsage, parseChatStreamUsage } from '@/lib/ollama'

const MAX_TOOL_ROUNDS = 18
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
    try {
      return await invokeSavePdf({
        content,
        title,
        filename,
        outputDir: dir,
        images: images.length ? images : undefined,
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
          steps: typeof args.steps === 'number' ? args.steps : undefined,
          cfgScale:
            typeof args.cfg_scale === 'number'
              ? args.cfg_scale
              : typeof args.cfgScale === 'number'
                ? args.cfgScale
                : undefined,
          outputFormat:
            args.output_format === 'MP3' ||
            args.output_format === 'WAV' ||
            args.output_format === 'FLAC' ||
            args.output_format === 'OGG'
              ? args.output_format
              : args.outputFormat === 'MP3' ||
                  args.outputFormat === 'WAV' ||
                  args.outputFormat === 'FLAC' ||
                  args.outputFormat === 'OGG'
                ? args.outputFormat
                : undefined,
          seed: typeof args.seed === 'number' ? args.seed : undefined,
          bpm: typeof args.bpm === 'number' ? args.bpm : undefined,
          keyScale:
            typeof args.key_scale === 'string'
              ? args.key_scale
              : typeof args.keyScale === 'string'
                ? args.keyScale
                : undefined,
          guidanceType:
            args.guidance_type === 'apg' || args.guidance_type === 'cfg'
              ? args.guidance_type
              : args.guidanceType === 'apg' || args.guidanceType === 'cfg'
                ? args.guidanceType
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
  if (name === 'list_directory') {
    if (!toolsEnabled.coding) return 'Error: list_directory tool is disabled in settings.'
    const projectPath = (ctx.codingProjectPath || '').trim()
    if (!projectPath) return 'Error: coding project folder is not set in settings.'
    const relativePath = typeof args.path === 'string' ? args.path.trim() : ''
    try {
      const entries = await invokeListCodingDirectory(projectPath, relativePath)
      if (entries.length === 0) return 'Directory is empty.'
      return entries
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
    return (await invokeReadCodingFile(projectPath, relativePath)).text
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
    return (await invokeSearchCodingFiles(projectPath, query)).text
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
}): Promise<{ content: string; tool_calls: OllamaToolCall[]; usage?: OllamaChatUsage }> {
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

  const res = await fetch(`${root}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: options.signal,
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`Ollama /api/chat ${res.status}: ${errText || res.statusText}`)
  }
  if (!res.body) throw new Error('No response body')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let fullContent = ''
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
          tool_calls?: OllamaToolCall[]
        }
        error?: string
      }
      if (last.error) throw new Error(last.error)
      usage = mergeOllamaUsage(usage, parseChatStreamUsage(last))
      if (last.message?.tool_calls?.length) {
        mergeToolCallDeltas(toolCalls, last.message.tool_calls)
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
  /** Called when a tool phase starts; pass null to clear (e.g. before next model stream). */
  onToolPhase?: (
    phase:
      | 'search'
      | 'youtube'
      | 'weather'
      | 'scrape'
      | 'pdf'
      | 'image'
      | 'music'
      | 'coding'
      | 'other'
      | null,
  ) => void
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

  const messages: OllamaApiMessage[] = [...params.initialMessages]
  let lastAssistantText = ''
  let persistedAssistantPrefix = ''
  let lastUsage: OllamaChatUsage | undefined
  let forcedWebDone = false
  let forcedScrapeDone = false
  const originalUserText = getLastUserText(messages)
  const originalUserUrl = pickFirstHttpUrl(originalUserText)
  const originalNeedsFresh = shouldForceWebSearch(originalUserText)
  const runtimeRecalledImages: Array<{ base64: string; mime: string }> = []

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    if (params.signal?.aborted) {
      const err = new Error('Aborted')
      err.name = 'AbortError'
      throw err
    }

    const { content, tool_calls, usage } = await streamOllamaChatOnce({
      baseUrl: params.baseUrl,
      model: params.model,
      messages,
      modelOptions: params.modelOptions,
      tools,
      signal: params.signal,
      onDelta: (full) => {
        const combined = `${persistedAssistantPrefix}${full}`
        lastAssistantText = combined
        params.onDelta(combined)
      },
    })
    lastUsage = mergeOllamaUsage(lastUsage, usage)

    const validCalls = tool_calls.filter((t) => t.function?.name)
    if (validCalls.length === 0) {
      // If model skipped tools on the first round, apply one forced call when
      // user's request clearly needs it (URL scrape or time-sensitive web search).
      if (round === 0) {
        if (
          !forcedScrapeDone &&
          params.toolsEnabled.scrape &&
          typeof originalUserUrl === 'string' &&
          originalUserUrl.length > 0
        ) {
          forcedScrapeDone = true
          params.onToolPhase?.('scrape')
          const result = await executeToolCall(
            'scrape_url',
            { url: originalUserUrl, max_chars: 40000 },
            params.toolsEnabled,
            {
              ttsBaseUrl: params.ttsBaseUrl,
              signal: params.signal,
              pdfOutputDir: params.pdfOutputDir,
              runware: params.runware,
              userImages: params.userImages,
              userImageMimes: params.userImageMimes,
              userImagePaths: params.userImagePaths,
              userText: originalUserText,
            },
          )
          messages.push({
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                type: 'function',
                function: {
                  name: 'scrape_url',
                  arguments: { url: originalUserUrl, max_chars: 40000 },
                },
              },
            ],
          })
          messages.push({
            role: 'tool',
            tool_name: 'scrape_url',
            content: result,
          })
          params.onToolResult?.({ name: 'scrape_url', result, args: { url: originalUserUrl, max_chars: 40000 } })
          params.onToolPhase?.(null)
          persistedAssistantPrefix = lastAssistantText
          if (persistedAssistantPrefix.trim() && !persistedAssistantPrefix.endsWith('\n\n')) {
            persistedAssistantPrefix = `${persistedAssistantPrefix.trimEnd()}\n\n`
          }
          continue
        }
        if (
          !forcedWebDone &&
          params.toolsEnabled.webSearch &&
          originalNeedsFresh
        ) {
          const forcedQuery = deriveSearchQuery(originalUserText)
          if (forcedQuery) {
            forcedWebDone = true
            params.onToolPhase?.('search')
            const result = await executeToolCall(
              'web_search',
              { query: forcedQuery },
              params.toolsEnabled,
              {
                ttsBaseUrl: params.ttsBaseUrl,
                signal: params.signal,
                pdfOutputDir: params.pdfOutputDir,
                runware: params.runware,
                userImages: params.userImages,
                userImageMimes: params.userImageMimes,
                userImagePaths: params.userImagePaths,
                userText: originalUserText,
              },
            )
            messages.push({
              role: 'assistant',
              content: '',
              tool_calls: [
                {
                  type: 'function',
                  function: {
                    name: 'web_search',
                    arguments: { query: forcedQuery },
                  },
                },
              ],
            })
            messages.push({
              role: 'tool',
              tool_name: 'web_search',
              content: result,
            })
            params.onToolResult?.({ name: 'web_search', result, args: { query: forcedQuery } })
            params.onToolPhase?.(null)
            persistedAssistantPrefix = lastAssistantText
            if (persistedAssistantPrefix.trim() && !persistedAssistantPrefix.endsWith('\n\n')) {
              persistedAssistantPrefix = `${persistedAssistantPrefix.trimEnd()}\n\n`
            }
            continue
          }
        }
      }
      return { content: lastAssistantText || content, usage: lastUsage }
    }

    messages.push({
      role: 'assistant',
      content: content ?? '',
      tool_calls: normalizeToolCallsForReplay(validCalls),
    })

    for (const call of validCalls) {
      const name = call.function!.name!
      if (name === 'web_search') params.onToolPhase?.('search')
      else if (name === 'search_youtube') params.onToolPhase?.('youtube')
      else if (name === 'get_weather') params.onToolPhase?.('weather')
      else if (name === 'scrape_url') params.onToolPhase?.('scrape')
      else if (name === 'save_pdf') params.onToolPhase?.('pdf')
      else if (name === 'generate_image' || name === 'edit_image_runware' || name === 'image_recall') params.onToolPhase?.('image')
      else if (name === 'generate_music_runware') params.onToolPhase?.('music')
      else if (name === 'list_directory' || name === 'read_file' || name === 'write_file' || name === 'edit_code' || name === 'search_files' || name === 'execute_command') params.onToolPhase?.('coding')
      else params.onToolPhase?.('other')

      const result = await executeToolCall(
        name,
        call.function!.arguments,
        params.toolsEnabled,
        {
          ttsBaseUrl: params.ttsBaseUrl,
          signal: params.signal,
          pdfOutputDir: params.pdfOutputDir,
          runware: params.runware,
          userImages: params.userImages,
          userImageMimes: params.userImageMimes,
          userImagePaths: params.userImagePaths,
          codingProjectPath: params.codingProjectPath,
          userText: originalUserText,
        },
      )
      messages.push({
        role: 'tool',
        tool_name: name,
        content: result,
      })
      params.onToolResult?.({ name, result, args: argumentsStringToObject(call.function!.arguments) })
      if (name === 'image_recall') {
        const argsObj = argumentsStringToObject(call.function!.arguments)
        const recall = resolveImageRecallRequest(argsObj, {
          userImages: params.userImages,
          userImageMimes: params.userImageMimes,
          userImagePaths: params.userImagePaths,
        })
        if (recall.recalled.length > 0) {
          for (const img of recall.recalled) {
            runtimeRecalledImages.push({ base64: img.base64, mime: img.mime })
          }
        }
      }
    }

    if (runtimeRecalledImages.length > 0) {
      const consumed = runtimeRecalledImages.splice(0, runtimeRecalledImages.length)
      messages.push({
        role: 'user',
        content: 'Image recall payload for current turn.',
        images: consumed.map((x) => x.base64),
      })
    }

    params.onToolPhase?.(null)
    persistedAssistantPrefix = lastAssistantText
    if (persistedAssistantPrefix.trim() && !persistedAssistantPrefix.endsWith('\n\n')) {
      persistedAssistantPrefix = `${persistedAssistantPrefix.trimEnd()}\n\n`
    }
  }

  return { content: lastAssistantText, usage: lastUsage }
}
