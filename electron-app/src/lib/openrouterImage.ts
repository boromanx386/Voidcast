import {
  normalizeBaseUrl,
  normalizeOpenRouterImageModel,
  OPENROUTER_IMAGE_MODEL_DEFAULT,
  type ImageProvider,
} from '@/lib/settings'
import { usesServerCloudProxy } from '@/lib/platform'

export type OpenRouterImageConfig = {
  apiKey: string
  baseUrl: string
  model: string
  width: number
  height: number
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
  if (payload.prompt?.trim()) {
    lines.push(`prompt: ${payload.prompt.replace(/\s+/g, ' ').trim()}`)
  }
  if (typeof payload.elapsedMs === 'number' && Number.isFinite(payload.elapsedMs)) {
    lines.push(`elapsed_ms: ${Math.max(0, Math.round(payload.elapsedMs))}`)
  }
  return lines.join('\n')
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
  const aspectRatio = aspectRatioFromDimensions(config.width, config.height)
  const { imageUrl, model, elapsedMs } = await postOpenRouterImageChat(
    config,
    {
      messages: [{ role: 'user', content: prompt }],
      image_config: {
        aspect_ratio: aspectRatio,
        image_size: '1K',
      },
    },
    signal,
  )
  return formatOpenRouterImageResult({
    imageUrl,
    model,
    prompt,
    aspectRatio,
    width: config.width,
    height: config.height,
    elapsedMs,
    mode: 'generate',
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
  const aspectRatio = aspectRatioFromDimensions(config.width, config.height)
  const content: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
    { type: 'text', text: prompt },
    ...refs.slice(0, 8).map((url) => ({ type: 'image_url', image_url: { url } })),
  ]
  const { imageUrl, model, elapsedMs } = await postOpenRouterImageChat(
    config,
    {
      messages: [{ role: 'user', content }],
      image_config: {
        aspect_ratio: aspectRatio,
        image_size: '1K',
      },
    },
    signal,
  )
  return formatOpenRouterImageResult({
    imageUrl,
    model,
    prompt,
    aspectRatio,
    width: config.width,
    height: config.height,
    elapsedMs,
    mode: 'edit',
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
