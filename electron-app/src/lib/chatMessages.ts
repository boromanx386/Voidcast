import type { OllamaApiMessage } from '@/lib/ollama'

export type HistoryTurn = { role: 'user' | 'assistant'; content: string }

/**
 * Build Ollama messages: optional system, trimmed history, new user turn.
 * `maxHistoryMessages` = 0 means no limit (all prior messages).
 */
/** When Web search tool is enabled */
export const TOOLS_WEB_SEARCH_HINT = `You have a web_search tool. When the user asks for current news, recent facts, or anything that needs up-to-date information from the internet, you MUST call web_search with a short query string, then answer based on the tool results (cite or summarize). Do not refuse to search when it is needed.`

/** When Weather tool is enabled */
export const TOOLS_WEATHER_HINT = `You have a get_weather tool. When the user asks about weather, temperature, or forecast for a place, call get_weather with the city name (and forecast: true if they want several days). Answer in natural language using the tool output.`

/** When Scrape URL tool is enabled */
export const TOOLS_SCRAPE_HINT = `You have a scrape_url tool. When the user pastes a link or wants the text of a specific public web page (article, docs, news), call scrape_url with the full http(s) URL. Summarize or quote from the returned text. Do not use scrape for local or private URLs.`

/** When Save PDF tool is enabled */
export const TOOLS_PDF_HINT = `You have a save_pdf tool. When the user asks to save as PDF or export to PDF, call save_pdf with the full text in content and optional title/filename. The file is written to the folder they configured in app options (no dialog).`

/** When any tools are enabled — reduces false claims about tool execution */
export const TOOLS_TRUTH_HINT = `Never claim you saved a file, searched the web, or ran a tool unless you actually invoked that tool in this turn and received its result message. If you show sample or fictional data, say clearly it is illustrative only — do not imply it was exported to a real file.`

/** @deprecated use TOOLS_WEB_SEARCH_HINT */
export const TOOLS_SYSTEM_HINT = TOOLS_WEB_SEARCH_HINT

export function buildOllamaMessages(
  priorMessages: HistoryTurn[],
  newUserContent: string,
  opts: {
    systemPrompt: string
    maxHistoryMessages: number
    /** Merged after user system prompt when tools are on */
    toolsSystemHint?: string
  },
): OllamaApiMessage[] {
  const max = opts.maxHistoryMessages
  const slice =
    max > 0 && priorMessages.length > max
      ? priorMessages.slice(-max)
      : priorMessages

  const out: OllamaApiMessage[] = []
  const hint = opts.toolsSystemHint?.trim()
  const base = opts.systemPrompt.trim()
  const sys = [base, hint].filter(Boolean).join('\n\n')
  if (sys) {
    out.push({ role: 'system', content: sys })
  }
  for (const m of slice) {
    out.push({ role: m.role, content: m.content })
  }
  out.push({ role: 'user', content: newUserContent })
  return out
}
