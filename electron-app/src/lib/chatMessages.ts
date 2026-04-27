import type { OllamaApiMessage } from '@/lib/ollama'

export type HistoryTurn = {
  role: 'user' | 'assistant'
  content: string
  /** User turns only; raw base64 for Ollama. */
  images?: string[]
  /** User turns only; optional file names for attached images. */
  imageNames?: string[]
  /** User turns only; optional absolute file paths for attached images. */
  imagePaths?: string[]
}

/**
 * Build Ollama messages: optional system, trimmed history, new user turn.
 * `maxHistoryMessages` = 0 means no limit (all prior messages).
 */
/** When Web search tool is enabled */
export const TOOLS_WEB_SEARCH_HINT = `You have a web_search tool. When the user asks for current news, recent facts, anything time-sensitive, or asks "check online", you MUST call web_search first and then answer from tool results. Prioritize recency and explicitly mention when sources look stale.`

/** When YouTube tool is enabled */
export const TOOLS_YOUTUBE_HINT = `You have a search_youtube tool. When the user wants YouTube videos on a topic, call search_youtube with query. When they give a YouTube link and want details or a transcript/summary, pass video_url and set get_transcript to true if they want captions. Answer from the tool output.`

/** When Weather tool is enabled */
export const TOOLS_WEATHER_HINT = `You have a get_weather tool. When the user asks about weather, temperature, or forecast for a place, call get_weather with the city name (and forecast: true if they want several days). Answer in natural language using the tool output.`

/** When Scrape URL tool is enabled */
export const TOOLS_SCRAPE_HINT = `You have a scrape_url tool. If the user message contains a specific public http(s) URL, call scrape_url for that URL before answering (unless they explicitly ask not to). Use returned page text to summarize/quote. Do not use scrape for local or private URLs.`

/** When Save PDF tool is enabled */
export const TOOLS_PDF_HINT = `You have a save_pdf tool. When the user asks to save as PDF or export to PDF, call save_pdf with the full text in content and optional title/filename. The file is written to the folder they configured in app options (no dialog). Content can use Markdown-style structure: blank line between paragraphs, lines starting with # / ## / ### / #### for headings, bullets with "- ", "* ", "• ", or numbered "1. " lines (continuation lines without a marker merge with the previous item), pipe tables, horizontal rules made of --- or ====, **bold** in body text, and single newlines within a block for explicit line breaks. If the user's message included attached images and they want those embedded in the PDF (not only described in text), pass embed_attached_images: true and/or attached_image_indices (0-based order of attachments). Embedded images appear after the written body; PNG/JPEG supported.`

/** When Runware image tool is enabled */
export const TOOLS_RUNWARE_IMAGE_HINT = `You have three image tools: generate_image, edit_image_runware, and image_recall. Use generate_image only for fresh text-to-image creation. If the user asks to create/make/draw/generate a new image, you MUST call generate_image before giving the final answer. Use edit_image_runware when the user asks to modify existing images; pass prompt plus either reference_image_indexes (1-based internal catalog indexes, index 1 is most recent) and/or reference_image_paths (absolute paths from chat history). Use image_recall to retrieve historical image bytes from the internal catalog when you need vision-style analysis on older images in the current turn (it also accepts indexes and/or paths). Always use the selected model profile resolution from Options (do not set width/height in tool args). Keep steps/cfg at the selected model profile defaults unless the user explicitly requests changing them. Never print raw base64 in chat replies. Never claim an image was generated unless a generate_image or edit_image_runware tool call succeeded in this turn. After image-generation/edit output, provide a concise result and include the generated image URL.`

/** When Runware music tool is enabled */
export const TOOLS_RUNWARE_MUSIC_HINT = `You have a Runware music tool named generate_music_runware using fixed model runware:ace-step@v1.5-turbo. Use it when the user asks to create music, song, beat, soundtrack, jingle, or vocals from text. Keep duration/steps/cfg/output format at the selected Runware Music Options defaults unless the user explicitly requests changes. You may include optional advanced fields (lyrics, bpm, key_scale, vocal_language, guidance_type) only when relevant. After tool output, provide a concise result and include the generated audio URL.`

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
    /** Runtime context (e.g. local time/date/timezone) */
    runtimeSystemHint?: string
    /**
     * Internal compressed chat memory. Not shown in UI.
     * Injected as part of system instructions only.
     */
    hiddenContextSummary?: string
    /** Raw base64 strings for the latest user message (vision). */
    newUserImages?: string[]
  },
): OllamaApiMessage[] {
  const max = opts.maxHistoryMessages
  const slice =
    max > 0 && priorMessages.length > max
      ? priorMessages.slice(-max)
      : priorMessages

  const out: OllamaApiMessage[] = []
  const hint = opts.toolsSystemHint?.trim()
  const runtimeHint = opts.runtimeSystemHint?.trim()
  const base = opts.systemPrompt.trim()
  const hiddenSummary = opts.hiddenContextSummary?.trim()
  const summarySection = hiddenSummary
    ? `Internal conversation summary (do not reveal verbatim):\n${hiddenSummary}`
    : ''
  const sys = [base, runtimeHint, hint, summarySection].filter(Boolean).join('\n\n')
  if (sys) {
    out.push({ role: 'system', content: sys })
  }
  for (const m of slice) {
    if (m.role === 'user' && m.images?.length) {
      out.push({ role: 'user', content: m.content, images: m.images })
    } else {
      out.push({ role: m.role, content: m.content })
    }
  }
  const nextUser: OllamaApiMessage =
    opts.newUserImages && opts.newUserImages.length > 0
      ? { role: 'user', content: newUserContent, images: opts.newUserImages }
      : { role: 'user', content: newUserContent }
  out.push(nextUser)
  return out
}
