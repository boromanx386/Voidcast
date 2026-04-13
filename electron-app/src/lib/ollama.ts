import { normalizeBaseUrl } from './settings'

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
  | { role: 'user'; content: string }
  | {
      role: 'assistant'
      content: string
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

export async function fetchOllamaModels(baseUrl: string): Promise<string[]> {
  const root = normalizeBaseUrl(baseUrl)
  const res = await fetch(`${root}/api/tags`)
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
): Promise<{ content: string; usage?: OllamaChatUsage }> {
  const root = normalizeBaseUrl(options.baseUrl)
  const opts = compactModelOptions(options.modelOptions)
  const body: Record<string, unknown> = {
    model: options.model,
    messages: options.messages,
    stream: true,
  }
  if (opts) body.options = opts
  if (options.tools !== undefined) body.tools = options.tools

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
  let full = ''
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
        message?: { content?: string }
        error?: string
      }
      if (chunk.error) throw new Error(chunk.error)
      usage = mergeOllamaUsage(usage, parseChatStreamUsage(obj))
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
        message?: { content?: string }
        error?: string
      }
      if (last.error) throw new Error(last.error)
      usage = mergeOllamaUsage(usage, parseChatStreamUsage(last))
      const piece = last.message?.content
      if (piece) {
        full += piece
        options.onDelta(full)
      }
    } catch {
      /* ignore trailing parse noise */
    }
  }
  return { content: full, usage }
}
