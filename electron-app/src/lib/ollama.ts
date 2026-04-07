import { normalizeBaseUrl } from './settings'

export type ChatMessage = { role: 'user' | 'assistant' | 'system'; content: string }

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

export type StreamOllamaChatParams = {
  baseUrl: string
  model: string
  messages: ChatMessage[]
  signal?: AbortSignal
  onDelta: (fullText: string) => void
  /** Sent as request `options` (temperature, num_ctx, …). */
  modelOptions?: OllamaModelOptions
  /**
   * Future: Ollama tools (e.g. function calling). When set, included in the
   * body with messages/stream.
   */
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

/**
 * Stream Ollama chat completion; calls onDelta with accumulated assistant text.
 */
export async function streamOllamaChat(
  options: StreamOllamaChatParams,
): Promise<string> {
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
      const last = JSON.parse(tail) as { message?: { content?: string }; error?: string }
      if (last.error) throw new Error(last.error)
      const piece = last.message?.content
      if (piece) {
        full += piece
        options.onDelta(full)
      }
    } catch {
      /* ignore trailing parse noise */
    }
  }
  return full
}
