import { fitGptImage2Dimensions, quantizeToStep16 } from '@/lib/runware'
import {
  normalizeBaseUrl,
  normalizeOpenRouterImageModel,
  OPENROUTER_IMAGE_MODEL_DEFAULT,
  usesOpenRouterDedicatedImageApi,
  type ImageProvider,
} from '@/lib/settings'
import { usesServerCloudProxy } from '@/lib/platform'

export type OpenRouterImageConfig = {
  apiKey: string
  baseUrl: string
  model: string
  width: number
  height: number
  gptQuality?: 'auto' | 'low' | 'medium' | 'high'
  /** Optional LAN proxy root (TTS server origin). */
  proxyBaseUrl?: string
}

const ASPECT_RATIOS: Array<{ id: string; value: number }> = [
  { id: '1:1', value: 1 },
  { id: '2:3', value: 2 / 3 },
  { id: '3:2', value: 3 / 2 },
  { id: '3:4', value: 3 / 4 },
  { id: '4:3', value: 4 / 3 },
  { id: '4:5', value: 4 / 5 },
  { id: '5:4', value: 5 / 4 },
  { id: '9:16', value: 9 / 16 },
  { id: '16:9', value: 16 / 9 },
  { id: '21:9', value: 21 / 9 },
]

export function aspectRatioFromDimensions(width: number, height: number): string {
  const w = Math.max(1, width)
  const h = Math.max(1, height)
  const ratio = w / h
  let best = ASPECT_RATIOS[0]!
  let bestDist = Math.abs(ratio - best.value)
  for (const entry of ASPECT_RATIOS) {
    const dist = Math.abs(ratio - entry.value)
    if (dist < bestDist) {
      best = entry
      bestDist = dist
    }
  }
  return best.id
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

/** Fit dimensions for non-GPT OpenRouter image models: clamp + snap to step 16. */
function fitOpenRouterDefaultDimensions(
  rawWidth: number,
  rawHeight: number,
): { width: number; height: number; adjusted: boolean; notes: string[] } {
  const MIN = 256
  const MAX = 2048
  const originalW = clamp(Math.round(rawWidth), MIN, MAX)
  const originalH = clamp(Math.round(rawHeight), MIN, MAX)
  let w = quantizeToStep16(originalW)
  let h = quantizeToStep16(originalH)
  w = clamp(w, MIN, MAX)
  h = clamp(h, MIN, MAX)
  const adjusted = w !== originalW || h !== originalH
  const notes: string[] = []
  if (adjusted) notes.push(`size_adjusted_for_model: ${originalW}x${originalH} -> ${w}x${h}`)
  return { width: w, height: h, adjusted, notes }
}

export function imageSizeTierFromDimensions(
  width: number,
  height: number,
  model: string,
): '0.5K' | '1K' | '2K' | '4K' {
  const maxSide = Math.max(width, height)
  if (maxSide >= 3072) return '4K'
  if (maxSide >= 1536) return '2K'
  if (maxSide <= 512 && model.includes('flash-lite')) return '0.5K'
  return '1K'
}

export function resolveOpenRouterImageRequest(payload: {
  width: number
  height: number
  model: string
}): {
  width: number
  height: number
  aspectRatio: string
  imageSize: '0.5K' | '1K' | '2K' | '4K'
  pixelSize: string
  adjusted: boolean
} {
  const model = normalizeOpenRouterImageModel(payload.model)
  const rawWidth = Math.round(payload.width)
  const rawHeight = Math.round(payload.height)
  const fitted = usesOpenRouterDedicatedImageApi(model)
    ? fitGptImage2Dimensions(rawWidth, rawHeight)
    : fitOpenRouterDefaultDimensions(rawWidth, rawHeight)
  const width = fitted.width
  const height = fitted.height
  return {
    width,
    height,
    aspectRatio: aspectRatioFromDimensions(width, height),
    imageSize: imageSizeTierFromDimensions(width, height, model),
    pixelSize: `${width}x${height}`,
    adjusted: fitted.adjusted ?? false,
  }
}

function resolveOpenRouterRoot(config: OpenRouterImageConfig): string {
  if (usesServerCloudProxy()) {
    const proxy = (config.proxyBaseUrl || '').trim()
    if (proxy) return `${normalizeBaseUrl(proxy)}/api/openrouter/api/v1`
    return `${normalizeBaseUrl(config.baseUrl || window.location.origin)}/api/openrouter/api/v1`
  }
  return normalizeBaseUrl(config.baseUrl || 'https://openrouter.ai/api/v1')
}

function toDataImageUri(raw: string, mimeHint?: string): string {
  const s = raw.trim()
  if (s.startsWith('data:image/')) return s
  if (s.startsWith('http://') || s.startsWith('https://')) return s
  const mime = (mimeHint || 'image/png').trim() || 'image/png'
  return `data:${mime};base64,${s.replace(/\s+/g, '')}`
}

type OpenRouterImagePart = {
  type?: string
  image_url?: { url?: string }
  imageUrl?: { url?: string }
}

function extractImagesFromCompletion(body: {
  choices?: Array<{
    message?: {
      images?: OpenRouterImagePart[]
      content?: string | Array<{ type?: string; image_url?: { url?: string } }>
    }
  }>
  error?: { message?: string }
}): string[] {
  const message = body.choices?.[0]?.message
  const out: string[] = []
  const images = message?.images
  if (Array.isArray(images)) {
    for (const img of images) {
      const url = (img.image_url?.url || img.imageUrl?.url || '').trim()
      if (url) out.push(url)
    }
  }
  const content = message?.content
  if (Array.isArray(content)) {
    for (const part of content) {
      const url = (part.image_url?.url || '').trim()
      if (url) out.push(url)
    }
  }
  return Array.from(new Set(out))
}

function formatOpenRouterImageResult(payload: {
  imageUrl: string
  model: string
  prompt?: string
  aspectRatio: string
  width: number
  height: number
  elapsedMs?: number
  mode: 'generate' | 'edit'
  sizeAdjustedNote?: string
}): string {
  const lines = [
    payload.mode === 'edit'
      ? 'OpenRouter image edit completed successfully.'
      : 'OpenRouter image generated successfully.',
    `image_url: ${payload.imageUrl}`,
    `model: ${payload.model}`,
    `size: ${payload.width}x${payload.height}`,
    `aspect_ratio: ${payload.aspectRatio}`,
  ]
  if (payload.sizeAdjustedNote) lines.push(payload.sizeAdjustedNote)
  if (payload.prompt?.trim()) {
    lines.push(`prompt: ${payload.prompt.replace(/\s+/g, ' ').trim()}`)
  }
  if (typeof payload.elapsedMs === 'number' && Number.isFinite(payload.elapsedMs)) {
    lines.push(`elapsed_ms: ${Math.max(0, Math.round(payload.elapsedMs))}`)
  }
  return lines.join('\n')
}

type ImagesApiResponse = {
  data?: Array<{ b64_json?: string; url?: string }>
  error?: { message?: string }
}

function imageUrlFromImagesApiItem(item: { b64_json?: string; url?: string }): string {
  const httpUrl = (item.url || '').trim()
  if (httpUrl) return httpUrl
  const b64 = (item.b64_json || '').trim()
  if (!b64) return ''
  if (b64.startsWith('data:image/')) return b64
  return `data:image/png;base64,${b64.replace(/\s+/g, '')}`
}

function extractImagesFromImagesApi(body: ImagesApiResponse): string[] {
  const out: string[] = []
  for (const item of body.data || []) {
    const url = imageUrlFromImagesApiItem(item)
    if (url) out.push(url)
  }
  return Array.from(new Set(out))
}

async function postOpenRouterDedicatedImage(
  config: OpenRouterImageConfig,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<{ imageUrl: string; model: string; elapsedMs: number }> {
  const viaProxy = usesServerCloudProxy()
  const apiKey = (config.apiKey || '').trim()
  if (!viaProxy && !apiKey) {
    throw new Error('OpenRouter API key is missing. Set it in Options → General.')
  }
  const model = normalizeOpenRouterImageModel(config.model || OPENROUTER_IMAGE_MODEL_DEFAULT)
  const root = resolveOpenRouterRoot(config)
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (!viaProxy && apiKey) headers.Authorization = `Bearer ${apiKey}`

  const started = Date.now()
  const res = await fetch(`${root}/images`, {
    method: 'POST',
    headers,
    signal,
    body: JSON.stringify({ ...body, model }),
  })
  const json = (await res.json().catch(() => ({}))) as ImagesApiResponse
  if (!res.ok) {
    const detail = json.error?.message || res.statusText || `HTTP ${res.status}`
    throw new Error(`OpenRouter image ${res.status}: ${detail}`)
  }
  const urls = extractImagesFromImagesApi(json)
  const imageUrl = urls[0]
  if (!imageUrl) {
    throw new Error(
      json.error?.message ||
        'OpenRouter returned no image. Ensure the model supports the dedicated Images API.',
    )
  }
  return { imageUrl, model, elapsedMs: Date.now() - started }
}

async function postOpenRouterImageChat(
  config: OpenRouterImageConfig,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<{ imageUrl: string; model: string; elapsedMs: number }> {
  const viaProxy = usesServerCloudProxy()
  const apiKey = (config.apiKey || '').trim()
  if (!viaProxy && !apiKey) {
    throw new Error('OpenRouter API key is missing. Set it in Options → General.')
  }
  const model = normalizeOpenRouterImageModel(config.model || OPENROUTER_IMAGE_MODEL_DEFAULT)
  const root = resolveOpenRouterRoot(config)
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (!viaProxy && apiKey) headers.Authorization = `Bearer ${apiKey}`

  const started = Date.now()
  const res = await fetch(`${root}/chat/completions`, {
    method: 'POST',
    headers,
    signal,
    body: JSON.stringify({
      ...body,
      model,
      modalities: ['image', 'text'],
      stream: false,
    }),
  })
  const json = (await res.json().catch(() => ({}))) as {
    choices?: Array<{
      message?: {
        images?: OpenRouterImagePart[]
        content?: string | Array<{ type?: string; image_url?: { url?: string } }>
      }
    }>
    error?: { message?: string }
  }
  if (!res.ok) {
    const detail = json.error?.message || res.statusText || `HTTP ${res.status}`
    throw new Error(`OpenRouter image ${res.status}: ${detail}`)
  }
  const urls = extractImagesFromCompletion(json)
  const imageUrl = urls[0]
  if (!imageUrl) {
    throw new Error(
      json.error?.message ||
        'OpenRouter returned no image. Ensure the model supports image output and modalities include image.',
    )
  }
  return { imageUrl, model, elapsedMs: Date.now() - started }
}

export async function invokeOpenRouterGenerateImage(
  req: { prompt: string },
  config: OpenRouterImageConfig,
  signal?: AbortSignal,
): Promise<string> {
  const prompt = (req.prompt || '').trim()
  if (!prompt) throw new Error('OpenRouter generate_image requires a non-empty prompt.')
  const model = normalizeOpenRouterImageModel(config.model || OPENROUTER_IMAGE_MODEL_DEFAULT)
  const quality = config.gptQuality || 'auto'
  const dims = resolveOpenRouterImageRequest({
    width: config.width,
    height: config.height,
    model,
  })
  const sizeAdjustedNote = dims.adjusted
    ? `size_adjusted_for_model: ${Math.round(config.width)}x${Math.round(config.height)} -> ${dims.width}x${dims.height}`
    : undefined

  const { imageUrl, elapsedMs } = usesOpenRouterDedicatedImageApi(model)
    ? await postOpenRouterDedicatedImage(
        config,
        {
          prompt,
          quality,
          size: dims.pixelSize,
        },
        signal,
      )
    : await postOpenRouterImageChat(
        config,
        {
          messages: [{ role: 'user', content: prompt }],
          image_config: {
            aspect_ratio: dims.aspectRatio,
            image_size: dims.imageSize,
          },
        },
        signal,
      )

  return formatOpenRouterImageResult({
    imageUrl,
    model,
    prompt,
    aspectRatio: dims.aspectRatio,
    width: dims.width,
    height: dims.height,
    elapsedMs,
    mode: 'generate',
    sizeAdjustedNote,
  })
}

export async function invokeOpenRouterEditImage(
  req: { prompt: string; referenceImages: string[] },
  config: OpenRouterImageConfig,
  signal?: AbortSignal,
): Promise<string> {
  const prompt = (req.prompt || '').trim()
  if (!prompt) throw new Error('OpenRouter edit_image_runware requires a non-empty prompt.')
  const refs = (req.referenceImages || []).map((x) => toDataImageUri(x)).filter(Boolean)
  if (!refs.length) {
    throw new Error('OpenRouter image edit requires at least one reference image.')
  }
  const model = normalizeOpenRouterImageModel(config.model || OPENROUTER_IMAGE_MODEL_DEFAULT)
  const quality = config.gptQuality || 'auto'
  const dims = resolveOpenRouterImageRequest({
    width: config.width,
    height: config.height,
    model,
  })
  const sizeAdjustedNote = dims.adjusted
    ? `size_adjusted_for_model: ${Math.round(config.width)}x${Math.round(config.height)} -> ${dims.width}x${dims.height}`
    : undefined
  const content: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
    { type: 'text', text: prompt },
    ...refs.slice(0, 8).map((url) => ({ type: 'image_url', image_url: { url } })),
  ]

  const { imageUrl, elapsedMs } = usesOpenRouterDedicatedImageApi(model)
    ? await postOpenRouterDedicatedImage(
        config,
        {
          prompt,
          quality,
          size: dims.pixelSize,
          input_references: refs.slice(0, 16).map((url) => ({
            type: 'image_url',
            image_url: { url },
          })),
        },
        signal,
      )
    : await postOpenRouterImageChat(
        config,
        {
          messages: [{ role: 'user', content }],
          image_config: {
            aspect_ratio: dims.aspectRatio,
            image_size: dims.imageSize,
          },
        },
        signal,
      )

  return formatOpenRouterImageResult({
    imageUrl,
    model,
    prompt,
    aspectRatio: dims.aspectRatio,
    width: dims.width,
    height: dims.height,
    elapsedMs,
    mode: 'edit',
    sizeAdjustedNote,
  })
}

/** Strip bulky data: URLs from tool results before they enter the LLM context. */
export function sanitizeImageToolResultForLlm(name: string, result: string): string {
  if (name !== 'generate_image' && name !== 'edit_image_runware') return result
  return result
    .replace(/^\s*image_url:\s*data:image\/[^\n]*$/gim, 'image_url: [inline image shown in chat UI]')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function isOpenRouterImageProvider(provider: ImageProvider | undefined): boolean {
  return provider === 'openrouter'
}
