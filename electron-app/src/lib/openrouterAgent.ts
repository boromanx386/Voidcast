import { buildOllamaToolsList } from '@/lib/toolDefinitions'
import type { ToolsEnabled } from '@/lib/settings'
import type { OllamaApiMessage, OllamaChatUsage, OllamaModelOptions } from '@/lib/ollama'
import type { RunwareImageConfig } from '@/lib/runware'
import {
  ollamaMessagesToOpenRouter,
  streamOpenRouterChat,
  type OpenRouterMessage,
  type OpenRouterToolCall,
} from '@/lib/openrouter'
import { executeToolCall } from '@/lib/ollamaAgent'
import { toolPhaseForAgentTool, type AgentToolUiPhase } from '@/lib/agentToolPhase'

const MAX_TOOL_ROUNDS = 18
const MAX_REQUIRED_TOOL_REPROMPTS = 2

function getLastUserText(messages: OllamaApiMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user') return String(messages[i]?.content || '').trim()
  }
  return ''
}

function shouldRequireToolCall(userText: string, enabled: ToolsEnabled): boolean {
  const t = userText.toLowerCase()
  if (!t) return false
  const hasUrl = /https?:\/\/\S+/i.test(userText)
  const asksImage = /\b(image|picture|draw|render|slika|fotka)\b/i.test(t)
  const asksMusic = /\b(music|song|beat|audio|muzik|pesm|traka)\b/i.test(t)
  const asksPdf = /\b(pdf|export|save as pdf|sacuvaj.*pdf)\b/i.test(t)
  const asksWeb = /\b(search|google|web|online|internet|latest|news|proveri online)\b/i.test(t)
  const asksWeather = /\b(weather|forecast|temperature|temperatura|vreme)\b/i.test(t)
  const asksYoutube = /\b(youtube|video|transcript|caption)\b/i.test(t)
  const asksScrape = hasUrl && /\b(scrape|extract|summarize|procitaj|izvuci)\b/i.test(t)
  const asksCoding = /\b(list|read|write|edit|search|glob|git|command|terminal|fajl|folder)\b/i.test(t)
  const asksSettings = /\b(change|set|update|podesi|promeni)\b/i.test(t) &&
    /\b(setting|temperature|context|theme|model|rezoluc|prompt)\b/i.test(t)
  return (
    (enabled.runwareImage && asksImage) ||
    (enabled.runwareMusic && asksMusic) ||
    (enabled.pdf && asksPdf) ||
    (enabled.webSearch && asksWeb) ||
    (enabled.weather && asksWeather) ||
    (enabled.youtube && asksYoutube) ||
    (enabled.scrape && asksScrape) ||
    (enabled.coding && asksCoding) ||
    asksSettings
  )
}

function parseToolArguments(raw: string | undefined): Record<string, unknown> {
  if (!raw?.trim()) return {}
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return {}
  }
}

function toOpenRouterToolCalls(calls: OpenRouterToolCall[]): OpenRouterToolCall[] {
  return calls
    .filter((t) => t.function?.name)
    .map((t, idx) => ({
      id: t.id || `tool_call_${idx + 1}`,
      type: 'function',
      index: t.index ?? idx,
      function: {
        name: t.function.name,
        arguments: t.function.arguments || '{}',
      },
    }))
}

function toDataImageUri(base64: string, mime: string): string {
  const safeMime = /^image\/[a-z0-9.+-]+$/i.test(mime) ? mime : 'image/png'
  return `data:${safeMime};base64,${base64.replace(/\s+/g, '')}`
}

export type RunOpenRouterChatWithToolsParams = {
  baseUrl: string
  apiKey: string
  model: string
  initialMessages: OllamaApiMessage[]
  modelOptions?: OllamaModelOptions
  toolsEnabled: ToolsEnabled
  ttsBaseUrl: string
  signal?: AbortSignal
  onDelta: (fullText: string) => void
  onThinkingDelta?: (fullReasoning: string) => void
  onToolPhase?: (phase: AgentToolUiPhase | null) => void
  pdfOutputDir?: string
  onToolResult?: (payload: { name: string; result: string; args?: Record<string, unknown> }) => void
  runware?: RunwareImageConfig
  userImages?: string[]
  userImageMimes?: string[]
  userImagePaths?: string[]
  codingProjectPath?: string
}

export async function runOpenRouterChatWithTools(
  params: RunOpenRouterChatWithToolsParams,
): Promise<{ content: string; usage?: OllamaChatUsage }> {
  const tools = buildOllamaToolsList(params.toolsEnabled)
  if (tools.length === 0) throw new Error('runOpenRouterChatWithTools called with no tools enabled')

  const messages: OpenRouterMessage[] = ollamaMessagesToOpenRouter(params.initialMessages)
  let lastAssistantText = ''
  let persistedAssistantPrefix = ''
  let persistedThinkingPrefix = ''
  let lastUsage: OllamaChatUsage | undefined
  const runtimeRecalledImages: Array<{ base64: string; mime: string }> = []
  const originalUserText = getLastUserText(params.initialMessages)
  const mustCallTool = shouldRequireToolCall(originalUserText, params.toolsEnabled)
  let requiredToolRepromptCount = 0
  let hasExecutedToolInTurn = false

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    if (params.signal?.aborted) {
      const err = new Error('Aborted')
      err.name = 'AbortError'
      throw err
    }
    const { content, tool_calls, usage, reasoning } = await streamOpenRouterChat({
      baseUrl: params.baseUrl,
      apiKey: params.apiKey,
      model: params.model,
      messages,
      modelOptions: params.modelOptions,
      tools,
      signal: params.signal,
      onDelta: (full) => {
        const combined = `${persistedAssistantPrefix}${full}`
        lastAssistantText = combined
        params.onDelta(combined)
      },
      onThinkingDelta: (fullRound) => {
        const combined = `${persistedThinkingPrefix}${fullRound}`
        params.onThinkingDelta?.(combined)
      },
    })
    lastUsage = usage ?? lastUsage

    const validCalls = tool_calls.filter((t) => t.function?.name)
    if (validCalls.length === 0) {
      if (mustCallTool && !hasExecutedToolInTurn && requiredToolRepromptCount < MAX_REQUIRED_TOOL_REPROMPTS) {
        requiredToolRepromptCount += 1
        messages.push({
          role: 'user',
          content:
            'Tool call required: do not answer with plain text. Call the appropriate available tool now and only then provide the final answer from real tool output.',
        })
        persistedAssistantPrefix = lastAssistantText
        if (persistedAssistantPrefix.trim() && !persistedAssistantPrefix.endsWith('\n\n')) {
          persistedAssistantPrefix = `${persistedAssistantPrefix.trimEnd()}\n\n`
        }
        if (reasoning.trim()) {
          persistedThinkingPrefix += `${reasoning.trim()}\n\n---\n\n`
        }
        continue
      }
      if (mustCallTool && !hasExecutedToolInTurn) {
        throw new Error('Tool-required request was answered without invoking any tool.')
      }
      return { content: lastAssistantText || content, usage: lastUsage }
    }

    messages.push({
      role: 'assistant',
      content: content ?? '',
      ...(reasoning.trim() ? { reasoning: reasoning.trim() } : {}),
      tool_calls: toOpenRouterToolCalls(validCalls),
    })

    for (const call of validCalls) {
      const name = call.function.name
      params.onToolPhase?.(toolPhaseForAgentTool(name))

      const argsObj = parseToolArguments(call.function.arguments)
      const result = await executeToolCall(
        name,
        argsObj,
        params.toolsEnabled,
        {
          ttsBaseUrl: params.ttsBaseUrl,
          signal: params.signal,
          pdfOutputDir: params.pdfOutputDir,
          runware: params.runware,
          userImages: params.userImages,
          userImageMimes: params.userImageMimes,
          userImagePaths: params.userImagePaths,
          codingProjectPath: params.codingProjectPath,
        },
      )

      messages.push({
        role: 'tool',
        tool_call_id: call.id || `tool_call_${name}_${round}`,
        name,
        content: result,
      })
      hasExecutedToolInTurn = true
      params.onToolResult?.({ name, result, args: argsObj })

      if (name === 'image_recall') {
        let parsed: unknown
        try {
          parsed = JSON.parse(result)
        } catch {
          parsed = null
        }
        const payload = parsed as {
          recalled_images?: Array<{ index: number; mime: string }>
        } | null
        if (payload?.recalled_images?.length) {
          for (const ref of payload.recalled_images) {
            const oneBased = Math.round(ref.index) - 1
            if (oneBased < 0) continue
            const base64 = params.userImages?.[oneBased]
            if (!base64) continue
            runtimeRecalledImages.push({ base64, mime: ref.mime || 'image/png' })
          }
        }
      }
    }

    if (runtimeRecalledImages.length > 0) {
      const consumed = runtimeRecalledImages.splice(0, runtimeRecalledImages.length)
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: 'Image recall payload for current turn.' },
          ...consumed.map((x) => ({ type: 'image_url' as const, image_url: { url: toDataImageUri(x.base64, x.mime) } })),
        ],
      })
    }

    params.onToolPhase?.(null)
    persistedAssistantPrefix = lastAssistantText
    if (persistedAssistantPrefix.trim() && !persistedAssistantPrefix.endsWith('\n\n')) {
      persistedAssistantPrefix = `${persistedAssistantPrefix.trimEnd()}\n\n`
    }
    if (reasoning.trim()) {
      persistedThinkingPrefix += `${reasoning.trim()}\n\n---\n\n`
    }
  }

  return { content: lastAssistantText, usage: lastUsage }
}
