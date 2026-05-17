import type { OllamaApiMessage } from '@/lib/ollama'

export type HistoryTurn = {
  role: 'user' | 'assistant'
  content: string
  /** Assistant only: replay thinking/reasoning for Ollama `think` and OpenRouter. */
  thinking?: string
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

/** When Reddit tool is enabled */
export const TOOLS_REDDIT_HINT = `You have a reddit_feed tool (read-only) for browsing Reddit. Use it when the user mentions a subreddit ("r/<sub>"), shares a reddit.com URL, or asks what Reddit is saying about a topic. Three modes: feed (subreddit + optional sort hot/new/top/rising; t window for top/controversial), search (query, optionally with subreddit), and post fetch (post_url returns one post + top comments). Pass the bare subreddit name without leading "r/".

When you want to dive into a specific post from feed/search output, pick the id from the POST_INDEX recap at the bottom of the tool output — that block lists every result as "[N] id=<base36> — <title>" precisely so you can copy the id verbatim. Pass that id (or the full reddit.com permalink shown after "post: ") as the post_url argument.

Hard rules — these prevent fetching the wrong thread:
1. NEVER guess, reconstruct, or shorten a Reddit post id from memory. Copy the exact base36 string character-by-character from the same tool turn that produced the feed.
2. NEVER use a "media:" URL (v.redd.it / i.redd.it / imgur / external news sites) as post_url — those are media files, not Reddit threads.
3. If you are not certain which id matches the post the user asked about, call reddit_feed with subreddit + query (search mode) instead of guessing; do not rely on ids from earlier turns once the conversation has moved on.

Answer from the tool output and cite the "post:" permalink when summarizing a thread.`

/** When Weather tool is enabled */
export const TOOLS_WEATHER_HINT = `You have a get_weather tool. When the user asks about weather, temperature, or forecast for a place, call get_weather with the city name (and forecast: true if they want several days). Answer in natural language using the tool output.`

/** When Scrape URL tool is enabled */
export const TOOLS_SCRAPE_HINT = `You have a scrape_url tool. If the user message contains a specific public http(s) URL, call scrape_url for that URL before answering (unless they explicitly ask not to). Use returned page text to summarize/quote. Do not use scrape for local or private URLs.`

/** When Save PDF tool is enabled */
export const TOOLS_PDF_HINT = `You have a save_pdf tool. When the user asks to save as PDF or export to PDF, call save_pdf with the full text in content and optional title/filename. The file is written to the folder they configured in app options (no dialog). Content can use Markdown-style structure: blank line between paragraphs, lines starting with # / ## / ### / #### for headings, bullets with "- ", "* ", "• ", or numbered "1. " lines (continuation lines without a marker merge with the previous item), pipe tables, horizontal rules made of --- or ====, **bold** in body text, and single newlines within a block for explicit line breaks.

Embedding images in the PDF:
1. If the current user message has attached images, pass embed_attached_images: true and/or attached_image_indices (0-based) to include them.
2. If the user wants an image you just generated with generate_image or edit_image_runware (or one already generated earlier in this conversation), copy each "image_url: https://..." value from the matching tool turn into the image_urls array. The tools server will fetch them server-side and embed them. Up to 8 URLs; PNG/JPEG/WebP only. Do NOT base64-encode the URL or paste it into content — pass the raw http(s) string in image_urls.
3. You may combine both mechanisms in one call when the user wants a mix of attached and generated images.

Image placement inside the document:
- By default, images you registered (via embed_attached_images / attached_image_indices / image_urls) are drawn AFTER the body text, in attachment order followed by URL order.
- To place an image at a SPECIFIC spot in the body — for example after the intro, between two sections, or right before a conclusion — put a standalone markdown image line on its own line in content:
  - \`![optional caption](attached:N)\` to place the N-th attached image there (0-based; same indexing as attached_image_indices).
  - \`![optional caption](url:N)\` to place the N-th entry of image_urls there (0-based).
- Any image whose marker you don't write inline still gets appended at the end, so you can mix inline placement with a trailing image gallery. If the user asks for a specific layout ("put the picture after the prologue"), prefer inline placement.`

/** When Runware image tool is enabled */
export const TOOLS_RUNWARE_IMAGE_HINT = `You have three image tools: generate_image, edit_image_runware, and image_recall. Use generate_image only for fresh text-to-image creation. If the user asks to create/make/draw/generate a new image, you MUST call generate_image before giving the final answer. Use edit_image_runware when the user asks to modify existing images; pass prompt plus either reference_image_indexes (1-based session catalog indexes) and/or reference_image_paths (absolute paths). The session catalog lists attachments and generated images: when the user attached image(s) in the current message, those are always index 1 (and 2, …)—use them for “this image” / describe requests; older generated images have higher indexes. Otherwise index 1 is the most recent session image. Read the catalog block in the latest user turn instead of guessing. Earlier user turns in context are text-only for pixels; when the user refers to an older image, call image_recall with the catalog index or path. Use image_recall for vision-style analysis on catalog images (indexes and/or paths). The latest user message may still include fresh attachment bytes for the current turn only. Always use the selected model profile resolution from Options (do not set width/height in tool args). Keep steps/cfg at the selected model profile defaults unless the user explicitly requests changing them. Never print raw base64 in chat replies. Never claim an image was generated unless a generate_image or edit_image_runware tool call succeeded in this turn. After image-generation/edit output, provide a concise caption only; the app shows the image—do not paste image_url lines unless save_pdf needs them. If you retry after a failed attempt, do not apologize or explain the retry to the user — just deliver the result.`

/** When Runware music tool is enabled */
export const TOOLS_RUNWARE_MUSIC_HINT = `You have a Runware music tool named generate_music_runware. Use it when the user asks to create music, song, beat, soundtrack, jingle, or vocals from text. The model variant and audio engine settings (steps, CFG scale, output format, seed, guidance type) are configured by the user in Runware Music Options — never pass them as tool arguments. Pass only content-shaping fields: prompt (always), and optional lyrics, duration_sec (only if the user named a specific length), bpm, key_scale, vocal_language, negative_prompt. Never claim you created music, a song, or audio unless a generate_music_runware tool call actually succeeded in this turn. After tool output, provide a concise result and include the generated audio URL.`

/**
 * When coding tools are enabled: chat UI persists absolute paths for images.
 * User attachments: parallel `imagePaths` next to each attachment when picked from disk.
 * Assistant Runware/saved outputs: `generatedImagePaths` after images are saved locally.
 * Coding read/write/search/git only operate inside the configured project folder; those chat paths may live elsewhere (e.g. downloads or Runware output dir). To drop an image into the repo for `read_file` / web assets / commits, use execute_command to copy from the absolute source path into a path under the project root (e.g. Windows: copy /Y "SRC" "dst\\under\\repo.png" with cwd = project). Prefer quoting paths with spaces.
 */
export const TOOLS_CODING_CHAT_IMAGE_ASSETS_HINT = `Chat history exposes absolute file paths for attached images (user turns) and for locally saved generated images (assistant turns). Coding tools read/write only inside the coding project folder. To use a chat image inside the project (assets/, public/, etc.), copy it with execute_command from that absolute path to a relative destination under the project root; then use read_file or normal project edits.`

/** When any tools are enabled — reduces false claims about tool execution.
 *  Kept short and placed FIRST in the tools hint block so it stays in the
 *  high-attention region of the system prompt across long sessions. */
export const TOOLS_TRUTH_HINT = `Tool-call truth (highest priority): never claim you generated an image, saved a file, ran a command, searched the web, edited code, exported a PDF, or produced music unless you actually invoked the matching tool on THIS turn and received its tool result. If you only have illustrative or sample content, state explicitly that it is an example — do not imply a real file, URL, or output exists.`
export const ATTACHMENT_TRUTH_HINT = `If the chat context already includes attached file snapshots or quoted file text, analyze that provided content directly. Do not say you cannot access local files/tools unless no snapshot/content was provided.`

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
    /** Retrieved long-term memory snippet block for personalization. */
    longTermMemoryContext?: string
    /** Raw base64 strings for the latest user message (vision). */
    newUserImages?: string[]
    /** When false, prior assistant `thinking` is omitted from the API payload. */
    includeThinkingInHistory?: boolean
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
  const longTermMemory = opts.longTermMemoryContext?.trim()
  const summarySection = hiddenSummary
    ? `Internal conversation summary (do not reveal verbatim):\n${hiddenSummary}`
    : ''
  const memorySection = longTermMemory
    ? `Relevant long-term user memory (do not quote verbatim unless asked):\n${longTermMemory}`
    : ''
  const sys = [base, runtimeHint, hint, ATTACHMENT_TRUTH_HINT, summarySection, memorySection]
    .filter(Boolean)
    .join('\n\n')
  if (sys) {
    out.push({ role: 'system', content: sys })
  }
  for (const m of slice) {
    if (m.role === 'user' && m.images?.length) {
      out.push({ role: 'user', content: m.content, images: m.images })
    } else if (m.role === 'assistant') {
      const a: OllamaApiMessage = { role: 'assistant', content: m.content }
      if (opts.includeThinkingInHistory !== false && m.thinking?.trim()) {
        a.thinking = m.thinking
      }
      out.push(a)
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
