import type { OllamaApiMessage, OllamaChatUsage, OllamaModelOptions, OllamaToolCall } from './ollama'
import { isElectron, usesServerCloudProxy } from './platform'
import type { LlmThinkLevel } from './settings'
import { normalizeBaseUrl } from './settings'

export type OpenRouterContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

export type OpenRouterMessage =
  | { role: 'system' | 'assistant'; content: string }
  | { role: 'user'; content: string | OpenRouterContentPart[] }
  | {
      role: 'assistant'
      content: string | null
      tool_calls?: OpenRouterToolCall[]
      /** Replay for reasoning models (OpenRouter / upstream). */
      reasoning?: string | null
    }
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
  /** Some models stream `delta.reasoning` (or `reasoning_content`) alongside content. */
  onThinkingDelta?: (fullReasoning: string) => void
  modelOptions?: OllamaModelOptions
  tools?: unknown
  /** DeepSeek thinking mode; ignored for other providers. */
  thinkLevel?: LlmThinkLevel
}

const RETRYABLE_STATUS = new Set([429, 502, 503, 504])
const MAX_RETRIES_PER_MODEL = 3

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

function normalizeNvidiaBaseUrl(root: string): string {
  if (!root.includes('integrate.api.nvidia.com')) return root
  const withoutEndpoint = root.replace(/\/chat\/completions\/?$/i, '')
  return /\/v1(?:\/|$)/.test(withoutEndpoint) ? withoutEndpoint : `${withoutEndpoint}/v1`
}

function isDeepSeekApi(baseUrl: string): boolean {
  const root = normalizeBaseUrl(baseUrl)
  return root.includes('api.deepseek.com') || root.includes('/api/deepseek')
}

function apiLabelForBaseUrl(baseUrl: string): string {
  if (isDeepSeekApi(baseUrl)) return 'DeepSeek'
  if (baseUrl.includes('integrate.api.nvidia.com') || baseUrl.includes('/api/nvidia')) return 'NVIDIA'
  return 'OpenRouter'
}

function applyDeepSeekThinkingBody(
  body: Record<string, unknown>,
  thinkLevel: LlmThinkLevel | undefined,
): void {
  if (!thinkLevel || thinkLevel === 'off') {
    body.thinking = { type: 'disabled' }
    return
  }
  body.thinking = { type: 'enabled' }
  const effort = thinkLevel === 'on' ? 'medium' : thinkLevel
  if (effort === 'low' || effort === 'medium' || effort === 'high') {
    body.reasoning_effort = effort
  }
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

function throwAbortError(): never {
  throw Object.assign(new Error('Aborted'), { name: 'AbortError' })
}

async function fetchWithHardAbort(input: RequestInfo | URL, init: RequestInit, signal?: AbortSignal): Promise<Response> {
  if (!signal) return fetch(input, init)
  if (signal.aborted) throwAbortError()
  return await new Promise<Response>((resolve, reject) => {
    const onAbort = () => {
      reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    fetch(input, init)
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', onAbort))
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
      const reasoning =
        'thinking' in m && typeof (m as { thinking?: string }).thinking === 'string'
          ? (m as { thinking?: string }).thinking?.trim() || undefined
          : undefined
      out.push({
        role: 'assistant',
        content: m.content ?? '',
        ...(toolCalls?.length ? { tool_calls: toolCalls } : {}),
        ...(reasoning ? { reasoning } : {}),
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

function pickReasoningDelta(d: unknown): string {
  if (!d || typeof d !== 'object') return ''
  const o = d as Record<string, unknown>
  const r = o.reasoning
  if (typeof r === 'string') return r
  const rc = o.reasoning_content
  if (typeof rc === 'string') return rc
  return ''
}

export async function streamOpenRouterChat(
  options: StreamOpenRouterChatParams,
): Promise<{
  content: string
  reasoning: string
  tool_calls: OpenRouterToolCall[]
  usage?: OllamaChatUsage
}> {
  const root = normalizeNvidiaBaseUrl(
    normalizeBaseUrl(options.baseUrl || 'https://openrouter.ai/api/v1'),
  )
  const isNvidia = root.includes('integrate.api.nvidia.com')
  const canUseElectronNvidiaProxy =
    isElectron() &&
    isNvidia &&
    Boolean(window.voidcast?.llmChatProxy)

  const extra = compactOpenRouterOptions(options.modelOptions)
  const models = [options.model]
  const apiLabel = apiLabelForBaseUrl(root)
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
      if (isDeepSeekApi(root)) applyDeepSeekThinkingBody(body, options.thinkLevel)

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }
      if (!usesServerCloudProxy() && options.apiKey.trim()) {
        headers.Authorization = `Bearer ${options.apiKey.trim()}`
      }

      try {
        res = await fetchWithHardAbort(`${root}/chat/completions`, {
          method: 'POST',
          headers,
          signal: options.signal,
          body: JSON.stringify(body),
        }, options.signal)
      } catch (e) {
        if ((e as Error)?.name === 'AbortError') throw e
        if (!canUseElectronNvidiaProxy || model !== options.model) throw e
        const proxyRes = await window.voidcast!.llmChatProxy({
          api_base_url: root,
          api_key: options.apiKey,
          body: { ...body, stream: false },
        })
        if (!proxyRes.ok) {
          throw new Error(`NVIDIA /chat/completions ${proxyRes.status ?? ''}: ${proxyRes.detail}`.trim())
        }
        const data = proxyRes.data as {
          choices?: Array<{
            message?: { content?: string | null; tool_calls?: OpenRouterToolCall[] }
          }>
          usage?: OpenRouterUsage
          error?: { message?: string } | string
        }
        const errMsg = typeof data.error === 'string' ? data.error : data.error?.message
        if (errMsg) throw new Error(errMsg)
        const msg = data.choices?.[0]?.message
        const content = msg?.content ?? ''
        const toolCalls = msg?.tool_calls ?? []
        const reasoning =
          msg && typeof (msg as { reasoning?: string }).reasoning === 'string'
            ? (msg as { reasoning: string }).reasoning
            : ''
        options.onDelta(content)
        if (reasoning) options.onThinkingDelta?.(reasoning)
        return {
          content,
          tool_calls: toolCalls.filter((t) => Boolean(t.function?.name)),
          usage: mapOpenRouterUsageToOllama(data.usage),
          reasoning,
        }
      }
      if (res.ok) break

      const err = await parseOpenRouterError(res)
      lastErr = `${apiLabel} /chat/completions ${res.status}: ${err.text || res.statusText}`
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
    throw new Error(lastErr || `${apiLabel} /chat/completions request failed`)
  }
  if (!res.body) throw new Error('No response body')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''
  let fullReasoning = ''
  const toolCalls: OpenRouterToolCall[] = []
  let usage: OpenRouterUsage | undefined

  while (true) {
    if (options.signal?.aborted) throwAbortError()
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
      const rPiece = pickReasoningDelta(delta) || pickReasoningDelta(msg)
      if (rPiece) {
        fullReasoning += rPiece
        options.onThinkingDelta?.(fullReasoning)
      }
      const piece = delta?.content ?? msg?.content
      if (piece) {
        full += piece
        options.onDelta(full)
      }
    }
  }

  return {
    content: full,
    reasoning: fullReasoning,
    tool_calls: toolCalls.filter((t) => Boolean(t.function?.name)),
    usage: mapOpenRouterUsageToOllama(usage),
  }
}
