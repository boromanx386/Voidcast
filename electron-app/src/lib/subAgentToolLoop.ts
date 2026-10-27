import {
  detectSubAgentProvider,
  openCodeGoApiStyle,
  type SubAgentProviderId,
} from '@/lib/cloudLlmPresets'
import { anthropicMessagesHeaders, buildAnthropicMessagesBody } from '@/lib/anthropicMessages'
import { buildResponsesBody, parseResponsesOutput, responsesHeaders } from '@/lib/openResponses'
import { assertCloudLlmApiKey } from '@/lib/cloudLlm'
import {
  deepseekApiBaseForRuntime,
  nvidiaApiBaseForRuntime,
  openaiApiBaseForRuntime,
  opencodeGoApiBaseForRuntime,
  usesServerCloudProxy,
} from '@/lib/platform'
import { normalizeBaseUrl } from '@/lib/settings'
import {
  openRouterProviderRoutingBody,
  postJsonWithRetry,
  type OpenRouterMessage,
} from '@/lib/openrouter'
import { fetchOllamaWithRetry } from '@/lib/ollama'
import type { AgentToolDefinition } from '@/lib/toolDefinitions'
import type { SubAgentConfig } from '@/lib/settings'
import type { SubAgentKeys } from '@/lib/subAgent'

export type NativeSubAgentToolCall = {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string | Record<string, unknown>
  }
}

export type NativeSubAgentMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string | null
  thinking?: string
  reasoning?: string
  reasoning_content?: string
  tool_calls?: NativeSubAgentToolCall[]
  tool_call_id?: string
  name?: string
}

/** Token counts of one model round, normalised across provider response shapes. */
export type NativeSubAgentUsage = {
  promptTokens: number
  completionTokens: number
  /** Prompt tokens the provider served from its cache (0 when it does not report). */
  cachedPromptTokens: number
}

export type NativeSubAgentToolRound = {
  content: string
  thinking: string
  toolCalls: NativeSubAgentToolCall[]
  /** Absent when the provider did not report usage. */
  usage?: NativeSubAgentUsage
}

function usageNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

/**
 * Read token usage from a non-streaming response body. Covers Ollama
 * (`prompt_eval_count` / `eval_count`), OpenAI-style chat completions
 * (`prompt_tokens` / `completion_tokens`, cache via `prompt_tokens_details` or
 * DeepSeek's `prompt_cache_hit_tokens`) and the Anthropic / Responses shapes
 * (`input_tokens` / `output_tokens`).
 */
export function extractNativeRoundUsage(data: unknown): NativeSubAgentUsage | undefined {
  if (!data || typeof data !== 'object') return undefined
  const root = data as Record<string, unknown>
  const raw = root.usage && typeof root.usage === 'object' ? root.usage : root
  const u = raw as Record<string, unknown>
  const details = (u.prompt_tokens_details ?? u.input_tokens_details) as
    Record<string, unknown> | undefined
  const promptTokens =
    usageNumber(u.prompt_tokens) || usageNumber(u.input_tokens) || usageNumber(u.prompt_eval_count)
  const completionTokens =
    usageNumber(u.completion_tokens) || usageNumber(u.output_tokens) || usageNumber(u.eval_count)
  if (promptTokens === 0 && completionTokens === 0) return undefined
  const cachedPromptTokens =
    usageNumber(details?.cached_tokens) ||
    usageNumber(u.prompt_cache_hit_tokens) ||
    usageNumber(u.cache_read_input_tokens) ||
    usageNumber(u.prompt_eval_cached_count)
  return { promptTokens, completionTokens, cachedPromptTokens }
}

function argsAsObject(raw: string | Record<string, unknown> | undefined): Record<string, unknown> {
  if (raw && typeof raw === 'object') return raw
  if (typeof raw !== 'string' || !raw.trim()) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

function toOllamaMessages(messages: NativeSubAgentMessage[]) {
  return messages.map((message) => {
    if (message.role === 'tool') {
      return {
        role: 'tool' as const,
        content: message.content ?? '',
        tool_name: message.name || message.tool_call_id || '',
      }
    }
    if (message.role === 'assistant') {
      return {
        role: 'assistant' as const,
        content: message.content ?? '',
        ...(message.thinking?.trim() ? { thinking: message.thinking.trim() } : {}),
        ...(message.tool_calls?.length
          ? {
              tool_calls: message.tool_calls.map((call) => ({
                id: call.id,
                type: 'function',
                function: {
                  name: call.function.name,
                  arguments: argsAsObject(call.function.arguments),
                },
              })),
            }
          : {}),
      }
    }
    return {
      role: message.role,
      content: message.content ?? '',
    }
  })
}

function toOpenAiMessages(messages: NativeSubAgentMessage[]) {
  return messages.map((message) => {
    if (message.role === 'tool') {
      return {
        role: 'tool' as const,
        content: message.content ?? '',
        tool_call_id: message.tool_call_id || message.name || 'worker_tool_call',
        ...(message.name ? { name: message.name } : {}),
      }
    }
    if (message.role === 'assistant') {
      return {
        role: 'assistant' as const,
        content: message.content ?? '',
        ...(message.reasoning?.trim() ? { reasoning: message.reasoning.trim() } : {}),
        ...(message.reasoning_content?.trim()
          ? { reasoning_content: message.reasoning_content.trim() }
          : {}),
        ...(message.tool_calls?.length ? { tool_calls: message.tool_calls } : {}),
      }
    }
    return {
      role: message.role,
      content: message.content ?? '',
    }
  })
}

function normalizeToolCalls(raw: unknown): NativeSubAgentToolCall[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item, index) => {
    if (!item || typeof item !== 'object') return []
    const value = item as {
      id?: unknown
      type?: unknown
      function?: { name?: unknown; arguments?: unknown }
    }
    const name = typeof value.function?.name === 'string' ? value.function.name.trim() : ''
    if (!name) return []
    const args = value.function?.arguments
    return [
      {
        id: typeof value.id === 'string' && value.id.trim() ? value.id : `worker_call_${index + 1}`,
        type: 'function' as const,
        function: {
          name,
          arguments:
            typeof args === 'object' && args !== null && !Array.isArray(args)
              ? (args as Record<string, unknown>)
              : typeof args === 'string'
                ? args
                : '{}',
        },
      },
    ]
  })
}

function cloudEndpoint(
  provider: Exclude<SubAgentProviderId, 'ollama'>,
  config: SubAgentConfig,
  keys: SubAgentKeys,
): { label: string; baseUrl: string; apiKey: string; extraBody: Record<string, unknown> } {
  const viaProxy = usesServerCloudProxy()
  const providerOnly =
    provider === 'openrouter'
      ? openRouterProviderRoutingBody(config.openrouterProviderOnly)
      : undefined

  if (provider === 'openrouter') {
    const baseUrl = viaProxy
      ? `${normalizeBaseUrl(keys.openrouterBaseUrl || (typeof window !== 'undefined' ? window.location.origin : ''))}/api/openrouter/api/v1`
      : normalizeBaseUrl(keys.openrouterBaseUrl || 'https://openrouter.ai/api/v1')
    return {
      label: 'OpenRouter',
      baseUrl,
      apiKey: viaProxy ? '' : keys.openrouterApiKey,
      extraBody: providerOnly ? { provider: providerOnly } : {},
    }
  }

  if (provider === 'deepseek') {
    return {
      label: 'DeepSeek',
      baseUrl: viaProxy
        ? deepseekApiBaseForRuntime()
        : normalizeBaseUrl(keys.deepseekBaseUrl || 'https://api.deepseek.com'),
      apiKey: viaProxy ? '' : keys.deepseekApiKey,
      extraBody: { thinking: { type: 'disabled' } },
    }
  }

  if (provider === 'openai') {
    return {
      label: 'OpenAI',
      baseUrl: viaProxy
        ? openaiApiBaseForRuntime()
        : normalizeBaseUrl(keys.openaiBaseUrl || 'https://api.openai.com/v1'),
      apiKey: viaProxy ? '' : keys.openaiApiKey,
      // GPT-5.x rejects function tools unless reasoning is explicitly disabled.
      extraBody: { reasoning_effort: 'none' },
    }
  }

  if (provider === 'nvidia') {
    return {
      label: 'NVIDIA',
      baseUrl: viaProxy
        ? nvidiaApiBaseForRuntime()
        : normalizeBaseUrl(keys.nvidiaBaseUrl || 'https://integrate.api.nvidia.com/v1'),
      apiKey: viaProxy ? '' : keys.nvidiaApiKey,
      extraBody: {},
    }
  }

  return {
    label: 'OpenCode Go',
    baseUrl: opencodeGoApiBaseForRuntime(undefined, keys.ttsBaseUrl),
    apiKey: viaProxy ? '' : keys.opencodeGoApiKey || '',
    extraBody: {},
  }
}

async function callOllamaToolRound(opts: {
  config: SubAgentConfig
  keys: SubAgentKeys
  messages: NativeSubAgentMessage[]
  tools: AgentToolDefinition[]
  signal?: AbortSignal
  maxTokens: number
}): Promise<NativeSubAgentToolRound> {
  const baseUrl = normalizeBaseUrl(opts.keys.ollamaBaseUrl || 'http://localhost:11434')
  const res = await fetchOllamaWithRetry(
    `${baseUrl}/api/chat`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: opts.signal,
      body: JSON.stringify({
        model: opts.config.model,
        messages: toOllamaMessages(opts.messages),
        tools: opts.tools,
        stream: false,
        think: false,
        options: {
          temperature: 0.2,
          num_predict: opts.maxTokens,
          num_ctx: opts.config.contextTokens,
        },
      }),
    },
    opts.signal,
  )
  if (!res.ok) {
    const error = await res.text().catch(() => '')
    throw new Error(`Ollama worker ${res.status}: ${error || res.statusText}`)
  }
  const data = (await res.json()) as {
    message?: { content?: string; thinking?: string; tool_calls?: unknown }
  }
  return {
    content: data.message?.content || '',
    thinking: data.message?.thinking || '',
    toolCalls: normalizeToolCalls(data.message?.tool_calls),
    usage: extractNativeRoundUsage(data),
  }
}

async function callCloudToolRound(opts: {
  provider: Exclude<SubAgentProviderId, 'ollama'>
  config: SubAgentConfig
  keys: SubAgentKeys
  messages: NativeSubAgentMessage[]
  tools: AgentToolDefinition[]
  signal?: AbortSignal
  maxTokens: number
}): Promise<NativeSubAgentToolRound> {
  const endpoint = cloudEndpoint(opts.provider, opts.config, opts.keys)

  // OpenCode Go Anthropic-style models (e.g. claude-haiku-5-5) only accept /messages.
  if (
    opts.provider === 'opencode-go' &&
    openCodeGoApiStyle(opts.config.model) === 'anthropic-messages'
  ) {
    assertCloudLlmApiKey('opencode-go', endpoint.apiKey)
    const body = buildAnthropicMessagesBody({
      model: opts.config.model,
      messages: toOpenAiMessages(opts.messages) as OpenRouterMessage[],
      tools: opts.tools,
      maxTokens: opts.maxTokens,
    })
    body.stream = false
    body.temperature = 0.2
    const { res, errorText } = await postJsonWithRetry(
      `${endpoint.baseUrl}/messages`,
      {
        method: 'POST',
        headers: anthropicMessagesHeaders({
          apiKey: endpoint.apiKey,
          sessionId: opts.keys.opencodeSessionId,
          sendAuth: !usesServerCloudProxy(),
        }),
        signal: opts.signal,
        body: JSON.stringify({ ...body, ...endpoint.extraBody }),
      },
      opts.signal,
    )
    if (!res.ok) {
      throw new Error(
        `${endpoint.label} worker /messages ${res.status}: ${errorText || res.statusText}`,
      )
    }
    const data = (await res.json()) as {
      usage?: unknown
      content?: Array<{
        type?: string
        text?: string
        thinking?: string
        id?: string
        name?: string
        input?: unknown
      }>
    }
    let content = ''
    let thinking = ''
    const toolCalls: NativeSubAgentToolCall[] = []
    for (const block of data.content ?? []) {
      if (block.type === 'text' && block.text) content += block.text
      else if (block.type === 'thinking' && block.thinking) thinking += block.thinking
      else if (block.type === 'tool_use' && block.name) {
        toolCalls.push({
          id: block.id || `worker_call_${toolCalls.length + 1}`,
          type: 'function',
          function: {
            name: block.name,
            arguments:
              block.input && typeof block.input === 'object' && !Array.isArray(block.input)
                ? (block.input as Record<string, unknown>)
                : {},
          },
        })
      }
    }
    return { content, thinking, toolCalls, usage: extractNativeRoundUsage(data) }
  }

  // OpenCode Go Responses-style models (the Contributor tier) only accept /responses.
  if (
    opts.provider === 'opencode-go' &&
    openCodeGoApiStyle(opts.config.model) === 'opencode-responses'
  ) {
    assertCloudLlmApiKey('opencode-go', endpoint.apiKey)
    const body = buildResponsesBody({
      model: opts.config.model,
      messages: toOpenAiMessages(opts.messages) as OpenRouterMessage[],
      tools: opts.tools,
      maxTokens: opts.maxTokens,
    })
    body.stream = false
    // No temperature here: reasoning-capable Responses models reject sampling params.
    const { res, errorText } = await postJsonWithRetry(
      `${endpoint.baseUrl}/responses`,
      {
        method: 'POST',
        headers: responsesHeaders({
          apiKey: endpoint.apiKey,
          sessionId: opts.keys.opencodeSessionId,
          sendAuth: !usesServerCloudProxy(),
        }),
        signal: opts.signal,
        body: JSON.stringify({ ...body, ...endpoint.extraBody }),
      },
      opts.signal,
    )
    if (!res.ok) {
      throw new Error(
        `${endpoint.label} worker /responses ${res.status}: ${errorText || res.statusText}`,
      )
    }
    const responseBody = await res.json()
    const parsed = parseResponsesOutput(responseBody)
    return {
      content: parsed.content,
      thinking: parsed.reasoning,
      toolCalls: parsed.toolCalls,
      usage: extractNativeRoundUsage(responseBody),
    }
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (endpoint.apiKey.trim()) headers.Authorization = `Bearer ${endpoint.apiKey.trim()}`
  if (opts.provider === 'opencode-go' && opts.keys.opencodeSessionId?.trim()) {
    headers['x-opencode-session'] = opts.keys.opencodeSessionId.trim()
  }
  const { res, errorText } = await postJsonWithRetry(
    `${endpoint.baseUrl}/chat/completions`,
    {
      method: 'POST',
      headers,
      signal: opts.signal,
      body: JSON.stringify({
        model: opts.config.model,
        messages: toOpenAiMessages(opts.messages),
        tools: opts.tools,
        max_tokens: opts.maxTokens,
        temperature: 0.2,
        stream: false,
        ...endpoint.extraBody,
      }),
    },
    opts.signal,
  )
  if (!res.ok) {
    throw new Error(`${endpoint.label} worker ${res.status}: ${errorText || res.statusText}`)
  }
  const data = (await res.json()) as {
    usage?: unknown
    choices?: Array<{
      message?: {
        content?: string | null
        reasoning?: string | null
        reasoning_content?: string | null
        tool_calls?: unknown
      }
    }>
  }
  const message = data.choices?.[0]?.message
  return {
    content: message?.content || '',
    thinking: message?.reasoning || message?.reasoning_content || '',
    toolCalls: normalizeToolCalls(message?.tool_calls),
    usage: extractNativeRoundUsage(data),
  }
}

export async function callNativeSubAgentToolRound(opts: {
  messages: NativeSubAgentMessage[]
  tools: AgentToolDefinition[]
  config: SubAgentConfig
  keys: SubAgentKeys
  signal?: AbortSignal
  maxTokens: number
}): Promise<NativeSubAgentToolRound> {
  const provider = detectSubAgentProvider(opts.config.model, opts.config.provider)
  if (provider === 'ollama') return callOllamaToolRound(opts)
  return callCloudToolRound({ ...opts, provider })
}
