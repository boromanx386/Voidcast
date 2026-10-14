/**
 * OpenAI Responses API adapter (`POST {base}/responses`).
 *
 * Used for OpenCode Go models that are served only on the Responses format
 * (the Contributor tier, e.g. "Muse Spark 1.2 Contributor"). Voidcast's internal
 * history stays in the OpenAI-style `OpenRouterMessage` shape; this module
 * flattens it into Responses `input` items on the way out and folds Responses SSE
 * events back into the same tool-call / usage shapes that the chat-completions
 * parser produces.
 *
 * The wire format differs from `/chat/completions` in three ways that matter here:
 * - tools are flat (`{type:'function', name, parameters}`), not nested under `function`
 * - an assistant tool call is its own `function_call` item, and its result is a
 *   `function_call_output` item linked by `call_id` — there is no `role: 'tool'`
 * - the output cap is `max_output_tokens`, and the system prompt is `instructions`
 *
 * Pure helpers only — no fetch here. The network loop lives in openrouter.ts.
 */
import type {
  OpenRouterContentPart,
  OpenRouterMessage,
  OpenRouterToolCall,
  OpenRouterUsage,
} from './openrouter'

/**
 * Default output cap. Reasoning tokens are billed against this same budget, so it
 * has to be generous: a low cap produces an empty turn (no text, no tool call) on
 * large tool results. Overridable per call via `maxTokens`.
 */
export const RESPONSES_DEFAULT_MAX_OUTPUT_TOKENS = 16384

/**
 * Step-down ladder for a rejected `max_output_tokens`. Providers never clamp:
 * asking for more than the model's hard output limit is a 400 error, and 400 is
 * not a retryable status, so the request has to be re-sent with a smaller cap.
 */
export const RESPONSES_MAX_OUTPUT_TOKENS_FALLBACKS: readonly number[] = [8192, 4096]

/**
 * Decide the `max_output_tokens` for a retry after a failed `/responses` request.
 *
 * Returns `null` — "do not retry, let the normal error path run" — unless the
 * failure really is an output-cap rejection with a cheaper rung still on the
 * ladder. Kept pure so the condition is testable without a network.
 *
 * Note the wording differs from the Anthropic path: `max_output_tokens` does not
 * contain the substring `max_tokens`, so it needs its own match.
 */
export function responsesMaxTokensFallback(
  status: number,
  errorText: string,
  currentMaxTokens: number,
  step: number,
): number | null {
  if (status !== 400) return null
  if (!/max_output_tokens|max tokens/i.test(errorText)) return null
  if (step < 0 || step >= RESPONSES_MAX_OUTPUT_TOKENS_FALLBACKS.length) return null
  const next = RESPONSES_MAX_OUTPUT_TOKENS_FALLBACKS[step]
  if (!(currentMaxTokens > next)) return null
  return next
}

export type ResponsesInputTextPart = { type: 'input_text'; text: string }
export type ResponsesOutputTextPart = { type: 'output_text'; text: string }
export type ResponsesInputImagePart = {
  type: 'input_image'
  image_url: string
  /** Carried over from the OpenRouter-style part; optional on the Responses API. */
  detail?: 'low' | 'high' | 'auto'
}
export type ResponsesContentPart =
  ResponsesInputTextPart | ResponsesOutputTextPart | ResponsesInputImagePart

export type ResponsesMessageItem = {
  type: 'message'
  role: 'user' | 'assistant' | 'system' | 'developer'
  content: string | ResponsesContentPart[]
}

export type ResponsesFunctionCallItem = {
  type: 'function_call'
  call_id: string
  name: string
  arguments: string
}

export type ResponsesFunctionCallOutputItem = {
  type: 'function_call_output'
  call_id: string
  output: string
}

export type ResponsesInputItem =
  ResponsesMessageItem | ResponsesFunctionCallItem | ResponsesFunctionCallOutputItem

export type ResponsesTool = {
  type: 'function'
  name: string
  description?: string
  parameters: Record<string, unknown>
}

function toResponseContent(
  content: string | OpenRouterContentPart[] | null | undefined,
): string | ResponsesContentPart[] {
  if (content == null) return ''
  if (typeof content === 'string') return content
  const out: ResponsesContentPart[] = []
  for (const part of content) {
    if (part.type === 'text') {
      if (part.text) out.push({ type: 'input_text', text: part.text })
      continue
    }
    // `input_image` accepts a data URI, which is exactly what the OpenRouter path already builds
    // via toDataImageUri. Part order (images before text) and the optional `detail` hint carry
    // over unchanged.
    if (part.image_url.url) {
      const detail = part.image_url.detail
      out.push({
        type: 'input_image',
        image_url: part.image_url.url,
        ...(detail ? { detail } : {}),
      })
    }
  }
  return out
}

function argsToString(raw: string | Record<string, unknown> | undefined): string {
  if (typeof raw === 'string') return raw.trim() ? raw : '{}'
  if (raw && typeof raw === 'object') return JSON.stringify(raw)
  return '{}'
}

/**
 * Convert Voidcast/OpenAI-style history into Responses `{ instructions, input }`.
 *
 * - `system` messages are joined into the top-level `instructions` string.
 * - `assistant.tool_calls` become standalone `function_call` items.
 * - `tool` messages become `function_call_output` items carrying the matching `call_id`.
 * - assistant text keeps the `output_text` part type the API expects on replay.
 * - reasoning text is dropped: replaying a reasoning item without its encrypted
 *   payload is rejected when `store` is false, and we do not store one.
 *
 * Unlike the Anthropic path there is no same-role merging: the Responses API takes
 * an item list and does not require strict alternation.
 */
export function openRouterMessagesToResponses(messages: OpenRouterMessage[]): {
  instructions: string | undefined
  input: ResponsesInputItem[]
} {
  const systemParts: string[] = []
  const input: ResponsesInputItem[] = []

  for (const m of messages) {
    if (m.role === 'system') {
      if (typeof m.content === 'string' && m.content.trim()) systemParts.push(m.content)
      continue
    }

    if (m.role === 'tool') {
      input.push({
        type: 'function_call_output',
        call_id: m.tool_call_id,
        output: m.content ?? '',
      })
      continue
    }

    if (m.role === 'assistant') {
      const text = typeof m.content === 'string' ? m.content : ''
      if (text.trim()) {
        input.push({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] })
      }
      for (const tc of 'tool_calls' in m ? (m.tool_calls ?? []) : []) {
        if (!tc.function?.name) continue
        input.push({
          type: 'function_call',
          call_id: tc.id || `call_${input.length + 1}`,
          name: tc.function.name,
          arguments: argsToString(tc.function.arguments),
        })
      }
      continue
    }

    // user
    const content = toResponseContent(m.content)
    const hasContent = typeof content === 'string' ? content.length > 0 : content.length > 0
    if (hasContent) input.push({ type: 'message', role: 'user', content })
  }

  return {
    instructions: systemParts.length ? systemParts.join('\n\n') : undefined,
    input,
  }
}

/**
 * OpenAI `tools` array (`{type:'function', function:{name, description, parameters}}`) →
 * Responses `tools` (same fields, flattened, no `function` wrapper).
 *
 * Already-flat tools are accepted too so this stays usable if a caller forwards a
 * Responses-shaped list.
 */
export function openAiToolsToResponses(tools: unknown): ResponsesTool[] | undefined {
  if (!Array.isArray(tools)) return undefined
  const out: ResponsesTool[] = []
  for (const t of tools) {
    if (!t || typeof t !== 'object') continue
    const raw = t as {
      function?: { name?: string; description?: string; parameters?: unknown }
      name?: string
      description?: string
      parameters?: unknown
    }
    const fn = raw.function ?? raw
    if (!fn?.name) continue
    const params =
      fn.parameters && typeof fn.parameters === 'object' && !Array.isArray(fn.parameters)
        ? (fn.parameters as Record<string, unknown>)
        : { type: 'object', properties: {} }
    out.push({
      type: 'function',
      name: fn.name,
      ...(fn.description ? { description: fn.description } : {}),
      parameters: params,
    })
  }
  return out.length ? out : undefined
}

/** Maps the app think level to `reasoning.effort`. null = no reasoning block sent. */
export function responsesReasoningEffort(
  thinkLevel: string | undefined,
): 'low' | 'medium' | 'high' | null {
  if (!thinkLevel || thinkLevel === 'off') return null
  if (thinkLevel === 'low') return 'low'
  if (thinkLevel === 'high') return 'high'
  return 'medium'
}

export function buildResponsesBody(args: {
  model: string
  messages: OpenRouterMessage[]
  tools?: unknown
  maxTokens?: number
  thinkLevel?: string
}): Record<string, unknown> {
  const converted = openRouterMessagesToResponses(args.messages)
  const effort = responsesReasoningEffort(args.thinkLevel)
  const maxOutputTokens =
    typeof args.maxTokens === 'number' && args.maxTokens > 0
      ? Math.floor(args.maxTokens)
      : RESPONSES_DEFAULT_MAX_OUTPUT_TOKENS

  const body: Record<string, unknown> = {
    model: args.model,
    input: converted.input,
    max_output_tokens: maxOutputTokens,
    stream: true,
  }
  if (converted.instructions) body.instructions = converted.instructions
  // `summary: 'auto'` asks the server for readable reasoning summaries; without it
  // reasoning items can be emitted but never surfaced as text.
  if (effort) body.reasoning = { effort, summary: 'auto' }
  const tools = openAiToolsToResponses(args.tools)
  if (tools) body.tools = tools
  // `store` is deliberately NOT sent. The zen/go gateway rejects unknown fields on
  // sibling endpoints, and we always replay the full history anyway, so the
  // server-side copy would never be referenced.
  return body
}

export type ResponsesStreamState = {
  text: string
  reasoning: string
  toolCalls: OpenRouterToolCall[]
  /** `output_index` → slot in `toolCalls` for a streamed `function_call` item. */
  toolSlots: Map<number, number>
  usage?: OpenRouterUsage
  /** Terminal status: 'completed' | 'incomplete' | 'failed'. */
  status?: string
  /** Why an incomplete response stopped (e.g. 'max_output_tokens'). */
  incompleteReason?: string
}

export function createResponsesStreamState(): ResponsesStreamState {
  return { text: '', reasoning: '', toolCalls: [], toolSlots: new Map() }
}

function usageFromResponses(u: {
  input_tokens?: number
  output_tokens?: number
  total_tokens?: number
  input_tokens_details?: { cached_tokens?: number }
}): OpenRouterUsage {
  // Unlike Anthropic, Responses `input_tokens` ALREADY includes the cached tokens,
  // so the cached count is a subset and must not be added on top of it.
  const input = u.input_tokens ?? 0
  const output = u.output_tokens ?? 0
  const cached = u.input_tokens_details?.cached_tokens ?? 0
  return {
    prompt_tokens: input,
    completion_tokens: output,
    total_tokens: typeof u.total_tokens === 'number' ? u.total_tokens : input + output,
    prompt_tokens_details: { cached_tokens: cached, cache_write_tokens: 0 },
  }
}

function responsesErrorMessage(e: Record<string, unknown>): string {
  const err = e.error
  if (typeof err === 'string') return err
  if (err && typeof err === 'object') {
    const msg = (err as { message?: unknown }).message
    if (typeof msg === 'string') return msg
  }
  if (typeof e.message === 'string') return e.message
  return ''
}

/** Resolve (or create) the tool slot for an event carrying `output_index`/`item_id`. */
function toolSlotForEvent(
  state: ResponsesStreamState,
  e: Record<string, unknown>,
): number | undefined {
  if (typeof e.output_index === 'number') {
    const existing = state.toolSlots.get(e.output_index)
    if (existing !== undefined) return existing
    const slot = state.toolCalls.length
    state.toolCalls.push({
      id: `tool_call_${slot + 1}`,
      type: 'function',
      index: slot,
      function: { name: '', arguments: '' },
    })
    state.toolSlots.set(e.output_index, slot)
    return slot
  }
  // Some gateways omit output_index on argument deltas and only send item_id.
  const itemId = typeof e.item_id === 'string' ? e.item_id : ''
  if (itemId) {
    const found = state.toolCalls.findIndex((t) => t.id === itemId)
    if (found >= 0) return found
  }
  return undefined
}

/**
 * Apply one parsed Responses SSE event to the accumulator.
 * Returns which visible streams changed so the caller can fire onDelta / onThinkingDelta.
 * Throws on `error` / `response.failed` events so the caller surfaces the provider message.
 */
export function applyResponsesStreamEvent(
  state: ResponsesStreamState,
  event: unknown,
): { textChanged: boolean; reasoningChanged: boolean } {
  const res = { textChanged: false, reasoningChanged: false }
  if (!event || typeof event !== 'object') return res
  const e = event as Record<string, unknown>
  const type = typeof e.type === 'string' ? e.type : ''

  if (type === 'error') {
    throw new Error(responsesErrorMessage(e) || 'Responses stream error')
  }
  if (type === 'response.failed') {
    const response = e.response as { error?: { message?: string } } | undefined
    throw new Error(
      response?.error?.message || responsesErrorMessage(e) || 'Responses request failed',
    )
  }

  if (type === 'response.output_item.added') {
    const item = e.item as
      { type?: string; call_id?: string; id?: string; name?: string } | undefined
    if (item?.type === 'function_call' && typeof e.output_index === 'number') {
      const slot = toolSlotForEvent(state, e)
      if (slot !== undefined) {
        state.toolCalls[slot].id = item.call_id || item.id || state.toolCalls[slot].id
        if (item.name) state.toolCalls[slot].function.name = item.name
      }
    }
    return res
  }

  // Authoritative close of an item: use it to fill in fields the deltas never sent
  // (name / call_id) and to recover a function call when no deltas arrived at all.
  if (type === 'response.output_item.done') {
    const item = e.item as
      | { type?: string; call_id?: string; id?: string; name?: string; arguments?: string }
      | undefined
    if (item?.type === 'function_call') {
      const slot = toolSlotForEvent(state, e)
      if (slot !== undefined) {
        const call = state.toolCalls[slot]
        call.id = item.call_id || item.id || call.id
        if (item.name) call.function.name = item.name
        if (typeof item.arguments === 'string' && item.arguments) {
          call.function.arguments = item.arguments
        }
      }
    }
    return res
  }

  if (type === 'response.output_text.delta') {
    const delta = typeof e.delta === 'string' ? e.delta : ''
    if (delta) {
      state.text += delta
      res.textChanged = true
    }
    return res
  }

  // `reasoning_summary_text` is what `reasoning.summary: 'auto'` produces;
  // `reasoning_text` is the raw variant some gateways emit instead.
  if (
    type === 'response.reasoning_summary_text.delta' ||
    type === 'response.reasoning_text.delta'
  ) {
    const delta = typeof e.delta === 'string' ? e.delta : ''
    if (delta) {
      state.reasoning += delta
      res.reasoningChanged = true
    }
    return res
  }

  if (type === 'response.function_call_arguments.delta') {
    const delta = typeof e.delta === 'string' ? e.delta : ''
    const slot = toolSlotForEvent(state, e)
    if (delta && slot !== undefined) state.toolCalls[slot].function.arguments += delta
    return res
  }

  if (type === 'response.function_call_arguments.done') {
    const args = typeof e.arguments === 'string' ? e.arguments : ''
    const slot = toolSlotForEvent(state, e)
    if (args && slot !== undefined) state.toolCalls[slot].function.arguments = args
    return res
  }

  if (type === 'response.completed' || type === 'response.incomplete') {
    const response = e.response as
      | {
          usage?: Parameters<typeof usageFromResponses>[0]
          status?: string
          incomplete_details?: { reason?: string }
        }
      | undefined
    if (response?.usage) state.usage = usageFromResponses(response.usage)
    if (response?.status) state.status = response.status
    if (response?.incomplete_details?.reason)
      state.incompleteReason = response.incomplete_details.reason
    return res
  }

  return res
}

/**
 * Fold a non-streaming Responses payload (`{ output: [...] }`) into text /
 * reasoning / tool calls. Used by the sub-agent tool loop, which posts with
 * `stream: false`.
 */
export function parseResponsesOutput(data: unknown): {
  content: string
  reasoning: string
  toolCalls: OpenRouterToolCall[]
} {
  const out = { content: '', reasoning: '', toolCalls: [] as OpenRouterToolCall[] }
  const output = (data as { output?: unknown } | null | undefined)?.output
  if (!Array.isArray(output)) return out

  for (const raw of output) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as Record<string, unknown>
    const type = typeof item.type === 'string' ? item.type : ''

    if (type === 'message') {
      const parts = Array.isArray(item.content) ? item.content : []
      for (const p of parts) {
        if (!p || typeof p !== 'object') continue
        const part = p as { type?: string; text?: string }
        if ((part.type === 'output_text' || part.type === 'text') && part.text)
          out.content += part.text
      }
      continue
    }

    if (type === 'reasoning') {
      const summary = Array.isArray(item.summary) ? item.summary : []
      for (const s of summary) {
        if (!s || typeof s !== 'object') continue
        const part = s as { text?: string }
        if (part.text) out.reasoning += part.text
      }
      continue
    }

    if (type === 'function_call') {
      const name = typeof item.name === 'string' ? item.name : ''
      if (!name) continue
      const args = typeof item.arguments === 'string' ? item.arguments : ''
      out.toolCalls.push({
        id:
          typeof item.call_id === 'string' && item.call_id
            ? item.call_id
            : `tool_call_${out.toolCalls.length + 1}`,
        type: 'function',
        index: out.toolCalls.length,
        function: { name, arguments: args || '{}' },
      })
    }
  }
  return out
}

/** Headers for the Responses endpoint. Auth is Bearer, like chat-completions. */
export function responsesHeaders(options: {
  apiKey: string
  sessionId?: string
  sendAuth: boolean
}): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'voidcast/1.0',
  }
  if (options.sendAuth && options.apiKey.trim()) {
    headers.Authorization = `Bearer ${options.apiKey.trim()}`
  }
  const session = (options.sessionId || '').trim()
  if (session) headers['x-opencode-session'] = session
  return headers
}
