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

const MAX_TOOL_ROUNDS = 18

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
  onToolPhase?: (
    phase:
      | 'search'
      | 'youtube'
      | 'weather'
      | 'scrape'
      | 'pdf'
      | 'image'
      | 'music'
      | 'coding'
      | 'other'
      | null,
  ) => void
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
  let lastUsage: OllamaChatUsage | undefined
  const runtimeRecalledImages: Array<{ base64: string; mime: string }> = []

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    if (params.signal?.aborted) {
      const err = new Error('Aborted')
      err.name = 'AbortError'
      throw err
    }
    const { content, tool_calls, usage } = await streamOpenRouterChat({
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
    })
    lastUsage = usage ?? lastUsage

    const validCalls = tool_calls.filter((t) => t.function?.name)
    if (validCalls.length === 0) {
      return { content: lastAssistantText || content, usage: lastUsage }
    }

    messages.push({
      role: 'assistant',
      content: content ?? '',
      tool_calls: toOpenRouterToolCalls(validCalls),
    })

    for (const call of validCalls) {
      const name = call.function.name
      if (name === 'web_search') params.onToolPhase?.('search')
      else if (name === 'search_youtube') params.onToolPhase?.('youtube')
      else if (name === 'get_weather') params.onToolPhase?.('weather')
      else if (name === 'scrape_url') params.onToolPhase?.('scrape')
      else if (name === 'save_pdf') params.onToolPhase?.('pdf')
      else if (name === 'generate_image' || name === 'edit_image_runware' || name === 'image_recall') params.onToolPhase?.('image')
      else if (name === 'generate_music_runware') params.onToolPhase?.('music')
      else if (name === 'list_directory' || name === 'read_file' || name === 'write_file' || name === 'edit_code' || name === 'search_files' || name === 'execute_command') params.onToolPhase?.('coding')
      else params.onToolPhase?.('other')

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
  }

  return { content: lastAssistantText, usage: lastUsage }
}
