import { normalizeBaseUrl, type LlmThinkLevel } from './settings'

export function toOllamaThinkBodyValue(level: LlmThinkLevel): boolean | string {
  if (level === 'off') return false
  if (level === 'on') return true
  return level
}

export function isThinkingUiEnabled(level: LlmThinkLevel): boolean {
  return level !== 'off'
}

/** Tool call fragment from Ollama stream (merged across chunks) */
export type OllamaToolCall = {
  id?: string
  type?: string
  index?: number
  function?: {
    name?: string
    /** Stream may send string fragments or a full object (never use String(object)). */
    arguments?: string | Record<string, unknown>
  }
}

/** Messages for Ollama /api/chat (includes tool turns) */
export type OllamaApiMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string; images?: string[] }
  | {
      role: 'assistant'
      content: string
      /** Ollama replay: include prior thinking trace when `think` was used */
      thinking?: string
      tool_calls?: OllamaToolCall[]
    }
  | { role: 'tool'; content: string; tool_name: string }

/** @deprecated use OllamaApiMessage — kept for imports expecting short name */
export type ChatMessage = OllamaApiMessage

/** Ollama List models — GET /api/tags (https://docs.ollama.com/api/tags) */
export type OllamaModelTag = {
  name: string
  model?: string
  size?: number
  modified_at?: string
}

/** HTTP statuses we consider transient (worth retrying once or twice). */
const OLLAMA_RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504])
const OLLAMA_MAX_RETRIES = 4

function parseRetryAfterSeconds(value: string | null | undefined): number | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const asNumber = Number(trimmed)
  if (Number.isFinite(asNumber) && asNumber >= 0) return asNumber
  const asDate = Date.parse(trimmed)
  if (!Number.isFinite(asDate)) return undefined
  const diffMs = asDate - Date.now()
  return diffMs > 0 ? diffMs / 1000 : 0
}

function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    if (signal) {
      if (signal.aborted) {
        clearTimeout(timer)
        reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }))
        return
      }
      signal.addEventListener('abort', onAbort, { once: true })
    }
  })
}

/**
 * Fetch with retry for transient Ollama failures (503 overloaded, 429, 502, 504).
 * Honors `Retry-After` header when present, otherwise uses exponential backoff
 * with small jitter. Returns the final Response (caller checks `res.ok`).
 *
 * Exported so the agent tool loop (`streamOllamaChatOnce`) and other paths can
 * reuse the same retry policy across rounds — a 503 in round 1, round 2 after
 * a tool call, etc. all benefit from the same backoff.
 */
export async function fetchOllamaWithRetry(
  url: string,
  init: RequestInit,
  signal?: AbortSignal,
): Promise<Response> {
  let lastErr: unknown
  for (let attempt = 0; attempt < OLLAMA_MAX_RETRIES; attempt += 1) {
    if (signal?.aborted) {
      throw Object.assign(new Error('Aborted'), { name: 'AbortError' })
    }
    try {
      const res = await fetch(url, init)
      if (res.ok || !OLLAMA_RETRYABLE_STATUS.has(res.status)) return res
      if (attempt >= OLLAMA_MAX_RETRIES - 1) return res
      const retryAfter = parseRetryAfterSeconds(res.headers.get('retry-after'))
      const backoffSec = retryAfter ?? 2 ** attempt
      const jitterMs = Math.floor(Math.random() * 250)
      await res.body?.cancel().catch(() => undefined)
      await sleepWithAbort(backoffSec * 1000 + jitterMs, signal)
      continue
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') throw e
      lastErr = e
      if (attempt >= OLLAMA_MAX_RETRIES - 1) throw e
      const backoffSec = 2 ** attempt
      const jitterMs = Math.floor(Math.random() * 250)
      await sleepWithAbort(backoffSec * 1000 + jitterMs, signal)
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error('Ollama request failed after retries')
}

export async function fetchOllamaModels(baseUrl: string): Promise<string[]> {
  const root = normalizeBaseUrl(baseUrl)
  const res = await fetchOllamaWithRetry(`${root}/api/tags`, {})
  if (!res.ok) {
    const errBody = await res.text().catch(() => '')
    throw new Error(
      `Ollama GET /api/tags ${res.status}: ${errBody || res.statusText}`,
    )
  }
  const data = (await res.json()) as { models?: OllamaModelTag[] }
  const names = (data.models ?? [])
    .map((m) => (m.name ?? m.model ?? '').trim())
    .filter(Boolean)
  return [...new Set(names)].sort((a, b) => a.localeCompare(b))
}

/** Fields for Ollama `options` in /api/chat (extend as needed). */
export type OllamaModelOptions = {
  temperature?: number
  num_ctx?: number
}

/** Usage counters from Ollama chat response chunks/final object. */
export type OllamaChatUsage = {
  prompt_eval_count?: number
  eval_count?: number
  total_duration?: number
  load_duration?: number
  prompt_eval_duration?: number
  eval_duration?: number
}

export type StreamOllamaChatParams = {
  baseUrl: string
  model: string
  messages: OllamaApiMessage[]
  signal?: AbortSignal
  onDelta: (fullText: string) => void
  /** Ollama `think` body value; always sent so models that default to thinking can be turned off. */
  thinkLevel?: LlmThinkLevel
  /** Accumulated thinking text for the current assistant message. */
  onThinkingDelta?: (fullThinking: string) => void
  /** Sent as request `options` (temperature, num_ctx, …). */
  modelOptions?: OllamaModelOptions
  tools?: unknown
}

function compactModelOptions(
  o: OllamaModelOptions | undefined,
): Record<string, number> | undefined {
  if (!o) return undefined
  const out: Record<string, number> = {}
  if (o.temperature !== undefined) out.temperature = o.temperature
  if (o.num_ctx !== undefined) out.num_ctx = o.num_ctx
  return Object.keys(out).length ? out : undefined
}

function pickUsageNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

/**
 * Extract usage counters from one Ollama chunk/object.
 * Usage fields usually arrive on the final chunk (`done: true`), but we
 * tolerate any chunk carrying counters.
 */
export function parseChatStreamUsage(obj: unknown): OllamaChatUsage | undefined {
  if (!obj || typeof obj !== 'object') return undefined
  const o = obj as Record<string, unknown>
  const usage: OllamaChatUsage = {
    prompt_eval_count: pickUsageNumber(o.prompt_eval_count),
    eval_count: pickUsageNumber(o.eval_count),
    total_duration: pickUsageNumber(o.total_duration),
    load_duration: pickUsageNumber(o.load_duration),
    prompt_eval_duration: pickUsageNumber(o.prompt_eval_duration),
    eval_duration: pickUsageNumber(o.eval_duration),
  }
  return Object.values(usage).some((v) => v !== undefined) ? usage : undefined
}

function choosePreferredNumber(
  prev: number | undefined,
  next: number | undefined,
): number | undefined {
  if (next === undefined) return prev
  if (prev === undefined) return next
  // Preserve existing positive values; some servers emit 0 from cache paths.
  if (next === 0 && prev > 0) return prev
  return next
}

/** Merge usage objects while preserving known-good counters. */
export function mergeOllamaUsage(
  prev: OllamaChatUsage | undefined,
  next: OllamaChatUsage | undefined,
): OllamaChatUsage | undefined {
  if (!prev) return next
  if (!next) return prev
  return {
    prompt_eval_count: choosePreferredNumber(
      prev.prompt_eval_count,
      next.prompt_eval_count,
    ),
    eval_count: choosePreferredNumber(prev.eval_count, next.eval_count),
    total_duration: choosePreferredNumber(prev.total_duration, next.total_duration),
    load_duration: choosePreferredNumber(prev.load_duration, next.load_duration),
    prompt_eval_duration: choosePreferredNumber(
      prev.prompt_eval_duration,
      next.prompt_eval_duration,
    ),
    eval_duration: choosePreferredNumber(prev.eval_duration, next.eval_duration),
  }
}

/**
 * Stream Ollama chat completion; calls onDelta with accumulated assistant text.
 */
export async function streamOllamaChat(
  options: StreamOllamaChatParams,
): Promise<{ content: string; thinking: string; usage?: OllamaChatUsage }> {
  const root = normalizeBaseUrl(options.baseUrl)
  const opts = compactModelOptions(options.modelOptions)
  const body: Record<string, unknown> = {
    model: options.model,
    messages: options.messages,
    stream: true,
  }
  if (opts) body.options = opts
  if (options.tools !== undefined) body.tools = options.tools
  body.think = toOllamaThinkBodyValue(options.thinkLevel ?? 'off')

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
  let full = ''
  let fullThinking = ''
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
        message?: { content?: string; thinking?: string }
        error?: string
      }
      if (chunk.error) throw new Error(chunk.error)
      usage = mergeOllamaUsage(usage, parseChatStreamUsage(obj))
      const thinkPiece = chunk.message?.thinking
      if (thinkPiece && isThinkingUiEnabled(options.thinkLevel ?? 'off')) {
        fullThinking += thinkPiece
        options.onThinkingDelta?.(fullThinking)
      }
      const piece = chunk.message?.content
      if (piece) {
        full += piece
        options.onDelta(full)
      }
    }
  }
  const tail = buffer.trim()
  if (tail) {
    try {
      const last = JSON.parse(tail) as {
        message?: { content?: string; thinking?: string }
        error?: string
      }
      if (last.error) throw new Error(last.error)
      usage = mergeOllamaUsage(usage, parseChatStreamUsage(last))
      const thinkPiece = last.message?.thinking
      if (thinkPiece && isThinkingUiEnabled(options.thinkLevel ?? 'off')) {
        fullThinking += thinkPiece
        options.onThinkingDelta?.(fullThinking)
      }
      const piece = last.message?.content
      if (piece) {
        full += piece
        options.onDelta(full)
      }
    } catch {
      /* ignore trailing parse noise */
    }
  }
  return { content: full, thinking: fullThinking, usage }
}
