/**
 * Anthropic Messages API adapter (`POST {base}/messages`).
 *
 * Used for OpenCode Go models that are served only on the Anthropic format
 * (e.g. claude-haiku-5-5). Voidcast's internal history stays in the
 * OpenAI-style `OpenRouterMessage` shape; this module converts it on the way
 * out and converts Anthropic SSE events back into the same tool-call /
 * usage shapes that the chat-completions parser produces.
 *
 * Pure helpers only — no fetch here. The network loop lives in openrouter.ts.
 */
import type {
  OpenRouterContentPart,
  OpenRouterMessage,
  OpenRouterToolCall,
  OpenRouterUsage,
} from './openrouter'

export const ANTHROPIC_VERSION = '2023-06-01'
/**
 * Default output cap; Anthropic requires `max_tokens` on every request.
 * Must be generous: with adaptive thinking the thinking tokens are billed
 * against this same budget, so a low cap produces an empty `max_tokens`
 * turn (no text, no tool_use) on large tool results. Overridable per call
 * via `maxTokens`; lower this for models whose hard output limit is 8192.
 */
export const ANTHROPIC_DEFAULT_MAX_TOKENS = 32000

export type AnthropicTextBlock = { type: 'text'; text: string }
export type AnthropicImageBlock = {
  type: 'image'
  source: { type: 'base64'; media_type: string; data: string }
}
export type AnthropicToolUseBlock = {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}
export type AnthropicToolResultBlock = {
  type: 'tool_result'
  tool_use_id: string
  content: string
}
export type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicImageBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock

export type AnthropicMessage = {
  role: 'user' | 'assistant'
  content: AnthropicContentBlock[]
}

export type AnthropicTool = {
  name: string
  description?: string
  input_schema: Record<string, unknown>
}

/** `data:image/png;base64,AAAA` → `{ media_type, data }`. Null when not a base64 data URI. */
export function parseDataUriImage(url: string): { media_type: string; data: string } | null {
  const m = /^data:([^;]+);base64,([\s\S]*)$/.exec(url)
  if (!m) return null
  return { media_type: m[1], data: m[2] }
}

function parseToolArgs(raw: string | Record<string, unknown> | undefined): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw
  if (typeof raw !== 'string' || !raw.trim()) return {}
  try {
    const v: unknown = JSON.parse(raw)
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function userContentToBlocks(
  content: string | OpenRouterContentPart[] | null | undefined,
): AnthropicContentBlock[] {
  if (content == null) return []
  if (typeof content === 'string') return content ? [{ type: 'text', text: content }] : []
  const out: AnthropicContentBlock[] = []
  for (const part of content) {
    if (part.type === 'text') {
      if (part.text) out.push({ type: 'text', text: part.text })
      continue
    }
    const img = parseDataUriImage(part.image_url.url)
    if (img) out.push({ type: 'image', source: { type: 'base64', ...img } })
  }
  return out
}

/**
 * Convert Voidcast/OpenAI-style history into Anthropic `{ system, messages }`.
 *
 * - `system` messages are joined into the top-level `system` string.
 * - `assistant.tool_calls` become `tool_use` blocks (arguments parsed to an object).
 * - consecutive `tool` messages become one user message of `tool_result` blocks.
 * - consecutive same-role messages are merged (Anthropic expects strict alternation in practice).
 * - reasoning text is dropped: Anthropic thinking blocks need a provider signature we don't store.
 */
export function openRouterMessagesToAnthropic(messages: OpenRouterMessage[]): {
  system: string | undefined
  messages: AnthropicMessage[]
} {
  const systemParts: string[] = []
  const out: AnthropicMessage[] = []

  const push = (role: 'user' | 'assistant', blocks: AnthropicContentBlock[]) => {
    if (!blocks.length) return
    const last = out[out.length - 1]
    if (last && last.role === role) last.content.push(...blocks)
    else out.push({ role, content: [...blocks] })
  }

  for (const m of messages) {
    if (m.role === 'system') {
      if (typeof m.content === 'string' && m.content.trim()) systemParts.push(m.content)
      continue
    }
    if (m.role === 'tool') {
      push('user', [
        { type: 'tool_result', tool_use_id: m.tool_call_id, content: m.content ?? '' },
      ])
      continue
    }
    if (m.role === 'assistant') {
      const blocks: AnthropicContentBlock[] = []
      const text = typeof m.content === 'string' ? m.content : ''
      if (text.trim()) blocks.push({ type: 'text', text })
      for (const tc of 'tool_calls' in m ? (m.tool_calls ?? []) : []) {
        if (!tc.function?.name) continue
        blocks.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function.name,
          input: parseToolArgs(tc.function.arguments),
        })
      }
      push('assistant', blocks)
      continue
    }
    // user
    push('user', userContentToBlocks(m.content))
  }

  return {
    system: systemParts.length ? systemParts.join('\n\n') : undefined,
    messages: out,
  }
}

/** OpenAI `tools` array (`{type:'function', function:{name, description, parameters}}`) → Anthropic `tools`. */
export function openAiToolsToAnthropic(tools: unknown): AnthropicTool[] | undefined {
  if (!Array.isArray(tools)) return undefined
  const out: AnthropicTool[] = []
  for (const t of tools) {
    if (!t || typeof t !== 'object') continue
    const fn = (t as { function?: { name?: string; description?: string; parameters?: unknown } })
      .function
    if (!fn?.name) continue
    const params =
      fn.parameters && typeof fn.parameters === 'object' && !Array.isArray(fn.parameters)
        ? (fn.parameters as Record<string, unknown>)
        : { type: 'object', properties: {} }
    out.push({
      name: fn.name,
      ...(fn.description ? { description: fn.description } : {}),
      input_schema: params,
    })
  }
  return out.length ? out : undefined
}

/** Maps the app think level to output_config.effort for adaptive thinking. null = no thinking. */
export function anthropicThinkingEffort(thinkLevel: string | undefined): 'low' | 'medium' | 'high' | null {
  if (!thinkLevel || thinkLevel === 'off') return null
  if (thinkLevel === 'low') return 'low'
  if (thinkLevel === 'high') return 'high'
  return 'medium'
}

export function buildAnthropicMessagesBody(args: {
  model: string
  messages: OpenRouterMessage[]
  tools?: unknown
  maxTokens?: number
  thinkLevel?: string
}): Record<string, unknown> {
  const converted = openRouterMessagesToAnthropic(args.messages)
  const effort = anthropicThinkingEffort(args.thinkLevel)
  const maxTokens =
    typeof args.maxTokens === 'number' && args.maxTokens > 0
      ? Math.floor(args.maxTokens)
      : ANTHROPIC_DEFAULT_MAX_TOKENS
  const body: Record<string, unknown> = {
    model: args.model,
    max_tokens: maxTokens,
    messages: converted.messages,
    stream: true,
  }
  // Some OpenCode Go models reject thinking.type "enabled" and require adaptive thinking
  // with output_config.effort instead of budget_tokens.
  if (effort) {
    // display: 'summarized' asks the server to return readable thinking text
    // (the default may be "omitted", which yields empty thinking_delta events).
    body.thinking = { type: 'adaptive', display: 'summarized' }
    body.output_config = { effort }
  }
  // Mark the system prompt as cacheable. Anthropic caches only when cache_control is set;
  // the cached prefix must be at least ~2048 tokens for Haiku models.
  if (converted.system) {
    body.system = [
      { type: 'text', text: converted.system, cache_control: { type: 'ephemeral' } },
    ]
  }
  const tools = openAiToolsToAnthropic(args.tools)
  if (tools) body.tools = tools
  return body
}

export type AnthropicStreamState = {
  text: string
  reasoning: string
  toolCalls: OpenRouterToolCall[]
  /** content_block index → what kind of block it is (and tool slot for tool_use). */
  blocks: Map<number, { kind: 'text' | 'thinking' | 'tool_use'; toolSlot?: number }>
  usage?: OpenRouterUsage
  /** Anthropic stop_reason ('end_turn' | 'max_tokens' | 'tool_use' | 'stop_sequence'). */
  stopReason?: string
}

export function createAnthropicStreamState(): AnthropicStreamState {
  return { text: '', reasoning: '', toolCalls: [], blocks: new Map() }
}

function usageFromAnthropic(u: {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}): OpenRouterUsage {
  const input = u.input_tokens ?? 0
  const cacheRead = u.cache_read_input_tokens ?? 0
  const cacheWrite = u.cache_creation_input_tokens ?? 0
  const prompt = input + cacheRead + cacheWrite
  const completion = u.output_tokens ?? 0
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: prompt + completion,
    prompt_tokens_details: { cached_tokens: cacheRead, cache_write_tokens: cacheWrite },
  }
}

/**
 * Apply one parsed Anthropic SSE event to the accumulator.
 * Returns which visible streams changed so the caller can fire onDelta / onThinkingDelta.
 * Throws on `error` events so the caller surfaces the provider message.
 */
export function applyAnthropicStreamEvent(
  state: AnthropicStreamState,
  event: unknown,
): { textChanged: boolean; reasoningChanged: boolean } {
  const res = { textChanged: false, reasoningChanged: false }
  if (!event || typeof event !== 'object') return res
  const e = event as Record<string, unknown>
  const type = typeof e.type === 'string' ? e.type : ''
  if (type === 'error') {
    const err = e.error as { message?: string } | undefined
    throw new Error(err?.message || 'Anthropic stream error')
  }

  if (type === 'message_start') {
    const msg = e.message as { usage?: Parameters<typeof usageFromAnthropic>[0] } | undefined
    if (msg?.usage) state.usage = usageFromAnthropic(msg.usage)
    return res
  }

  if (type === 'message_delta') {
    const delta = e.delta as { stop_reason?: string } | undefined
    if (delta?.stop_reason) state.stopReason = delta.stop_reason
    const u = e.usage as { output_tokens?: number } | undefined
    if (u && typeof u.output_tokens === 'number') {
      const prev = state.usage ?? {}
      const completion = u.output_tokens
      state.usage = {
        ...prev,
        completion_tokens: completion,
        total_tokens: (prev.prompt_tokens ?? 0) + completion,
      }
    }
    return res
  }

  if (type === 'content_block_start') {
    const index = typeof e.index === 'number' ? e.index : -1
    const block = e.content_block as
      | { type?: string; id?: string; name?: string }
      | undefined
    if (block?.type === 'text') {
      state.blocks.set(index, { kind: 'text' })
    } else if (block?.type === 'thinking' || block?.type === 'redacted_thinking') {
      state.blocks.set(index, { kind: 'thinking' })
    } else if (block?.type === 'tool_use') {
      const slot = state.toolCalls.length
      state.toolCalls.push({
        id: block.id || `tool_call_${slot + 1}`,
        type: 'function',
        index: slot,
        function: { name: block.name || '', arguments: '' },
      })
      state.blocks.set(index, { kind: 'tool_use', toolSlot: slot })
    }
    return res
  }

  if (type === 'content_block_delta') {
    const index = typeof e.index === 'number' ? e.index : -1
    const delta = e.delta as
      | { type?: string; text?: string; thinking?: string; partial_json?: string }
      | undefined
    if (!delta) return res
    if (delta.type === 'text_delta' && typeof delta.text === 'string' && delta.text) {
      state.text += delta.text
      res.textChanged = true
    } else if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string' && delta.thinking) {
      state.reasoning += delta.thinking
      res.reasoningChanged = true
    } else if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
      const slot = state.blocks.get(index)?.toolSlot
      if (slot !== undefined && state.toolCalls[slot]) {
        state.toolCalls[slot].function.arguments += delta.partial_json
      }
    }
    return res
  }

  return res
}

/** Headers for the Messages endpoint. Auth is `x-api-key`, not Bearer. */
export function anthropicMessagesHeaders(options: {
  apiKey: string
  sessionId?: string
  sendAuth: boolean
}): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'anthropic-version': ANTHROPIC_VERSION,
    // Docs ask clients to identify themselves. Browsers may ignore User-Agent in fetch.
    'User-Agent': 'voidcast/1.0',
  }
  if (options.sendAuth && options.apiKey.trim()) {
    headers['x-api-key'] = options.apiKey.trim()
  }
  const session = (options.sessionId || '').trim()
  if (session) headers['x-opencode-session'] = session
  return headers
}
