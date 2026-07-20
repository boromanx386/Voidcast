/**
 * Sub-Agent — inline task delegation for the main agent loop.
 *
 * When the main agent calls a tool that requires capabilities the primary
 * model lacks (e.g. vision for image_recall), this module delegates the
 * work to a separate user-configured model. The main agent receives only
 * text results — never raw binary payloads it can't process.
 *
 * Predlog 1 (Inline): called synchronously inside executeToolCall before the
 * tool result is returned to the main agent loop.
 */

import { normalizeBaseUrl, SUB_AGENT_DEFAULT_CONTEXT_TOKENS } from './settings'
import type { SubAgentConfig } from './settings'
import { deepseekApiBaseForRuntime, usesServerCloudProxy } from './platform'
import {
  detectSubAgentProvider as detectSubAgentProviderId,
  type SubAgentProviderId,
} from '@/lib/cloudLlmPresets'
import {
  lookupVisionCacheDescription,
  normalizeVisionFocus,
  type ImageVisionCache,
} from '@/lib/imageVisionCache'

export { detectSubAgentProviderId as detectSubAgentProvider }
export type { SubAgentProviderId }

// ── provider auto-detection ──────────────────────────────────────────────

export type SubAgentUiCallbacks = {
  onStart?: (imageCount: number) => void
  onProgress?: (current: number, total: number) => void
  onDone?: (formatted: string) => void
  /** Coding compress/explore status line (opens the floating panel). */
  onCodingStart?: (label: string) => void
  onCodingDone?: (formatted: string) => void
}

// ── types ────────────────────────────────────────────────────────────────

export type SubAgentKeys = {
  ollamaBaseUrl: string
  openrouterBaseUrl: string
  openrouterApiKey: string
  deepseekBaseUrl: string
  deepseekApiKey: string
}

export type SubAgentImageInput = {
  base64: string
  mime: string
  path?: string
  index: number
}

export type SubAgentDescribeResult = {
  index: number
  path?: string
  description: string
  error?: string
}

// ── helpers ──────────────────────────────────────────────────────────────

function errorMessage(e: unknown): string {
  if (e instanceof Error && e.message.trim()) return e.message.trim()
  return String(e)
}

function toDataUri(base64: string, mime: string): string {
  const safeMime = /^image\/[a-z0-9.+-]+$/i.test(mime) ? mime : 'image/png'
  return `data:${safeMime};base64,${base64.replace(/\s+/g, '')}`
}

const DEFAULT_DESCRIBE_PROMPT =
  'Describe this image concisely for a non-vision AI assistant. Include: what it shows, key text/numbers visible, colors, layout, and any notable details. Do not add meta-commentary.'

export function buildPrompt(userQuery: string | undefined, focus?: string): string {
  const f = normalizeVisionFocus(focus)
  const q = (userQuery || '').trim()
  if (f) {
    const userLine = q ? `\n\nOriginal user message: "${q}"` : ''
    return `${DEFAULT_DESCRIBE_PROMPT}\n\nThe assistant needs from this image: "${f}"${userLine}\nTailor your description to what the assistant needs.`
  }
  if (q) return `${DEFAULT_DESCRIBE_PROMPT}\n\nThe user asked: "${q}"\nTailor your description to answer the user's question.`
  return DEFAULT_DESCRIBE_PROMPT
}

// ── Ollama path ──────────────────────────────────────────────────────────

async function describeWithOllama(
  img: SubAgentImageInput,
  model: string,
  maxTokens: number,
  contextTokens: number,
  ollamaBaseUrl: string,
  prompt: string,
  signal?: AbortSignal,
): Promise<string> {
  const baseUrl = normalizeBaseUrl(ollamaBaseUrl || 'http://localhost:11434')
  // Ollama expects raw base64, NOT data URI
  const rawBase64 = img.base64.replace(/\s+/g, '')

  const body = {
    model,
    messages: [
      {
        role: 'user',
        content: prompt,
        images: [rawBase64],
      },
    ],
    stream: false,
    options: {
      temperature: 0.2,
      num_predict: maxTokens,
      num_ctx: contextTokens,
    },
  }

  const res = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`Ollama sub-agent ${res.status}: ${errText || res.statusText}`)
  }

  const data = (await res.json()) as { message?: { content?: string } }
  return (data.message?.content || '').trim()
}

// ── OpenRouter path ──────────────────────────────────────────────────────

async function describeWithOpenRouter(
  img: SubAgentImageInput,
  model: string,
  maxTokens: number,
  openrouterBaseUrl: string,
  openrouterApiKey: string,
  prompt: string,
  signal?: AbortSignal,
): Promise<string> {
  const viaProxy = usesServerCloudProxy()
  const baseUrl = viaProxy
    ? `${normalizeBaseUrl(openrouterBaseUrl || window.location.origin)}/api/openrouter/api/v1`
    : normalizeBaseUrl(openrouterBaseUrl || 'https://openrouter.ai/api/v1')

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (!viaProxy && openrouterApiKey.trim()) {
    headers.Authorization = `Bearer ${openrouterApiKey.trim()}`
  }

  const dataUri = toDataUri(img.base64, img.mime)

  const body = {
    model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: dataUri } },
        ],
      },
    ],
    max_tokens: maxTokens,
    temperature: 0.2,
    stream: false,
  }

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    signal,
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`OpenRouter sub-agent ${res.status}: ${errText || res.statusText}`)
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  return (data.choices?.[0]?.message?.content || '').trim()
}

// ── DeepSeek path (text-only; vision not supported on direct API) ────────

async function describeWithDeepSeek(
  img: SubAgentImageInput,
  model: string,
  maxTokens: number,
  deepseekBaseUrl: string,
  deepseekApiKey: string,
  prompt: string,
  signal?: AbortSignal,
): Promise<string> {
  const viaProxy = usesServerCloudProxy()
  const baseUrl = viaProxy
    ? deepseekApiBaseForRuntime()
    : normalizeBaseUrl(deepseekBaseUrl || 'https://api.deepseek.com')

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (!viaProxy && deepseekApiKey.trim()) {
    headers.Authorization = `Bearer ${deepseekApiKey.trim()}`
  }

  const dataUri = toDataUri(img.base64, img.mime)

  const body = {
    model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: dataUri } },
        ],
      },
    ],
    max_tokens: maxTokens,
    temperature: 0.2,
    stream: false,
    thinking: { type: 'disabled' },
  }

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    signal,
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`DeepSeek sub-agent ${res.status}: ${errText || res.statusText}`)
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  return (data.choices?.[0]?.message?.content || '').trim()
}

// ── text-only chat (coding compress / explore) ───────────────────────────

async function textWithOllama(
  model: string,
  maxTokens: number,
  contextTokens: number,
  ollamaBaseUrl: string,
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  signal?: AbortSignal,
): Promise<string> {
  const baseUrl = normalizeBaseUrl(ollamaBaseUrl || 'http://localhost:11434')
  const res = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      options: {
        temperature: 0.2,
        num_predict: maxTokens,
        num_ctx: contextTokens,
      },
    }),
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`Ollama sub-agent ${res.status}: ${errText || res.statusText}`)
  }
  const data = (await res.json()) as { message?: { content?: string } }
  return (data.message?.content || '').trim()
}

async function textWithOpenAiCompatible(
  label: string,
  model: string,
  maxTokens: number,
  baseUrl: string,
  apiKey: string,
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  signal?: AbortSignal,
  extraBody?: Record<string, unknown>,
): Promise<string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (apiKey.trim()) {
    headers.Authorization = `Bearer ${apiKey.trim()}`
  }
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    signal,
    body: JSON.stringify({
      model,
      messages,
      max_tokens: maxTokens,
      temperature: 0.2,
      stream: false,
      ...extraBody,
    }),
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`${label} sub-agent ${res.status}: ${errText || res.statusText}`)
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  return (data.choices?.[0]?.message?.content || '').trim()
}

/**
 * Text-only sub-agent completion (no images). Used by coding compress / explore.
 */
export async function callSubAgentText(opts: {
  prompt: string
  system?: string
  config: SubAgentConfig
  keys: SubAgentKeys
  signal?: AbortSignal
  maxTokens?: number
}): Promise<string> {
  const provider = detectSubAgentProviderId(opts.config.model, opts.config.provider)
  const maxTokens = opts.maxTokens ?? opts.config.outputTokens ?? 1024
  const ctxTokens = opts.config.contextTokens ?? SUB_AGENT_DEFAULT_CONTEXT_TOKENS
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = []
  if (opts.system?.trim()) {
    messages.push({ role: 'system', content: opts.system.trim() })
  }
  messages.push({ role: 'user', content: opts.prompt })

  if (provider === 'openrouter') {
    const viaProxy = usesServerCloudProxy()
    const baseUrl = viaProxy
      ? `${normalizeBaseUrl(opts.keys.openrouterBaseUrl || window.location.origin)}/api/openrouter/api/v1`
      : normalizeBaseUrl(opts.keys.openrouterBaseUrl || 'https://openrouter.ai/api/v1')
    return textWithOpenAiCompatible(
      'OpenRouter',
      opts.config.model,
      maxTokens,
      baseUrl,
      viaProxy ? '' : opts.keys.openrouterApiKey,
      messages,
      opts.signal,
    )
  }
  if (provider === 'deepseek') {
    const viaProxy = usesServerCloudProxy()
    const baseUrl = viaProxy
      ? deepseekApiBaseForRuntime()
      : normalizeBaseUrl(opts.keys.deepseekBaseUrl || 'https://api.deepseek.com')
    return textWithOpenAiCompatible(
      'DeepSeek',
      opts.config.model,
      maxTokens,
      baseUrl,
      viaProxy ? '' : opts.keys.deepseekApiKey,
      messages,
      opts.signal,
      { thinking: { type: 'disabled' } },
    )
  }
  return textWithOllama(
    opts.config.model,
    maxTokens,
    ctxTokens,
    opts.keys.ollamaBaseUrl,
    messages,
    opts.signal,
  )
}

/**
 * Multi-turn text chat for nested coding explore (system + alternating messages).
 */
export async function callSubAgentChat(opts: {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  config: SubAgentConfig
  keys: SubAgentKeys
  signal?: AbortSignal
  maxTokens?: number
}): Promise<string> {
  const provider = detectSubAgentProviderId(opts.config.model, opts.config.provider)
  const maxTokens = opts.maxTokens ?? opts.config.outputTokens ?? 1024
  const ctxTokens = opts.config.contextTokens ?? SUB_AGENT_DEFAULT_CONTEXT_TOKENS
  const messages = opts.messages.filter((m) => m.content.trim())

  if (provider === 'openrouter') {
    const viaProxy = usesServerCloudProxy()
    const baseUrl = viaProxy
      ? `${normalizeBaseUrl(opts.keys.openrouterBaseUrl || window.location.origin)}/api/openrouter/api/v1`
      : normalizeBaseUrl(opts.keys.openrouterBaseUrl || 'https://openrouter.ai/api/v1')
    return textWithOpenAiCompatible(
      'OpenRouter',
      opts.config.model,
      maxTokens,
      baseUrl,
      viaProxy ? '' : opts.keys.openrouterApiKey,
      messages,
      opts.signal,
    )
  }
  if (provider === 'deepseek') {
    const viaProxy = usesServerCloudProxy()
    const baseUrl = viaProxy
      ? deepseekApiBaseForRuntime()
      : normalizeBaseUrl(opts.keys.deepseekBaseUrl || 'https://api.deepseek.com')
    return textWithOpenAiCompatible(
      'DeepSeek',
      opts.config.model,
      maxTokens,
      baseUrl,
      viaProxy ? '' : opts.keys.deepseekApiKey,
      messages,
      opts.signal,
      { thinking: { type: 'disabled' } },
    )
  }
  return textWithOllama(
    opts.config.model,
    maxTokens,
    ctxTokens,
    opts.keys.ollamaBaseUrl,
    messages,
    opts.signal,
  )
}

// ── single-image describe ────────────────────────────────────────────────

async function describeSingleImage(
  img: SubAgentImageInput,
  config: SubAgentConfig,
  keys: SubAgentKeys,
  userQuery: string | undefined,
  focus: string | undefined,
  signal?: AbortSignal,
): Promise<string> {
  const provider = detectSubAgentProviderId(config.model, config.provider)
  const prompt = buildPrompt(userQuery, focus)
  const maxTokens = config.outputTokens ?? 1024

  const ctxTokens = config.contextTokens ?? SUB_AGENT_DEFAULT_CONTEXT_TOKENS

  if (provider === 'openrouter') {
    return describeWithOpenRouter(
      img, config.model, maxTokens,
      keys.openrouterBaseUrl, keys.openrouterApiKey,
      prompt, signal,
    )
  }
  if (provider === 'deepseek') {
    return describeWithDeepSeek(
      img, config.model, maxTokens,
      keys.deepseekBaseUrl, keys.deepseekApiKey,
      prompt, signal,
    )
  }
  return describeWithOllama(
    img, config.model, maxTokens, ctxTokens,
    keys.ollamaBaseUrl,
    prompt, signal,
  )
}

// ── public API ───────────────────────────────────────────────────────────

/**
 * Describe multiple images using the configured sub-agent.
 * Images are processed sequentially to avoid overwhelming local models.
 */
export async function describeImagesWithSubAgent(
  images: SubAgentImageInput[],
  config: SubAgentConfig,
  keys: SubAgentKeys,
  userQuery: string | undefined,
  signal?: AbortSignal,
  ui?: SubAgentUiCallbacks,
  visionCache?: ImageVisionCache,
  focus?: string,
): Promise<SubAgentDescribeResult[]> {
  const cache = visionCache ?? {}
  const results: SubAgentDescribeResult[] = []
  const pendingCount = images.filter(
    (img) => !lookupVisionCacheDescription(img, cache, focus),
  ).length
  if (pendingCount > 0) ui?.onStart?.(pendingCount)

  let pendingDone = 0
  for (let i = 0; i < images.length; i++) {
    const img = images[i]!
    const cached = lookupVisionCacheDescription(img, cache, focus)
    if (cached) {
      results.push({
        index: img.index,
        path: img.path,
        description: cached,
      })
      continue
    }

    pendingDone++
    ui?.onProgress?.(pendingDone, pendingCount)
    if (signal?.aborted) {
      results.push({
        index: img.index,
        path: img.path,
        description: '',
        error: 'Aborted',
      })
      continue
    }
    try {
      const description = await describeSingleImage(
        img,
        config,
        keys,
        userQuery,
        focus,
        signal,
      )
      results.push({
        index: img.index,
        path: img.path,
        description: description || '[No description returned]',
      })
    } catch (e) {
      results.push({
        index: img.index,
        path: img.path,
        description: '',
        error: errorMessage(e),
      })
    }
  }

  if (images.length > 0) ui?.onDone?.(formatSubAgentResultsForAgent(results))
  return results
}

/**
 * Format sub-agent descriptions into a compact text block for the main agent.
 */
export function formatSubAgentResultsForAgent(
  results: SubAgentDescribeResult[],
): string {
  if (!results.length) return ''

  const lines: string[] = ['[Sub-agent analysis]', '']
  for (const r of results) {
    const label = r.path
      ? `Image ${r.index} (${r.path})`
      : `Image ${r.index}`
    if (r.error) {
      lines.push(`**${label}**: [Error: ${r.error}]`)
    } else {
      lines.push(`**${label}**: ${r.description}`)
    }
    lines.push('')
  }
  return lines.join('\n').trim()
}
