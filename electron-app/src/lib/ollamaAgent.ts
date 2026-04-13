import { normalizeBaseUrl } from '@/lib/settings'
import type { ToolsEnabled } from '@/lib/settings'
import { buildOllamaToolsList } from '@/lib/toolDefinitions'
import { invokeWebSearch } from '@/lib/webSearch'
import { invokeGetWeather } from '@/lib/weather'
import { invokeScrapeUrl } from '@/lib/scrapeUrl'
import { invokeSavePdf } from '@/lib/savePdf'
import { invokeYoutubeTool } from '@/lib/youtubeTool'
import type {
  OllamaApiMessage,
  OllamaChatUsage,
  OllamaModelOptions,
  OllamaToolCall,
} from '@/lib/ollama'
import { mergeOllamaUsage, parseChatStreamUsage } from '@/lib/ollama'

const MAX_TOOL_ROUNDS = 5

function compactModelOptions(
  o: OllamaModelOptions | undefined,
): Record<string, number> | undefined {
  if (!o) return undefined
  const out: Record<string, number> = {}
  if (o.temperature !== undefined) out.temperature = o.temperature
  if (o.num_ctx !== undefined) out.num_ctx = o.num_ctx
  return Object.keys(out).length ? out : undefined
}

/** Merge streaming tool_call fragments (by index) into accumulated array */
function mergeToolCallDeltas(
  acc: OllamaToolCall[],
  incoming: OllamaToolCall[] | undefined,
): void {
  if (!incoming?.length) return
  for (const delta of incoming) {
    const idx =
      typeof delta.index === 'number'
        ? delta.index
        : Math.max(0, acc.length - 1)
    while (acc.length <= idx) {
      acc.push({ function: {} })
    }
    const cur = acc[idx]
    if (!cur.function) cur.function = {}
    if (delta.function?.name) cur.function.name = delta.function.name
    if (delta.function?.arguments != null) {
      const arg = delta.function.arguments
      if (typeof arg === 'object' && arg !== null && !Array.isArray(arg)) {
        cur.function.arguments = JSON.stringify(arg)
      } else {
        cur.function.arguments =
          (typeof cur.function.arguments === 'string' ? cur.function.arguments : '') +
          String(arg)
      }
    }
    if (delta.id) cur.id = delta.id
    if (delta.type) cur.type = delta.type
    if (typeof delta.index === 'number') cur.index = delta.index
  }
}

function parseToolArguments(raw: string | undefined): Record<string, unknown> {
  if (!raw?.trim()) return {}
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return {}
  }
}

/**
 * Ollama expects `tool_calls[].function.arguments` as a JSON **object** in the
 * request body. After streaming, arguments are often a string; replaying that
 * string breaks the server parser ("can't find closing '}' symbol").
 */
function argumentsStringToObject(
  raw: string | Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (raw == null) return {}
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>
  }
  const s = String(raw).trim()
  if (!s) return {}
  try {
    const v = JSON.parse(s) as unknown
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return v as Record<string, unknown>
    }
  } catch {
    /* incomplete or invalid JSON from stream */
  }
  return {}
}

function normalizeToolCallsForReplay(calls: OllamaToolCall[]): OllamaToolCall[] {
  return calls
    .filter((t) => t.function?.name)
    .map((tc) => ({
      id: tc.id,
      type: 'function' as const,
      index: tc.index,
      function: {
        name: tc.function!.name,
        arguments: argumentsStringToObject(tc.function!.arguments),
      },
    }))
}

async function executeToolCall(
  name: string,
  argsJson: string | Record<string, unknown> | undefined,
  toolsEnabled: ToolsEnabled,
  ctx: {
    ttsBaseUrl: string
    signal?: AbortSignal
    /** Required for save_pdf when the tool is enabled */
    pdfOutputDir?: string
  },
): Promise<string> {
  const args =
    typeof argsJson === 'string'
      ? parseToolArguments(argsJson)
      : (argsJson as Record<string, unknown>) ?? {}
  if (name === 'web_search') {
    if (!toolsEnabled.webSearch) {
      return 'Error: web_search tool is disabled in settings.'
    }
    const q = typeof args.query === 'string' ? args.query.trim() : ''
    if (!q) return 'Error: missing query parameter for web_search.'
    try {
      return await invokeWebSearch(q, ctx.ttsBaseUrl, ctx.signal)
    } catch (e) {
      return e instanceof Error ? e.message : String(e)
    }
  }
  if (name === 'search_youtube') {
    if (!toolsEnabled.youtube) {
      return 'Error: search_youtube tool is disabled in settings.'
    }
    const query = typeof args.query === 'string' ? args.query.trim() : ''
    const videoUrl =
      typeof args.video_url === 'string' ? args.video_url.trim() : ''
    if (!query && !videoUrl) {
      return 'Error: provide query (search) or video_url (video details / transcript).'
    }
    const getTranscript = Boolean(args.get_transcript)
    const maxRaw = args.max_results
    const maxResults =
      typeof maxRaw === 'number' && Number.isFinite(maxRaw)
        ? Math.min(20, Math.max(1, Math.round(maxRaw)))
        : undefined
    try {
      return await invokeYoutubeTool(
        {
          query: query || undefined,
          video_url: videoUrl || undefined,
          get_transcript: getTranscript,
          max_results: maxResults,
        },
        ctx.ttsBaseUrl,
        ctx.signal,
      )
    } catch (e) {
      return e instanceof Error ? e.message : String(e)
    }
  }
  if (name === 'get_weather') {
    if (!toolsEnabled.weather) {
      return 'Error: get_weather tool is disabled in settings.'
    }
    const city = typeof args.city === 'string' ? args.city.trim() : ''
    if (!city) return 'Error: missing city parameter for get_weather.'
    const forecast = Boolean(args.forecast)
    try {
      return await invokeGetWeather(city, forecast, ctx.signal)
    } catch (e) {
      return e instanceof Error ? e.message : String(e)
    }
  }
  if (name === 'scrape_url') {
    if (!toolsEnabled.scrape) {
      return 'Error: scrape_url tool is disabled in settings.'
    }
    const url = typeof args.url === 'string' ? args.url.trim() : ''
    if (!url) return 'Error: missing url parameter for scrape_url.'
    const maxChars =
      typeof args.max_chars === 'number' && Number.isFinite(args.max_chars)
        ? args.max_chars
        : undefined
    try {
      return await invokeScrapeUrl(url, maxChars)
    } catch (e) {
      return e instanceof Error ? e.message : String(e)
    }
  }
  if (name === 'save_pdf') {
    if (!toolsEnabled.pdf) {
      return 'Error: save_pdf tool is disabled in settings.'
    }
    const dir = ctx.pdfOutputDir?.trim() ?? ''
    if (!dir) {
      return 'Error: set a PDF output folder in Options → Tools (under Save as PDF).'
    }
    const content = typeof args.content === 'string' ? args.content : ''
    if (!content.trim()) return 'Error: missing or empty content for save_pdf.'
    const title = typeof args.title === 'string' ? args.title : undefined
    const filename = typeof args.filename === 'string' ? args.filename : undefined
    try {
      return await invokeSavePdf({ content, title, filename, outputDir: dir })
    } catch (e) {
      return e instanceof Error ? e.message : String(e)
    }
  }
  return `Error: unknown tool "${name}".`
}

/**
 * One streaming /api/chat round; accumulates assistant content and tool_calls.
 */
export async function streamOllamaChatOnce(options: {
  baseUrl: string
  model: string
  messages: OllamaApiMessage[]
  modelOptions?: OllamaModelOptions
  tools: unknown[] | undefined
  signal?: AbortSignal
  onDelta: (fullText: string) => void
}): Promise<{ content: string; tool_calls: OllamaToolCall[]; usage?: OllamaChatUsage }> {
  const root = normalizeBaseUrl(options.baseUrl)
  const opts = compactModelOptions(options.modelOptions)
  const body: Record<string, unknown> = {
    model: options.model,
    messages: options.messages,
    stream: true,
  }
  if (opts) body.options = opts
  if (options.tools !== undefined && options.tools.length > 0) {
    body.tools = options.tools
  }

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
  let fullContent = ''
  const toolCalls: OllamaToolCall[] = []
  let usage: OllamaChatUsage | undefined

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
        message?: {
          content?: string
          tool_calls?: OllamaToolCall[]
        }
        error?: string
      }
      if (chunk.error) throw new Error(chunk.error)
      usage = mergeOllamaUsage(usage, parseChatStreamUsage(obj))
      const msg = chunk.message
      if (msg?.tool_calls?.length) {
        mergeToolCallDeltas(toolCalls, msg.tool_calls)
      }
      const piece = msg?.content
      if (piece) {
        fullContent += piece
        options.onDelta(fullContent)
      }
    }
  }
  const tail = buffer.trim()
  if (tail) {
    try {
      const last = JSON.parse(tail) as {
        message?: {
          content?: string
          tool_calls?: OllamaToolCall[]
        }
        error?: string
      }
      if (last.error) throw new Error(last.error)
      usage = mergeOllamaUsage(usage, parseChatStreamUsage(last))
      if (last.message?.tool_calls?.length) {
        mergeToolCallDeltas(toolCalls, last.message.tool_calls)
      }
      const piece = last.message?.content
      if (piece) {
        fullContent += piece
        options.onDelta(fullContent)
      }
    } catch {
      /* ignore */
    }
  }

  return {
    content: fullContent,
    tool_calls: toolCalls.filter((t) => Boolean(t.function?.name)),
    usage,
  }
}

export type RunChatWithToolsParams = {
  baseUrl: string
  model: string
  initialMessages: OllamaApiMessage[]
  modelOptions?: OllamaModelOptions
  toolsEnabled: ToolsEnabled
  /** Same host as TTS; used for `POST /tools/search` (DDGS). */
  ttsBaseUrl: string
  signal?: AbortSignal
  onDelta: (fullText: string) => void
  /** Called when a tool phase starts; pass null to clear (e.g. before next model stream). */
  onToolPhase?: (
    phase:
      | 'search'
      | 'youtube'
      | 'weather'
      | 'scrape'
      | 'pdf'
      | 'other'
      | null,
  ) => void
  /** Folder for `save_pdf` (from app settings). */
  pdfOutputDir?: string
  /** After each tool runs; use to show real outcomes (e.g. PDF path) in the UI. */
  onToolResult?: (payload: { name: string; result: string }) => void
}

/**
 * Agent loop: stream, run tools, append tool messages, repeat until text reply or cap.
 */
export async function runOllamaChatWithTools(
  params: RunChatWithToolsParams,
): Promise<{ content: string; usage?: OllamaChatUsage }> {
  const tools = buildOllamaToolsList(params.toolsEnabled)
  if (tools.length === 0) {
    throw new Error('runOllamaChatWithTools called with no tools enabled')
  }

  const messages: OllamaApiMessage[] = [...params.initialMessages]
  let lastAssistantText = ''
  let lastUsage: OllamaChatUsage | undefined

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    if (params.signal?.aborted) {
      const err = new Error('Aborted')
      err.name = 'AbortError'
      throw err
    }

    const { content, tool_calls, usage } = await streamOllamaChatOnce({
      baseUrl: params.baseUrl,
      model: params.model,
      messages,
      modelOptions: params.modelOptions,
      tools,
      signal: params.signal,
      onDelta: (full) => {
        lastAssistantText = full
        params.onDelta(full)
      },
    })
    lastUsage = mergeOllamaUsage(lastUsage, usage)

    const validCalls = tool_calls.filter((t) => t.function?.name)
    if (validCalls.length === 0) {
      return { content, usage: lastUsage }
    }

    messages.push({
      role: 'assistant',
      content: content ?? '',
      tool_calls: normalizeToolCallsForReplay(validCalls),
    })

    for (const call of validCalls) {
      const name = call.function!.name!
      if (name === 'web_search') params.onToolPhase?.('search')
      else if (name === 'search_youtube') params.onToolPhase?.('youtube')
      else if (name === 'get_weather') params.onToolPhase?.('weather')
      else if (name === 'scrape_url') params.onToolPhase?.('scrape')
      else if (name === 'save_pdf') params.onToolPhase?.('pdf')
      else params.onToolPhase?.('other')

      const result = await executeToolCall(
        name,
        call.function!.arguments,
        params.toolsEnabled,
        {
          ttsBaseUrl: params.ttsBaseUrl,
          signal: params.signal,
          pdfOutputDir: params.pdfOutputDir,
        },
      )
      messages.push({
        role: 'tool',
        tool_name: name,
        content: result,
      })
      params.onToolResult?.({ name, result })
    }

    params.onToolPhase?.(null)
    lastAssistantText = ''
    params.onDelta('')
  }

  return { content: lastAssistantText, usage: lastUsage }
}
