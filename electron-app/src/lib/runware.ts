import {
  normalizeBaseUrl,
  RUNWARE_GPT_IMAGE_2_MODEL_ID,
  RUNWARE_Z_IMAGE_TURBO_MODEL_ID,
} from '@/lib/settings'

export type RunwareImageConfig = {
  apiBaseUrl: string
  apiKey: string
  /** Optional local proxy base URL (e.g. TTS server) for CORS-safe forwarding. */
  proxyBaseUrl?: string
  /** Default Runware model id for text-to-image generation. */
  model: string
  /** Default Runware model id for image editing with references. */
  editModel?: string
  width: number
  height: number
  steps: number
  cfgScale: number
  gptQuality?: 'auto' | 'low' | 'medium' | 'high'
  /** Optional edit defaults resolved from selected edit model profile. */
  editDefaults?: {
    width: number
    height: number
    steps: number
    cfgScale: number
    gptQuality?: 'auto' | 'low' | 'medium' | 'high'
  }
  negativePrompt?: string
  /** Optional defaults for Runware music generation (ACE-Step). */
  musicDefaults?: {
    outputFormat: 'MP3' | 'WAV' | 'FLAC' | 'OGG'
    durationSec: number
    steps: number
    cfgScale: number
    guidanceType: 'apg' | 'cfg'
    vocalLanguage: string
    seed?: number | null
  }
}

export type RunwareGenerateImageRequest = {
  prompt: string
  negativePrompt?: string
  width?: number
  height?: number
  steps?: number
  cfgScale?: number
  model?: string
}

export type RunwareEditImageRequest = {
  prompt: string
  /** Data URIs or raw base64 references mapped from attached images. */
  referenceImages: string[]
  negativePrompt?: string
  width?: number
  height?: number
  steps?: number
  cfgScale?: number
  model?: string
}

export type RunwareGenerateMusicRequest = {
  prompt: string
  negativePrompt?: string
  outputFormat?: 'MP3' | 'WAV' | 'FLAC' | 'OGG'
  durationSec?: number
  steps?: number
  cfgScale?: number
  seed?: number
  lyrics?: string
  bpm?: number
  keyScale?: string
  timeSignature?: '2' | '3' | '4' | '6'
  vocalLanguage?: string
  guidanceType?: 'apg' | 'cfg'
}

type RunwareInferenceResult = {
  imageURL?: string
  seed?: number
  taskUUID?: string
  imageUUID?: string
  cost?: number
}

type RunwareModelSearchResult = {
  air?: string
  model?: string
  name?: string
  category?: string
  type?: string
  architecture?: string
  tags?: string[]
  capabilities?: string[] | string
}

export type RunwareModelOption = {
  id: string
  label: string
}

const RUNWARE_FLUX_9B_MODEL_ID = 'runware:400@6'
export const RUNWARE_ACE_STEP_V1_5_TURBO_MODEL_ID = 'runware:ace-step@v1.5-turbo'

export const RUNWARE_ALLOWED_EDIT_MODEL_IDS = [
  RUNWARE_FLUX_9B_MODEL_ID,
  RUNWARE_Z_IMAGE_TURBO_MODEL_ID,
  RUNWARE_GPT_IMAGE_2_MODEL_ID,
] as const

const RUNWARE_ALLOWED_EDIT_MODEL_SET = new Set<string>(
  RUNWARE_ALLOWED_EDIT_MODEL_IDS.map((x) => x.toLowerCase()),
)

function isAllowedEditModelId(modelId: string): boolean {
  return RUNWARE_ALLOWED_EDIT_MODEL_SET.has(modelId.trim().toLowerCase())
}

function isGptImage2Model(modelId: string): boolean {
  return modelId.trim().toLowerCase() === RUNWARE_GPT_IMAGE_2_MODEL_ID.toLowerCase()
}

function isZImageTurboModel(modelId: string): boolean {
  return modelId.trim().toLowerCase() === RUNWARE_Z_IMAGE_TURBO_MODEL_ID.toLowerCase()
}

function normalizeGptQuality(
  value: unknown,
): 'auto' | 'low' | 'medium' | 'high' | undefined {
  if (value === 'auto' || value === 'low' || value === 'medium' || value === 'high') {
    return value
  }
  return undefined
}

function normalizeStringArray(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v
      .filter((x): x is string => typeof x === 'string')
      .map((x) => x.trim())
      .filter(Boolean)
  }
  if (typeof v === 'string' && v.trim()) return [v.trim()]
  return []
}

function isDesiredImageBaseModel(item: RunwareModelSearchResult): boolean {
  const id = (item.air || item.model || '').trim().toLowerCase()
  const name = (item.name || '').trim().toLowerCase()
  const category = (item.category || '').trim().toLowerCase()
  const type = (item.type || '').trim().toLowerCase()
  const architecture = (item.architecture || '').trim().toLowerCase()
  const tags = normalizeStringArray(item.tags).join(' ').toLowerCase()
  const capabilities = normalizeStringArray(item.capabilities).join(' ').toLowerCase()
  const hay = [id, name, category, type, architecture, tags, capabilities].join(' ')

  if (id.startsWith('civitai:')) return false

  const rejectTerms = [
    'lora',
    'lycoris',
    'embedding',
    'textual inversion',
    'controlnet',
    'vae',
    'upscale',
    'caption',
    'remove background',
  ]
  if (rejectTerms.some((t) => hay.includes(t))) return false

  if (capabilities.includes('text to image')) return true
  if (capabilities.includes('image generation')) return true
  if (type === 'base') return true
  if (category === 'checkpoint') return true

  const preferredHints = [
    'qwen-image',
    'z-image',
    'flux',
    'imagen',
    'gpt image',
    'ideogram',
    'seedream',
    'hidream',
    'recraft',
  ]
  return preferredHints.some((t) => hay.includes(t))
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

function asFiniteNumber(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null
  return v
}

function makeTaskUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `rw-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

type RunwareApiBody = {
  data?: Array<{
    results?: RunwareModelSearchResult[]
    imageURL?: string
    seed?: number
    taskUUID?: string
    imageUUID?: string
    audioURL?: string
    audioUUID?: string
    cost?: number
  }>
  errors?: Array<{ message?: string }>
  message?: string
  error?: string
}

function readRunwareError(body: RunwareApiBody, status?: number): string {
  return (
    body.errors?.[0]?.message ||
    body.message ||
    body.error ||
    (typeof status === 'number' ? `Runware HTTP ${status}` : 'Runware request failed')
  )
}

function looksLikeNetworkFetchError(e: unknown): boolean {
  if (!(e instanceof Error)) return false
  const msg = e.message.toLowerCase()
  return msg.includes('failed to fetch') || msg.includes('networkerror')
}

async function postRunwareTasks(args: {
  apiBaseUrl: string
  apiKey: string
  tasks: unknown[]
  signal?: AbortSignal
  proxyBaseUrl?: string
}): Promise<RunwareApiBody> {
  const directRoot = normalizeBaseUrl(args.apiBaseUrl || 'https://api.runware.ai/v1')
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${args.apiKey}`,
  }
  const bodyText = JSON.stringify(args.tasks)

  try {
    const res = await fetch(directRoot, {
      method: 'POST',
      headers,
      body: bodyText,
      signal: args.signal,
    })
    const body = (await res.json().catch(() => ({}))) as RunwareApiBody
    if (!res.ok) throw new Error(readRunwareError(body, res.status))
    return body
  } catch (e) {
    if (!args.proxyBaseUrl || !looksLikeNetworkFetchError(e)) {
      throw e instanceof Error ? e : new Error(String(e))
    }
    const proxyRoot = normalizeBaseUrl(args.proxyBaseUrl)
    const proxyRes = await fetch(`${proxyRoot}/tools/runware_proxy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_base_url: directRoot,
        api_key: args.apiKey,
        tasks: args.tasks,
      }),
      signal: args.signal,
    })
    const proxyBody = (await proxyRes.json().catch(() => ({}))) as {
      ok?: boolean
      data?: RunwareApiBody
      detail?: string
    }
    if (!proxyRes.ok || !proxyBody.ok || !proxyBody.data) {
      const detail = proxyBody.detail || `Runware proxy HTTP ${proxyRes.status}`
      throw new Error(detail)
    }
    return proxyBody.data
  }
}

function extractModelIdsFromRunwareBody(body: RunwareApiBody): string[] {
  const dataItems = Array.isArray(body.data) ? body.data : []
  const nestedResults = dataItems.flatMap((d) =>
    Array.isArray(d.results) ? d.results : [],
  )
  const directResults = dataItems as RunwareModelSearchResult[]
  const allCandidates = [...nestedResults, ...directResults].filter(isDesiredImageBaseModel)
  const ids = allCandidates
    .map((x) => (x.air || x.model || '').trim())
    .filter((x) => x.length > 0)
  return Array.from(new Set(ids))
}

function extractModelOptionsFromRunwareBody(body: RunwareApiBody): RunwareModelOption[] {
  const dataItems = Array.isArray(body.data) ? body.data : []
  const nestedResults = dataItems.flatMap((d) =>
    Array.isArray(d.results) ? d.results : [],
  )
  const directResults = dataItems as RunwareModelSearchResult[]
  const allCandidates = [...nestedResults, ...directResults].filter(isDesiredImageBaseModel)
  const byId = new Map<string, RunwareModelOption>()
  for (const item of allCandidates) {
    const id = (item.air || item.model || '').trim()
    if (!id) continue
    const name = (item.name || '').trim()
    const label = name ? `${name} (${id})` : id
    if (!byId.has(id)) byId.set(id, { id, label })
  }
  return Array.from(byId.values())
}

export async function fetchRunwareImageModels(options: {
  apiBaseUrl: string
  apiKey: string
  proxyBaseUrl?: string
  search?: string
  limit?: number
  signal?: AbortSignal
}): Promise<string[]> {
  const apiKey = (options.apiKey || '').trim()
  if (!apiKey) {
    throw new Error('Runware API key is required to load models.')
  }
  const root = normalizeBaseUrl(options.apiBaseUrl || 'https://api.runware.ai/v1')
  const search = (options.search || 'image').trim()
  const limit = clamp(Math.round(options.limit ?? 100), 1, 100)
  const queries = Array.from(
    new Set(
      [
        search,
        'qwen-image',
        'z-image',
        'flux',
        'imagen',
        'gpt image',
        'ideogram',
        'runware',
      ].filter(Boolean),
    ),
  )
  const merged: string[] = []

  for (const q of queries) {
    const taskVariants: Array<Record<string, unknown>> = [
      {
        taskType: 'modelSearch',
        taskUUID: makeTaskUuid(),
        search: q,
        type: 'base',
        limit,
        offset: 0,
      },
      {
        taskType: 'modelSearch',
        taskUUID: makeTaskUuid(),
        search: q,
        category: 'checkpoint',
        limit,
        offset: 0,
      },
      {
        taskType: 'modelSearch',
        taskUUID: makeTaskUuid(),
        search: q,
        category: 'checkpoint',
        visibility: 'public',
        limit,
        offset: 0,
      },
    ]

    for (const task of taskVariants) {
      try {
        const body = await postRunwareTasks({
          apiBaseUrl: root,
          apiKey,
          tasks: [task],
          signal: options.signal,
          proxyBaseUrl: options.proxyBaseUrl,
        })
        merged.push(...extractModelIdsFromRunwareBody(body))
        if (merged.length >= 80) break
      } catch {
        // Try next variant/query; we intentionally avoid failing fast here.
      }
    }
    if (merged.length >= 80) break
  }
  return Array.from(new Set(merged))
}

export async function fetchRunwareImageModelOptions(options: {
  apiBaseUrl: string
  apiKey: string
  proxyBaseUrl?: string
  search?: string
  limit?: number
  signal?: AbortSignal
}): Promise<RunwareModelOption[]> {
  const apiKey = (options.apiKey || '').trim()
  if (!apiKey) {
    throw new Error('Runware API key is required to load models.')
  }
  const root = normalizeBaseUrl(options.apiBaseUrl || 'https://api.runware.ai/v1')
  const search = (options.search || 'image').trim()
  const limit = clamp(Math.round(options.limit ?? 100), 1, 100)
  const queries = Array.from(
    new Set(
      [
        search,
        'qwen-image',
        'z-image',
        'flux',
        'imagen',
        'gpt image',
        'ideogram',
        'runware',
      ].filter(Boolean),
    ),
  )
  const merged: RunwareModelOption[] = []
  const seen = new Set<string>()

  for (const q of queries) {
    const taskVariants: Array<Record<string, unknown>> = [
      {
        taskType: 'modelSearch',
        taskUUID: makeTaskUuid(),
        search: q,
        type: 'base',
        limit,
        offset: 0,
      },
      {
        taskType: 'modelSearch',
        taskUUID: makeTaskUuid(),
        search: q,
        category: 'checkpoint',
        limit,
        offset: 0,
      },
      {
        taskType: 'modelSearch',
        taskUUID: makeTaskUuid(),
        search: q,
        category: 'checkpoint',
        visibility: 'public',
        limit,
        offset: 0,
      },
    ]
    for (const task of taskVariants) {
      try {
        const body = await postRunwareTasks({
          apiBaseUrl: root,
          apiKey,
          tasks: [task],
          signal: options.signal,
          proxyBaseUrl: options.proxyBaseUrl,
        })
        const optionsFromBody = extractModelOptionsFromRunwareBody(body)
        for (const opt of optionsFromBody) {
          if (!seen.has(opt.id)) {
            seen.add(opt.id)
            merged.push(opt)
          }
        }
        if (merged.length >= 80) break
      } catch {
        // Ignore one variant and continue to maximize chance of success.
      }
    }
    if (merged.length >= 80) break
  }
  return merged
}

function formatRunwareToolResult(payload: {
  imageUrl: string
  model: string
  prompt?: string
  width: number
  height: number
  steps?: number
  cfgScale?: number
  seed?: number
  taskUUID?: string
  imageUUID?: string
  cost?: number
  elapsedMs?: number
}): string {
  const lines = [
    'Runware image generated successfully.',
    `image_url: ${payload.imageUrl}`,
    `model: ${payload.model}`,
    `size: ${payload.width}x${payload.height}`,
  ]
  if (payload.prompt?.trim()) {
    const compactPrompt = payload.prompt.replace(/\s+/g, ' ').trim()
    lines.push(`prompt: ${compactPrompt}`)
  }
  if (typeof payload.steps === 'number') lines.push(`steps: ${payload.steps}`)
  if (typeof payload.cfgScale === 'number') lines.push(`cfg_scale: ${payload.cfgScale}`)
  if (typeof payload.seed === 'number') lines.push(`seed: ${payload.seed}`)
  if (payload.taskUUID) lines.push(`task_uuid: ${payload.taskUUID}`)
  if (payload.imageUUID) lines.push(`image_uuid: ${payload.imageUUID}`)
  if (typeof payload.cost === 'number' && Number.isFinite(payload.cost)) {
    lines.push(`cost_usd: ${payload.cost.toFixed(6)}`)
  }
  if (typeof payload.elapsedMs === 'number' && Number.isFinite(payload.elapsedMs)) {
    lines.push(`elapsed_ms: ${Math.max(0, Math.round(payload.elapsedMs))}`)
  }
  return lines.join('\n')
}

function formatRunwareMusicToolResult(payload: {
  audioUrl: string
  model: string
  outputFormat: 'MP3' | 'WAV' | 'FLAC' | 'OGG'
  durationSec: number
  steps: number
  cfgScale: number
  guidanceType: 'apg' | 'cfg'
  vocalLanguage: string
  seed?: number
  taskUUID?: string
  audioUUID?: string
  cost?: number
  elapsedMs?: number
}): string {
  const lines = [
    'Runware music generated successfully.',
    `audio_url: ${payload.audioUrl}`,
    `model: ${payload.model}`,
    `output_format: ${payload.outputFormat}`,
    `duration_sec: ${payload.durationSec}`,
    `steps: ${payload.steps}`,
    `cfg_scale: ${payload.cfgScale}`,
    `guidance_type: ${payload.guidanceType}`,
    `vocal_language: ${payload.vocalLanguage}`,
  ]
  if (typeof payload.seed === 'number') lines.push(`seed: ${payload.seed}`)
  if (payload.taskUUID) lines.push(`task_uuid: ${payload.taskUUID}`)
  if (payload.audioUUID) lines.push(`audio_uuid: ${payload.audioUUID}`)
  if (typeof payload.cost === 'number' && Number.isFinite(payload.cost)) {
    lines.push(`cost_usd: ${payload.cost.toFixed(6)}`)
  }
  if (typeof payload.elapsedMs === 'number' && Number.isFinite(payload.elapsedMs)) {
    lines.push(`elapsed_ms: ${Math.max(0, Math.round(payload.elapsedMs))}`)
  }
  return lines.join('\n')
}

function normalizeImageDataUri(value: string): string {
  const raw = (value || '').trim()
  if (!raw) return ''
  if (raw.startsWith('data:image/')) return raw
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw
  const cleaned = raw.replace(/\s+/g, '')
  return `data:image/png;base64,${cleaned}`
}

function quantizeToStep16(value: number): number {
  return Math.round(value / 16) * 16
}

function fitGptImage2Dimensions(width: number, height: number): {
  width: number
  height: number
  adjusted: boolean
  notes: string[]
} {
  const MIN_PIXELS = 655360
  const MAX_PIXELS = 8294400
  const MAX_ASPECT = 3
  let w = clamp(quantizeToStep16(width), 480, 3840)
  let h = clamp(quantizeToStep16(height), 480, 3840)
  const originalW = w
  const originalH = h
  const notes: string[] = []

  let pixels = w * h
  if (pixels < MIN_PIXELS) {
    const scale = Math.sqrt(MIN_PIXELS / Math.max(1, pixels))
    w = clamp(quantizeToStep16(w * scale), 480, 3840)
    h = clamp(quantizeToStep16(h * scale), 480, 3840)
    pixels = w * h
  }
  if (pixels > MAX_PIXELS) {
    const scale = Math.sqrt(MAX_PIXELS / pixels)
    w = clamp(quantizeToStep16(w * scale), 480, 3840)
    h = clamp(quantizeToStep16(h * scale), 480, 3840)
    pixels = w * h
  }

  if (w / h > MAX_ASPECT) {
    w = quantizeToStep16(h * MAX_ASPECT)
    notes.push('aspect_ratio_clamped_for_model')
  } else if (h / w > MAX_ASPECT) {
    h = quantizeToStep16(w * MAX_ASPECT)
    notes.push('aspect_ratio_clamped_for_model')
  }

  w = clamp(w, 480, 3840)
  h = clamp(h, 480, 3840)
  pixels = w * h
  while (pixels > MAX_PIXELS) {
    if (w >= h && w > 480) w -= 16
    else if (h > 480) h -= 16
    else break
    pixels = w * h
  }
  while (pixels < MIN_PIXELS) {
    if (w <= h && w < 3840) w += 16
    else if (h < 3840) h += 16
    else break
    pixels = w * h
  }

  return {
    width: w,
    height: h,
    adjusted: w !== originalW || h !== originalH,
    notes,
  }
}

export async function invokeRunwareGenerateImage(
  req: RunwareGenerateImageRequest,
  config: RunwareImageConfig,
  signal?: AbortSignal,
): Promise<string> {
  const prompt = (req.prompt || '').trim()
  if (!prompt) throw new Error('Runware generate_image requires a non-empty prompt.')
  const apiKey = (config.apiKey || '').trim()
  if (!apiKey) throw new Error('Runware API key is not set. Configure it in Options -> Runware.')

  const root = normalizeBaseUrl(config.apiBaseUrl || 'https://api.runware.ai/v1')
  const model = (req.model || config.model || '').trim()
  if (!model) throw new Error('Runware model is not set. Configure it in Options -> Runware.')
  const isGptImage2 = isGptImage2Model(model)
  const isZImageTurbo = isZImageTurboModel(model)

  // Resolution is always sourced from the active Options profile.
  const rawWidth = isGptImage2
    ? clamp(Math.round(config.width), 480, 3840)
    : isZImageTurbo
      ? clamp(Math.round(config.width), 128, 2048)
    : clamp(Math.round(config.width), 256, 2048)
  const rawHeight = isGptImage2
    ? clamp(Math.round(config.height), 480, 3840)
    : isZImageTurbo
      ? clamp(Math.round(config.height), 128, 2048)
    : clamp(Math.round(config.height), 256, 2048)
  const fitted = isGptImage2
    ? fitGptImage2Dimensions(rawWidth, rawHeight)
    : { width: rawWidth, height: rawHeight, adjusted: false, notes: [] as string[] }
  const width = fitted.width
  const height = fitted.height
  const steps = clamp(Math.round(asFiniteNumber(req.steps) ?? config.steps), 1, 80)
  const cfgScale = clamp(asFiniteNumber(req.cfgScale) ?? config.cfgScale, 0, 30)
  const gptQuality = normalizeGptQuality(config.gptQuality) ?? 'auto'
  const negativePrompt = (req.negativePrompt ?? config.negativePrompt ?? '').trim()
  const taskUUID = makeTaskUuid()

  const payload: Record<string, unknown> = {
    taskType: 'imageInference',
    taskUUID,
    includeCost: true,
    model,
    positivePrompt: prompt,
    width,
    height,
  }
  if (!isGptImage2) {
    payload.steps = steps
    payload.CFGScale = cfgScale
    if (negativePrompt) payload.negativePrompt = negativePrompt
  } else {
    payload.providerSettings = {
      openai: {
        quality: gptQuality,
      },
    }
  }

  const started = Date.now()
  const body = await postRunwareTasks({
    apiBaseUrl: root,
    apiKey,
    tasks: [payload],
    signal,
    proxyBaseUrl: config.proxyBaseUrl,
  })
  const elapsedMs = Date.now() - started

  const first = Array.isArray(body.data) ? body.data[0] : undefined
  const imageUrl = first?.imageURL?.trim()
  if (!imageUrl) {
    const errMessage = readRunwareError(body) || 'Runware returned no image URL.'
    throw new Error(errMessage)
  }

  const out = formatRunwareToolResult({
    imageUrl,
    model,
    prompt,
    width,
    height,
    ...(isGptImage2 ? {} : { steps, cfgScale }),
    seed: first?.seed,
    taskUUID: first?.taskUUID,
    imageUUID: first?.imageUUID,
    cost: first?.cost,
    elapsedMs,
  })
  if (isGptImage2 && fitted.adjusted) {
    return `${out}\nsize_adjusted_for_model: ${rawWidth}x${rawHeight} -> ${width}x${height}`
  }
  return out
}

export async function invokeRunwareEditImage(
  req: RunwareEditImageRequest,
  config: RunwareImageConfig,
  signal?: AbortSignal,
): Promise<string> {
  const prompt = (req.prompt || '').trim()
  if (!prompt) throw new Error('Runware edit_image_runware requires a non-empty prompt.')
  const apiKey = (config.apiKey || '').trim()
  if (!apiKey) throw new Error('Runware API key is not set. Configure it in Options -> Runware.')

  const refs = (req.referenceImages || [])
    .map((x) => normalizeImageDataUri(x))
    .filter((x) => x.length > 0)
  if (refs.length === 0) {
    throw new Error('Runware edit_image_runware requires at least one reference image.')
  }

  const root = normalizeBaseUrl(config.apiBaseUrl || 'https://api.runware.ai/v1')
  const model = (req.model || config.editModel || config.model || '').trim()
  if (!model) throw new Error('Runware edit model is not set. Configure it in Options -> Runware.')
  if (!isAllowedEditModelId(model)) {
    throw new Error(
      `Edit model "${model}" is not allowed. Allowed edit models: ${RUNWARE_ALLOWED_EDIT_MODEL_IDS.join(', ')}`,
    )
  }

  const isGptImage2 = isGptImage2Model(model)
  const isZImageTurbo = isZImageTurboModel(model)
  const modelRefs = isGptImage2 ? refs.slice(0, 16) : refs
  const editDefaultWidth = config.editDefaults?.width ?? config.width
  const editDefaultHeight = config.editDefaults?.height ?? config.height
  const editDefaultSteps = config.editDefaults?.steps ?? config.steps
  const editDefaultCfgScale = config.editDefaults?.cfgScale ?? config.cfgScale
  const editDefaultGptQuality = normalizeGptQuality(config.editDefaults?.gptQuality) ?? 'auto'
  // Resolution is always sourced from the active edit profile in Options.
  const rawWidth = isGptImage2
    ? clamp(Math.round(editDefaultWidth), 480, 3840)
    : isZImageTurbo
      ? clamp(Math.round(editDefaultWidth), 128, 2048)
    : clamp(Math.round(editDefaultWidth), 256, 2048)
  const rawHeight = isGptImage2
    ? clamp(Math.round(editDefaultHeight), 480, 3840)
    : isZImageTurbo
      ? clamp(Math.round(editDefaultHeight), 128, 2048)
    : clamp(Math.round(editDefaultHeight), 256, 2048)
  const fitted = isGptImage2
    ? fitGptImage2Dimensions(rawWidth, rawHeight)
    : { width: rawWidth, height: rawHeight, adjusted: false, notes: [] as string[] }
  const width = fitted.width
  const height = fitted.height
  const steps = clamp(Math.round(asFiniteNumber(req.steps) ?? editDefaultSteps), 1, 80)
  const cfgScale = clamp(asFiniteNumber(req.cfgScale) ?? editDefaultCfgScale, 0, 30)
  const negativePrompt = (req.negativePrompt ?? config.negativePrompt ?? '').trim()
  const taskUUID = makeTaskUuid()

  const payload: Record<string, unknown> = {
    taskType: 'imageInference',
    taskUUID,
    includeCost: true,
    model,
    positivePrompt: prompt,
    width,
    height,
    ...(isGptImage2 ? {} : { steps, CFGScale: cfgScale }),
  }
  payload.inputs = { referenceImages: modelRefs }
  if (!isGptImage2 && negativePrompt) payload.negativePrompt = negativePrompt
  if (isGptImage2) {
    payload.providerSettings = {
      openai: {
        quality: editDefaultGptQuality,
      },
    }
  }

  const started = Date.now()
  const body = await postRunwareTasks({
    apiBaseUrl: root,
    apiKey,
    tasks: [payload],
    signal,
    proxyBaseUrl: config.proxyBaseUrl,
  })
  const elapsedMs = Date.now() - started

  const first = Array.isArray(body.data) ? body.data[0] : undefined
  const imageUrl = first?.imageURL?.trim()
  if (!imageUrl) {
    const errMessage = readRunwareError(body) || 'Runware returned no image URL.'
    const summary = `request: model=${model}, refs=${modelRefs.length}, size=${width}x${height}, steps=${isGptImage2 ? 'n/a' : steps}, cfg=${isGptImage2 ? 'n/a' : cfgScale}`
    throw new Error(`${errMessage}\n${summary}`)
  }

  const out = formatRunwareToolResult({
    imageUrl,
    model,
    prompt,
    width,
    height,
    ...(isGptImage2 ? {} : { steps, cfgScale }),
    seed: first?.seed,
    taskUUID: first?.taskUUID,
    imageUUID: first?.imageUUID,
    cost: first?.cost,
    elapsedMs,
  })
  const notes: string[] = []
  if (isGptImage2 && refs.length > 16) {
    notes.push(`reference_images_limited_for_model: used 16 of ${refs.length}`)
  }
  if (isGptImage2 && fitted.adjusted) {
    notes.push(`size_adjusted_for_model: ${rawWidth}x${rawHeight} -> ${width}x${height}`)
  }
  for (const n of fitted.notes) notes.push(n)
  if (isGptImage2 && negativePrompt) {
    notes.push('negative_prompt_not_sent_for_model')
  }
  if (notes.length > 0) {
    return `${out}\n${notes.join('\n')}`
  }
  return out
}

function normalizeRunwareAudioOutputFormat(
  v: unknown,
): 'MP3' | 'WAV' | 'FLAC' | 'OGG' {
  const x = typeof v === 'string' ? v.trim().toUpperCase() : ''
  if (x === 'WAV' || x === 'FLAC' || x === 'OGG') return x
  return 'MP3'
}

function normalizeGuidanceType(v: unknown): 'apg' | 'cfg' {
  return v === 'cfg' ? 'cfg' : 'apg'
}

function normalizeVocalLanguage(v: unknown): string {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : ''
  return s || 'en'
}

export async function invokeRunwareGenerateMusic(
  req: RunwareGenerateMusicRequest,
  config: RunwareImageConfig,
  signal?: AbortSignal,
): Promise<string> {
  const prompt = (req.prompt || '').trim()
  if (!prompt) throw new Error('Runware generate_music_runware requires a non-empty prompt.')
  const apiKey = (config.apiKey || '').trim()
  if (!apiKey) throw new Error('Runware API key is not set. Configure it in Options -> Runware.')

  const root = normalizeBaseUrl(config.apiBaseUrl || 'https://api.runware.ai/v1')
  const model = RUNWARE_ACE_STEP_V1_5_TURBO_MODEL_ID
  const defaults = config.musicDefaults
  const outputFormat = normalizeRunwareAudioOutputFormat(req.outputFormat ?? defaults?.outputFormat)
  const durationSec = clamp(
    asFiniteNumber(req.durationSec) ?? defaults?.durationSec ?? 60,
    6,
    300,
  )
  const steps = clamp(
    Math.round(asFiniteNumber(req.steps) ?? defaults?.steps ?? 10),
    1,
    20,
  )
  const cfgScale = clamp(
    asFiniteNumber(req.cfgScale) ?? defaults?.cfgScale ?? 10,
    1,
    30,
  )
  const guidanceType = normalizeGuidanceType(req.guidanceType ?? defaults?.guidanceType)
  const vocalLanguage = normalizeVocalLanguage(req.vocalLanguage ?? defaults?.vocalLanguage)
  const seedRaw = asFiniteNumber(req.seed) ?? asFiniteNumber(defaults?.seed ?? null)
  const seed = seedRaw == null ? undefined : clamp(Math.round(seedRaw), 0, 2147483647)
  const negativePrompt = (req.negativePrompt || '').trim()
  const lyrics = (req.lyrics || '').trim()
  const keyScale = (req.keyScale || '').trim()
  const taskUUID = makeTaskUuid()

  const settings: Record<string, unknown> = {
    guidanceType,
    vocalLanguage,
  }
  if (lyrics) settings.lyrics = lyrics
  if (keyScale) settings.keyScale = keyScale
  if (typeof req.bpm === 'number' && Number.isFinite(req.bpm)) {
    settings.bpm = clamp(Math.round(req.bpm), 30, 300)
  }
  if (req.timeSignature === '2' || req.timeSignature === '3' || req.timeSignature === '4' || req.timeSignature === '6') {
    settings.timeSignature = req.timeSignature
  }

  const payload: Record<string, unknown> = {
    taskType: 'audioInference',
    taskUUID,
    includeCost: true,
    model,
    outputType: 'URL',
    outputFormat,
    positivePrompt: prompt,
    duration: durationSec,
    steps,
    CFGScale: cfgScale,
    settings,
  }
  if (negativePrompt) payload.negativePrompt = negativePrompt
  if (typeof seed === 'number') payload.seed = seed

  const started = Date.now()
  const body = await postRunwareTasks({
    apiBaseUrl: root,
    apiKey,
    tasks: [payload],
    signal,
    proxyBaseUrl: config.proxyBaseUrl,
  })
  const elapsedMs = Date.now() - started

  const first = Array.isArray(body.data) ? body.data[0] : undefined
  const audioUrl = (first?.audioURL || '').trim()
  if (!audioUrl) {
    const errMessage = readRunwareError(body) || 'Runware returned no audio URL.'
    throw new Error(errMessage)
  }

  return formatRunwareMusicToolResult({
    audioUrl,
    model,
    outputFormat,
    durationSec,
    steps,
    cfgScale,
    guidanceType,
    vocalLanguage,
    seed: first?.seed,
    taskUUID: first?.taskUUID,
    audioUUID: first?.audioUUID,
    cost: first?.cost,
    elapsedMs,
  })
}
