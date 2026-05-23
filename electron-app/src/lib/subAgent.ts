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

import { normalizeBaseUrl } from './settings'
import type { SubAgentConfig } from './settings'
import { usesServerCloudProxy } from './platform'

// ── provider auto-detection ──────────────────────────────────────────────

/** Ollama models use `:` (e.g. llava:13b, qwen2.5:7b). Everything else → OpenRouter. */
function detectProvider(model: string): 'ollama' | 'openrouter' {
  if (!model) return 'ollama'
  // Ollama tags always have `:version` — OpenRouter/NVIDIA use `/` or plain names
  if (model.includes(':') && !model.includes('/')) return 'ollama'
  return 'openrouter'
}

// ── types ────────────────────────────────────────────────────────────────

export type SubAgentKeys = {
  ollamaBaseUrl: string
  openrouterBaseUrl: string
  openrouterApiKey: string
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

function buildPrompt(userQuery: string | undefined): string {
  const q = (userQuery || '').trim()
  if (!q) return DEFAULT_DESCRIBE_PROMPT
  return `${DEFAULT_DESCRIBE_PROMPT}\n\nThe user asked: "${q}"\nTailor your description to answer the user's question.`
}

// ── Ollama path ──────────────────────────────────────────────────────────

async function describeWithOllama(
  img: SubAgentImageInput,
  model: string,
  maxTokens: number,
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

// ── single-image describe ────────────────────────────────────────────────

async function describeSingleImage(
  img: SubAgentImageInput,
  config: SubAgentConfig,
  keys: SubAgentKeys,
  userQuery: string | undefined,
  signal?: AbortSignal,
): Promise<string> {
  const provider = detectProvider(config.model)
  const prompt = buildPrompt(userQuery)
  const maxTokens = config.maxTokensPerImage ?? 300

  if (provider === 'openrouter') {
    return describeWithOpenRouter(
      img, config.model, maxTokens,
      keys.openrouterBaseUrl, keys.openrouterApiKey,
      prompt, signal,
    )
  }
  return describeWithOllama(
    img, config.model, maxTokens,
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
): Promise<SubAgentDescribeResult[]> {
  const results: SubAgentDescribeResult[] = []

  for (const img of images) {
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
      const description = await describeSingleImage(img, config, keys, userQuery, signal)
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
