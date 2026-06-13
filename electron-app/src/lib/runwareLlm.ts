import type { OllamaApiMessage } from '@/lib/ollama'
import {
  ollamaMessagesToOpenRouter,
  type OpenRouterContentPart,
  type OpenRouterMessage,
} from '@/lib/openrouter'
import { normalizeBaseUrl, isRunwareMinimaxM3Model, isRunwarePassthroughLlmModel, normalizeRunwareLlmModelId, RUNWARE_LLM_MODEL_DEFAULT, type LlmProvider, type LlmThinkLevel } from '@/lib/settings'

export function isRunwareLlmBaseUrl(baseUrl: string): boolean {
  const root = normalizeBaseUrl(baseUrl || '')
  return root.includes('api.runware.ai') || /\/api\/runware(?:\/|$)/i.test(root)
}

/** Runware OpenAI-compatible endpoint uses snake_case thinking_level (native default is off). */
export function mapLlmThinkLevelToRunware(
  level: LlmThinkLevel | undefined,
  model?: string,
): string {
  const id = model ? normalizeRunwareLlmModelId(model).toLowerCase() : ''
  switch (level) {
    case 'off':
      return 'off'
    case 'low':
      return 'low'
    case 'medium':
      return 'medium'
    case 'high':
      return 'high'
    case 'on':
    default:
      if (id.startsWith('anthropic:claude@')) return 'adaptive'
      return 'high'
  }
}

const EMBEDDED_THINKING_TAG_PATTERNS = [
  /<think>([\s\S]*?)<\/redacted_thinking>/gi,
  new RegExp('<' + 'think' + '>([\\s\\S]*?)<\\/' + 'think' + '>', 'gi'),
]

/** MiniMax M3 leaks thinking into content unless split_thinking is enabled. */
export function splitEmbeddedThinkingTags(text: string): { content: string; thinking: string } {
  let content = text
  const thinkingParts: string[] = []
  for (const pattern of EMBEDDED_THINKING_TAG_PATTERNS) {
    content = content.replace(pattern, (_match, inner: string) => {
      const piece = inner?.trim()
      if (piece) thinkingParts.push(piece)
      return ''
    })
  }
  return {
    content: content.replace(/\n{3,}/g, '\n\n').trim(),
    thinking: thinkingParts.join('\n\n').trim(),
  }
}

export function mergeRunwareThinkingText(streamed: string, embedded: string): string {
  const a = streamed.trim()
  const b = embedded.trim()
  if (!a) return b
  if (!b) return a
  if (a.includes(b) || b.includes(a)) return a.length >= b.length ? a : b
  return `${a}\n\n${b}`
}

export function runwareChatRequestExtras(
  model: string,
  thinkLevel: LlmThinkLevel | undefined,
): Record<string, unknown> {
  const normalizedModel = normalizeRunwareLlmModelId(model)
  const id = normalizedModel.toLowerCase()

  if (isRunwarePassthroughLlmModel(normalizedModel)) {
    const extras: Record<string, unknown> = {}
    // Frontier pass-through rejects several settings.* fields on chat/completions (e.g. GPT + temperature).
    if (
      (id.startsWith('anthropic:') || id.startsWith('google:gemini@')) &&
      thinkLevel !== 'off'
    ) {
      extras.thinking_level = mapLlmThinkLevelToRunware(thinkLevel, normalizedModel)
    }
    return extras
  }

  const extras: Record<string, unknown> = {
    thinking_level: mapLlmThinkLevelToRunware(thinkLevel, normalizedModel),
    stream_options: { include_usage: true },
  }
  if (isRunwareMinimaxM3Model(normalizedModel) && thinkLevel !== 'off') {
    extras.split_thinking = true
  }
  return extras
}

export function shouldUseRunwareHostedChatFormat(
  baseUrl: string,
  provider: LlmProvider | undefined,
  model: string,
): boolean {
  const isRunware = provider === 'runware' || isRunwareLlmBaseUrl(baseUrl)
  if (!isRunware) return false
  return !isRunwarePassthroughLlmModel(model)
}

export function sanitizeRunwareAssistantText(params: {
  rawContent: string
  streamedReasoning: string
  onDelta: (content: string) => void
  onThinkingDelta?: (thinking: string) => void
}): { content: string; reasoning: string } {
  const split = splitEmbeddedThinkingTags(params.rawContent)
  const reasoning = mergeRunwareThinkingText(params.streamedReasoning, split.thinking)
  params.onDelta(split.content)
  if (reasoning) params.onThinkingDelta?.(reasoning)
  return { content: split.content, reasoning }
}

function prependTextToUserMessage(
  message: OpenRouterMessage,
  prefix: string,
): OpenRouterMessage {
  if (message.role !== 'user') return message
  if (typeof message.content === 'string') {
    return { ...message, content: prefix + message.content }
  }
  const parts = [...message.content]
  const textIdx = parts.findIndex((p): p is OpenRouterContentPart & { type: 'text' } => p.type === 'text')
  if (textIdx < 0) {
    return { role: 'user', content: [{ type: 'text', text: prefix }, ...parts] }
  }
  const textPart = parts[textIdx] as { type: 'text'; text: string }
  parts[textIdx] = { ...textPart, text: prefix + textPart.text }
  return { ...message, content: parts }
}

/**
 * Runware's chat bridge does not reliably honor OpenAI `role: system` messages.
 * Fold system instructions (long memory, tools hints, hidden summary) into the first user turn.
 */
export function ollamaMessagesToRunwareChat(messages: OllamaApiMessage[]): OpenRouterMessage[] {
  const systemParts: string[] = []
  const nonSystem: OllamaApiMessage[] = []
  for (const m of messages) {
    if (m.role === 'system') {
      const text = m.content?.trim()
      if (text) systemParts.push(text)
      continue
    }
    nonSystem.push(m)
  }

  const converted = ollamaMessagesToRunwareChatFromNonSystem(nonSystem)
  const systemBlock = systemParts.join('\n\n').trim()
  if (!systemBlock) return converted

  const prefix = `${systemBlock}\n\n---\n\n`
  let injected = false
  const out = converted.map((m) => {
    if (!injected && m.role === 'user') {
      injected = true
      return prependTextToUserMessage(m, prefix)
    }
    return m
  })
  if (!injected) {
    out.unshift({ role: 'user', content: systemBlock })
  }
  return out
}

function ollamaMessagesToRunwareChatFromNonSystem(messages: OllamaApiMessage[]): OpenRouterMessage[] {
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
      const toolCalls = ollamaMessagesToOpenRouter([m])[0]
      const assistant = toolCalls as Extract<OpenRouterMessage, { role: 'assistant' }>
      const reasoning =
        'thinking' in m && typeof (m as { thinking?: string }).thinking === 'string'
          ? (m as { thinking?: string }).thinking?.trim() || undefined
          : undefined
      out.push({
        role: 'assistant',
        content: m.content ?? '',
        ...(assistant.tool_calls?.length ? { tool_calls: assistant.tool_calls } : {}),
        ...(reasoning ? { reasoning, reasoning_content: reasoning } : {}),
      })
      continue
    }
    if (m.role === 'user' && m.images?.length) {
      out.push({
        role: 'user',
        content: [
          { type: 'text', text: m.content || '' },
          ...m.images.map((img) => ({
            type: 'image_url' as const,
            image_url: { url: `data:image/png;base64,${img.replace(/\s+/g, '')}` },
          })),
        ],
      })
      continue
    }
    out.push({ role: m.role, content: m.content })
  }
  return out
}

/**
 * Runware-hosted open models do not reliably honor `role: system`.
 * Pass-through frontier models (Claude, GPT, Gemini) keep standard OpenAI roles.
 */
export function ollamaMessagesToCloudChat(
  messages: OllamaApiMessage[],
  baseUrl: string,
  provider?: LlmProvider,
  model?: string,
): OpenRouterMessage[] {
  const resolvedModel = model?.trim() ? normalizeRunwareLlmModelId(model) : ''
  if (shouldUseRunwareHostedChatFormat(baseUrl, provider, resolvedModel || RUNWARE_LLM_MODEL_DEFAULT)) {
    return ollamaMessagesToRunwareChat(messages)
  }
  return ollamaMessagesToOpenRouter(messages)
}

export function appendRunwareAssistantReasoning(
  message: OpenRouterMessage,
  thinking: string,
): OpenRouterMessage {
  if (message.role !== 'assistant') return message
  const trimmed = thinking.trim()
  if (!trimmed) return message
  return {
    ...message,
    reasoning: trimmed,
    reasoning_content: trimmed,
  }
}
