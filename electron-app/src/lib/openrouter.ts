import type { OllamaApiMessage, OllamaChatUsage, OllamaModelOptions, OllamaToolCall } from './ollama'
import { assertCloudLlmApiKey } from '@/lib/cloudLlm'
import { isElectron, openRouterApiBaseForRuntime, usesServerCloudProxy } from './platform'
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
  /** OpenRouter provider slug; when set, routes only to that provider (no fallbacks). */
  providerOnly?: string
}

const RETRYABLE_STATUS = new Set([429, 502, 503, 504])
const MAX_RETRIES_PER_MODEL = 3

/** Build OpenRouter `provider` body when a slug is configured. */
export function openRouterProviderRoutingBody(
  providerOnly: string | undefined,
): { only: string[]; allow_fallbacks: false } | undefined {
  const slug = (providerOnly || '').trim()
  if (!slug) return undefined
  return { only: [slug], allow_fallbacks: false }
}

// ── Model endpoints (providers) ─────────────────────────────────────────

export type OpenRouterModelEndpoint = {
  /** Provider slug, e.g. "anthropic", "openai", "deepinfra". */
  tag: string
  provider_name: string
  name: string
  context_length: number
  max_completion_tokens?: number
  pricing?: {
    prompt?: string
    completion?: string
    request?: string
    image?: string
  }
  uptime_last_30m?: number
  status?: number
  quantization?: string
}

export type OpenRouterModelEndpointsResult = {
  id: string
  name: string
  endpoints: OpenRouterModelEndpoint[]
}

/**
 * GET /api/v1/models/{author}/{slug}/endpoints — list every provider that
 * serves the model. Works from the desktop app (direct) and from the LAN
 * web client (through the TTS-server OpenRouter proxy, key stays server-side).
 */
export async function fetchOpenRouterModelEndpoints(options: {
  model: string
  baseUrl?: string
  apiKey?: string
  signal?: AbortSignal
}): Promise<OpenRouterModelEndpointsResult> {
  const model = (options.model || '').trim()
  if (!model) throw new Error('No OpenRouter model selected')
  const [author, ...rest] = model.split('/')
  const slug = rest.join('/')
  if (!author || !slug) throw new Error(`Invalid model id: ${model}`)

  const viaProxy = usesServerCloudProxy()
  const baseUrl = viaProxy
    ? openRouterApiBaseForRuntime(options.baseUrl)
    : normalizeBaseUrl(options.baseUrl || 'https://openrouter.ai/api/v1')

  const headers: Record<string, string> = {
    Accept: 'application/json',
  }
  if (!viaProxy && (options.apiKey || '').trim()) {
    headers.Authorization = `Bearer ${(options.apiKey || '').trim()}`
  }

  const url = `${baseUrl.replace(/\/+$/, '')}/models/${encodeURIComponent(author)}/${encodeURIComponent(slug)}/endpoints`
  const res = await fetch(url, { method: 'GET', headers, signal: options.signal })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`OpenRouter endpoints ${res.status}: ${errText || res.statusText}`)
  }

  const json = (await res.json()) as {
    data?: {
      id?: string
      name?: string
      endpoints?: OpenRouterModelEndpoint[]
    }
  }
  const data = json.data ?? {}
  return {
    id: data.id || model,
    name: data.name || model,
    endpoints: Array.isArray(data.endpoints) ? data.endpoints : [],
  }
}

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

function isCrofAiApi(baseUrl: string): boolean {
  const root = normalizeBaseUrl(baseUrl)
  return root.includes('crof.ai') || root.includes('/api/crofai')
}

function isOpenCodeGoApi(baseUrl: string): boolean {
  const root = normalizeBaseUrl(baseUrl)
  return root.includes('opencode.ai/zen/go') || root.includes('/api/opencode-go')
}

/**
 * OpenCode Go (DeepSeek / Kimi / etc.) expects OpenAI-compatible payloads but:
 * - use `reasoning_content` (not OpenRouter-style `reasoning`)
 * - after a tool call, that assistant turn's reasoning MUST be echoed back
 *   or upstream returns 400 (see DeepSeek/Kimi thinking + tools via zen/go).
 * Docs: https://opencode.ai/docs/go
 */
function sanitizeMessagesForOpenCodeGo(messages: OpenRouterMessage[]): OpenRouterMessage[] {
  type WireAssistant = {
    role: 'assistant'
    content: string | null
    tool_calls?: OpenRouterToolCall[]
    reasoning_content?: string
  }

  const needsReasoningEcho = messages.some((m) => {
    if (m.role !== 'assistant') return false
    const raw = m as {
      reasoning?: string | null
      reasoning_content?: string | null
      tool_calls?: OpenRouterToolCall[]
    }
    return Boolean(
      raw.tool_calls?.length ||
        raw.reasoning?.trim() ||
        raw.reasoning_content?.trim(),
    )
  })

  return messages.map((m) => {
    if (m.role === 'tool') {
      return {
        role: 'tool',
        content: m.content,
        tool_call_id: m.tool_call_id,
      }
    }
    if (m.role !== 'assistant') return m

    const raw = m as {
      role: 'assistant'
      content: string | null
      tool_calls?: OpenRouterToolCall[]
      reasoning?: string | null
      reasoning_content?: string | null
    }
    const toolCalls = raw.tool_calls
      ?.filter((tc) => Boolean(tc.function?.name))
      .map((tc, idx) => ({
        id: tc.id || `tool_call_${idx + 1}`,
        type: 'function' as const,
        function: {
          name: tc.function.name,
          arguments:
            typeof tc.function.arguments === 'string'
              ? tc.function.arguments
              : JSON.stringify(tc.function.arguments ?? {}),
        },
      }))
    const hasTools = Boolean(toolCalls?.length)
    const content =
      hasTools && (raw.content == null || String(raw.content).trim() === '')
        ? null
        : (raw.content ?? '')
    const reasoningText =
      (typeof raw.reasoning_content === 'string' && raw.reasoning_content) ||
      (typeof raw.reasoning === 'string' && raw.reasoning) ||
      ''
    const out: WireAssistant = {
      role: 'assistant',
      content,
      ...(hasTools ? { tool_calls: toolCalls } : {}),
    }
    // Never send OpenRouter `reasoning`; echo DeepSeek/Kimi `reasoning_content`.
    if (needsReasoningEcho || reasoningText.trim()) {
      out.reasoning_content = reasoningText
    }
    return out as OpenRouterMessage
  })
}

function apiLabelForBaseUrl(baseUrl: string): string {
  if (isDeepSeekApi(baseUrl)) return 'DeepSeek'
  if (isCrofAiApi(baseUrl)) return 'CrofAI'
  if (baseUrl.includes('api.openai.com') || baseUrl.includes('/api/openai')) return 'OpenAI'
  if (baseUrl.includes('integrate.api.nvidia.com') || baseUrl.includes('/api/nvidia')) return 'NVIDIA'
  if (isOpenCodeGoApi(baseUrl)) return 'OpenCode Go'
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

/** CrofAI: reasoning_effort low|medium|high|none (https://crof.ai/docs). */
function applyCrofAiThinkingBody(
  body: Record<string, unknown>,
  thinkLevel: LlmThinkLevel | undefined,
): void {
  if (!thinkLevel || thinkLevel === 'off') {
    body.reasoning_effort = 'none'
    return
  }
  const effort = thinkLevel === 'on' ? 'medium' : thinkLevel
  if (effort === 'low' || effort === 'medium' || effort === 'high') {
    body.reasoning_effort = effort
  }
}

/**
 * GPT-5.x on Chat Completions rejects function tools unless reasoning_effort is
 * explicitly 'none' (default reasoning is on). Tool agent loop must force none.
 */
function applyOpenAiReasoningBody(
  body: Record<string, unknown>,
  thinkLevel: LlmThinkLevel | undefined,
  hasTools: boolean,
): void {
  if (hasTools) {
    body.reasoning_effort = 'none'
    return
  }
  if (!thinkLevel || thinkLevel === 'off') {
    body.reasoning_effort = 'none'
    return
  }
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
  const isOpenCodeGo = isOpenCodeGoApi(root)
  const isCrofAi = isCrofAiApi(root)
  const cloudProvider =
    apiLabel === 'DeepSeek'
      ? 'deepseek'
      : apiLabel === 'CrofAI'
        ? 'crofai'
        : apiLabel === 'OpenAI'
          ? 'openai'
          : apiLabel === 'NVIDIA'
            ? 'nvidia'
            : apiLabel === 'OpenCode Go'
              ? 'opencode-go'
              : 'openrouter'
  assertCloudLlmApiKey(cloudProvider, options.apiKey)
  let res: Response | null = null
  let lastErr = ''

  for (const model of models) {
    for (let attempt = 0; attempt < MAX_RETRIES_PER_MODEL; attempt++) {
      const messages =
        isOpenCodeGo || isCrofAi
          ? sanitizeMessagesForOpenCodeGo(options.messages)
          : options.messages
      const body: Record<string, unknown> = {
        model,
        messages,
        stream: true,
        // OpenAI (and most OpenAI-compatible hosts) omit usage on streams unless asked.
        stream_options: { include_usage: true },
      }
      if (extra) Object.assign(body, extra)
      if (options.tools !== undefined) body.tools = options.tools
      if (isDeepSeekApi(root)) applyDeepSeekThinkingBody(body, options.thinkLevel)
      if (isCrofAi && options.thinkLevel !== undefined) {
        applyCrofAiThinkingBody(body, options.thinkLevel)
      }
      // OpenCode Go: honor THINKING_LEVEL without forcing disable when unset.
      if (isOpenCodeGo && options.thinkLevel !== undefined) {
        applyDeepSeekThinkingBody(body, options.thinkLevel)
      }
      if (apiLabel === 'OpenAI') {
        applyOpenAiReasoningBody(body, options.thinkLevel, options.tools !== undefined)
      }
      if (apiLabel === 'OpenRouter') {
        const provider = openRouterProviderRoutingBody(options.providerOnly)
        if (provider) body.provider = provider
      }

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
