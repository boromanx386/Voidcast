import type { OllamaApiMessage, OllamaChatUsage, OllamaModelOptions, OllamaToolCall } from './ollama'
import { normalizeBaseUrl } from './settings'

export type OpenRouterContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

export type OpenRouterMessage =
  | { role: 'system' | 'assistant'; content: string }
  | { role: 'user'; content: string | OpenRouterContentPart[] }
  | { role: 'assistant'; content: string | null; tool_calls?: OpenRouterToolCall[] }
  | { role: 'tool'; content: string; tool_call_id: string; name?: string }

export type OpenRouterToolCall = {
  id: string
  type: 'function'
  index?: number
  function: {
    name: string
    arguments: string
  }
}

export type OpenRouterUsage = {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
}

export type StreamOpenRouterChatParams = {
  baseUrl: string
  apiKey: string
  model: string
  messages: OpenRouterMessage[]
  signal?: AbortSignal
  onDelta: (fullText: string) => void
  modelOptions?: OllamaModelOptions
  tools?: unknown
}

const RETRYABLE_STATUS = new Set([429, 503])
const MAX_RETRIES_PER_MODEL = 3
const FALLBACK_MODEL = 'openrouter/free'

function compactOpenRouterOptions(
  o: OllamaModelOptions | undefined,
): Record<string, number> | undefined {
  if (!o) return undefined
  const out: Record<string, number> = {}
  if (o.temperature !== undefined) out.temperature = o.temperature
  if (Object.keys(out).length === 0) return undefined
  return out
}

function mergeToolCallDeltas(
  acc: OpenRouterToolCall[],
  incoming: OpenRouterToolCall[] | undefined,
): void {
  if (!incoming?.length) return
  for (const delta of incoming) {
    const idx = typeof delta.index === 'number' ? delta.index : Math.max(0, acc.length - 1)
    while (acc.length <= idx) {
      acc.push({
        id: '',
        type: 'function',
        index: acc.length,
        function: { name: '', arguments: '' },
      })
    }
    const cur = acc[idx]
    if (delta.id) cur.id = delta.id
    cur.type = 'function'
    if (typeof delta.index === 'number') cur.index = delta.index
    if (delta.function?.name) cur.function.name = delta.function.name
    if (delta.function?.arguments != null) {
      cur.function.arguments =
        (typeof cur.function.arguments === 'string' ? cur.function.arguments : '') +
        String(delta.function.arguments)
    }
  }
}

export function mapOpenRouterUsageToOllama(usage: OpenRouterUsage | undefined): OllamaChatUsage | undefined {
  if (!usage) return undefined
  const prompt = usage.prompt_tokens
  const completion = usage.completion_tokens
  if (prompt === undefined && completion === undefined) return undefined
  return {
    prompt_eval_count: typeof prompt === 'number' ? prompt : undefined,
    eval_count: typeof completion === 'number' ? completion : undefined,
  }
}

function toDataImageUri(base64: string): string {
  return `data:image/png;base64,${base64.replace(/\s+/g, '')}`
}

function sleepMs(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(t)
      reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

async function parseOpenRouterError(res: Response): Promise<{
  text: string
  retryAfterSeconds?: number
}> {
  const txt = await res.text().catch(() => '')
  try {
    const parsed = JSON.parse(txt) as {
      error?: { metadata?: { retry_after_seconds?: number } }
    }
    const retryAfterSeconds = parsed?.error?.metadata?.retry_after_seconds
    return { text: txt, retryAfterSeconds }
  } catch {
    return { text: txt }
  }
}

export function ollamaMessagesToOpenRouter(messages: OllamaApiMessage[]): OpenRouterMessage[] {
  const out: OpenRouterMessage[] = []
  for (const m of messages) {
    if (m.role === 'tool') {
      out.push({
        role: 'tool',
        content: m.content,
        tool_call_id: m.tool_name || 'tool_call_unknown',
        name: m.tool_name,
      })
      continue
    }
    if (m.role === 'assistant') {
      const toolCalls: OpenRouterToolCall[] | undefined = m.tool_calls?.length
        ? m.tool_calls
            .filter((t): t is OllamaToolCall & { function: NonNullable<OllamaToolCall['function']> } => Boolean(t.function?.name))
            .map((t, idx) => ({
              id: t.id || `tool_call_${idx + 1}`,
              type: 'function',
              index: t.index ?? idx,
              function: {
                name: t.function!.name!,
                arguments:
                  typeof t.function!.arguments === 'string'
                    ? t.function!.arguments
                    : JSON.stringify(t.function!.arguments ?? {}),
              },
            }))
        : undefined
      out.push({
        role: 'assistant',
        content: m.content ?? '',
        ...(toolCalls?.length ? { tool_calls: toolCalls } : {}),
      })
      continue
    }
    if (m.role === 'user' && m.images?.length) {
      out.push({
        role: 'user',
        content: [
          { type: 'text', text: m.content || '' },
          ...m.images.map((img) => ({ type: 'image_url' as const, image_url: { url: toDataImageUri(img) } })),
        ],
      })
      continue
    }
    out.push({ role: m.role, content: m.content })
  }
  return out
}

export async function streamOpenRouterChat(
  options: StreamOpenRouterChatParams,
): Promise<{ content: string; tool_calls: OpenRouterToolCall[]; usage?: OllamaChatUsage }> {
  const root = normalizeBaseUrl(options.baseUrl || 'https://openrouter.ai/api/v1')
  const extra = compactOpenRouterOptions(options.modelOptions)
  const models = options.model === FALLBACK_MODEL ? [options.model] : [options.model, FALLBACK_MODEL]
  let res: Response | null = null
  let lastErr = ''

  for (const model of models) {
    for (let attempt = 0; attempt < MAX_RETRIES_PER_MODEL; attempt++) {
      const body: Record<string, unknown> = {
        model,
        messages: options.messages,
        stream: true,
      }
      if (extra) Object.assign(body, extra)
      if (options.tools !== undefined) body.tools = options.tools

      res = await fetch(`${root}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: options.signal,
        body: JSON.stringify(body),
      })
      if (res.ok) break

      const err = await parseOpenRouterError(res)
      lastErr = `OpenRouter /chat/completions ${res.status}: ${err.text || res.statusText}`
      if (!RETRYABLE_STATUS.has(res.status)) {
        throw new Error(lastErr)
      }

      const isLastAttempt = attempt >= MAX_RETRIES_PER_MODEL - 1
      if (isLastAttempt) break
      const retrySec = typeof err.retryAfterSeconds === 'number' && err.retryAfterSeconds > 0
        ? err.retryAfterSeconds
        : 2 ** attempt
      await sleepMs(retrySec * 1000, options.signal)
    }
    if (res?.ok) break
  }

  if (!res || !res.ok) {
    throw new Error(lastErr || 'OpenRouter /chat/completions request failed')
  }
  if (!res.body) throw new Error('No response body')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''
  const toolCalls: OpenRouterToolCall[] = []
  let usage: OpenRouterUsage | undefined

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n')
    buffer = parts.pop() ?? ''
    for (const raw of parts) {
      const line = raw.trim()
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (!payload || payload === '[DONE]') continue
      let obj: unknown
      try {
        obj = JSON.parse(payload)
      } catch {
        continue
      }
      const chunk = obj as {
        choices?: Array<{
          delta?: { content?: string | null; tool_calls?: OpenRouterToolCall[] }
          message?: { content?: string | null; tool_calls?: OpenRouterToolCall[] }
          error?: { message?: string }
        }>
        error?: { message?: string } | string
        usage?: OpenRouterUsage
      }
      const errMsg =
        typeof chunk.error === 'string'
          ? chunk.error
          : chunk.error?.message ||
            chunk.choices?.[0]?.error?.message
      if (errMsg) throw new Error(errMsg)
      if (chunk.usage) usage = chunk.usage
      const choice = chunk.choices?.[0]
      const delta = choice?.delta
      const msg = choice?.message
      if (delta?.tool_calls?.length) mergeToolCallDeltas(toolCalls, delta.tool_calls)
      if (msg?.tool_calls?.length) mergeToolCallDeltas(toolCalls, msg.tool_calls)
      const piece = delta?.content ?? msg?.content
      if (piece) {
        full += piece
        options.onDelta(full)
      }
    }
  }

  return {
    content: full,
    tool_calls: toolCalls.filter((t) => Boolean(t.function?.name)),
    usage: mapOpenRouterUsageToOllama(usage),
  }
}
