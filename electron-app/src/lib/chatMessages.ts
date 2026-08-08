import type { OllamaApiMessage } from '@/lib/ollama'
import type { UiMessage } from '@/types/chat'

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
2. For AI-generated images from generate_image / edit_image_runware, prefer the session catalog path: pass generated_image_indexes (1-based, e.g. "1" for the chart you just made) and/or image_paths with the absolute path shown in the catalog block. The tools server reads local files on the PC — do NOT use image_urls for local paths. Use image_urls only as fallback when no local path exists (public https CDN from Runware).
3. You may combine attached + generated images in one save_pdf call.

Image placement inside the document:
- By default, embedded images are drawn AFTER the body text (attached/local-path images first, then URL-fetched images).
- To place an image at a SPECIFIC spot — e.g. right after the headline — put a standalone markdown image line on its own line in content:
  - \`![optional caption](attached:N)\` for the N-th attached or local-path image (0-based: user attachments first, then generated_image_indexes / image_paths order).
  - \`![optional caption](url:N)\` for the N-th image_urls entry (0-based, http(s) only).
- Any image without an inline marker is appended at the end.`

/** When Runware image tool is enabled */
export const TOOLS_RUNWARE_IMAGE_HINT = `You have three image tools: generate_image, edit_image_runware, and image_recall. Use generate_image only for fresh text-to-image creation. If the user asks to create/make/draw/generate a new image, you MUST call generate_image before giving the final answer. Use edit_image_runware when the user asks to modify existing images; pass prompt plus either reference_image_indexes (1-based session catalog indexes) and/or reference_image_paths (absolute paths). The session catalog lists attachments and generated images: when the user attached image(s) in the current message, those are always index 1 (and 2, …)—use them for “this image” / describe requests; older generated images have higher indexes. Otherwise index 1 is the most recent session image. Read the catalog block in the latest user turn instead of guessing. Earlier user turns in context are text-only for pixels; when the user refers to an older image, call image_recall with the catalog index or path. Use image_recall for vision-style analysis: session catalog images via indexes and/or catalog paths; when coding tools are enabled, also PNG/JPEG/WebP/GIF/BMP files inside the configured coding project folder via reference_image_paths (absolute path or path relative to project root, e.g. demos/screenshot.png). Do not use read_file for vision on images—use image_recall. The latest user message may still include fresh attachment bytes for the current turn only. Always use the selected model profile resolution from Options (do not set width/height in tool args). Keep steps/cfg at the selected model profile defaults unless the user explicitly requests changing them. Never print raw base64 in chat replies. Never claim an image was generated unless a generate_image or edit_image_runware tool call succeeded in this turn. After image-generation/edit output, provide a concise caption only; the app shows the image—do not paste image_url lines unless save_pdf needs them. If you retry after a failed attempt, do not apologize or explain the retry to the user — just deliver the result.`

/** image_recall without Runware generate/edit (Runware image tool disabled). */
export const TOOLS_IMAGE_RECALL_HINT = `You have image_recall for vision-style analysis of existing images (not generation). Use it for session catalog images via reference_image_indexes (1-based) and/or reference_image_paths. When the user attached image(s) in the current message, those are always index 1 (and 2, …). Otherwise index 1 is the most recent session image. Read the catalog block in the latest user turn instead of guessing. Earlier turns are text-only for pixels—call image_recall when you need pixel-accurate detail. When coding tools are enabled, also recall PNG/JPEG/WebP/GIF/BMP files inside the coding project folder via reference_image_paths (absolute or project-relative). Do not use read_file for vision on images. Never print raw base64 in chat replies.`

/** When Runware music tool is enabled */
export const TOOLS_RUNWARE_MUSIC_HINT = `You have a Runware music tool named generate_music_runware. Use it when the user asks to create music, song, beat, soundtrack, jingle, or vocals from text. The model variant and audio engine settings (steps, CFG scale, output format, seed, guidance type) are configured by the user in Runware Music Options — never pass them as tool arguments. Pass only content-shaping fields: prompt (always), and optional lyrics, duration_sec (only if the user named a specific length), bpm, key_scale, vocal_language, negative_prompt. Never claim you created music, a song, or audio unless a generate_music_runware tool call actually succeeded in this turn. After tool output, provide a short caption only (title/mood) — the app shows the audio player; do NOT paste audio_url lines or fake http(s) links in chat. If you retry after a failed attempt, do not apologize or explain the retry to the user — just deliver the result.`

/**
 * When coding tools are enabled: chat UI persists absolute paths for images.
 * User attachments: parallel `imagePaths` next to each attachment when picked from disk.
 * Assistant Runware/saved outputs: `generatedImagePaths` after images are saved locally.
 * Coding read/write/search/git only operate inside the configured project folder; those chat paths may live elsewhere (e.g. downloads or Runware output dir). To drop an image into the repo for `read_file` / web assets / commits, use execute_command to copy from the absolute source path into a path under the project root (e.g. Windows: copy /Y "SRC" "dst\\under\\repo.png" with cwd = project). Prefer quoting paths with spaces.
 */
export const TOOLS_CODING_CHAT_IMAGE_ASSETS_HINT = `Chat history exposes absolute file paths for attached images (user turns) and for locally saved generated images (assistant turns). Coding tools read/write only inside the coding project folder. To vision-analyze screenshots or assets already in the repo (e.g. demos/*.png), call image_recall with reference_image_paths set to the project-relative or absolute path—do not ask the user to re-attach. Chat images that live outside the project can be copied into the repo with execute_command, then recalled from the new path.`

/** When coding tools are enabled — same MUST-call discipline as image/music hints. */
export function buildToolsCodingHint(
  projectPath: string,
  opts?: { codingSubAgentEnabled?: boolean; teamMode?: boolean },
): string {
  const path = projectPath.trim() || '(not set)'
  const subOn = Boolean(opts?.codingSubAgentEnabled)
  const teamMode = Boolean(opts?.teamMode)
  const exploreLine = subOn
    ? teamMode
      ? '- coding_explore — optional read-only map (compact digest). In Team mode, use sparingly before workers — do not replace run_coding_workers.\n'
      : '- coding_explore — optional read-only codebase map (digest) on the coding sub-agent.\n'
    : ''
  const workersLine = subOn
    ? teamMode
      ? '- run_coding_workers — PRIMARY for multi-file / multi-area / multi-step builds: spawn 1–2 parallel workers with path-disjoint goals + path_prefix. Call early (after a light map if needed), not after grinding many edit_code calls yourself.\n'
      : '- run_coding_workers — optional: spawn 1–2 parallel workers (coding sub-agent) for path-disjoint multi-area work. Use when helpful; otherwise implement yourself with edit_code/write_file.\n'
    : ''
  return `You have local coding tools scoped to the configured project folder. CRITICAL: When the user asks to read, list, search, write, edit, refactor, fix, run, build, test, install, or inspect git state in the project, you MUST call the matching coding tool on THIS turn BEFORE any final answer. Do NOT paste code blocks, diffs, terminal output, or "done/fixed/saved" claims unless that tool already returned real output in this turn.

Tool choice (call the right one first):
- list_directory / glob_files / search_files — discover paths and matches (use path_prefix on search_files when the user names a folder).
- find_symbols → targeted read_file(start_line/end_line) → edit_code — preferred navigation for large or unfamiliar files. Do not page a whole file with many range-reads when an outline would locate the symbol in one call.
- read_file — inspect file contents (prefer start_line/end_line or max_chars on large files). Reuse a prior unread read_file / Digest from this turn; do not re-read the same path unless you need exact text for a patch or the prior result was cleared and the digest is insufficient.
- write_file — create or fully replace a file.
- edit_code — patch an existing file (preferred over write_file when changing part of a file). Use find_text from a recent read; pass start_line/end_line when the snippet may repeat.
- execute_command — run shell commands (build, test, npm, git via shell only when no dedicated git tool fits).
- list_processes / read_process_output / stop_process — inspect or stop Active coding processes by runId (do not start a duplicate server).
- git_status / git_diff / git_log / git_show — repo inspection without guessing.
- git_restore — undo a bad edit on one tracked path (worktree from index; to_head=true resets to HEAD). Never commits.
- git_stash — checkpoint without commit (list / push / pop). Use push before risky multi-file work.
- check_types — TypeScript (tsc), Python (ruff/pyright), Go (go vet), or Rust (cargo check); auto-detects from path_prefix / .ts|.py|.go|.rs paths and project markers.
${exploreLine}${workersLine}
Never claim a file was read, changed, created, or that a command ran unless the corresponding tool succeeded in this turn. Before edit_code, ensure you have the exact snippet (from an in-context read_file this turn, or one targeted range-read). Prefer find_symbols to locate lines first. If unsure of a path, call glob_files or search_files instead of inventing paths. All paths must stay inside the project root.
If Active coding processes lists a server/dev command still running, do not start a duplicate; reuse or stop_process(runId) first.
${
  teamMode && subOn
    ? `
TEAM MODE (orchestrator protocol — this is why Team exists):
1. You coordinate; workers implement. Stay in Team — never escalate to Plan.
2. DEFAULT for non-trivial coding (multi-file, multi-folder, multi-step, large feature/refactor): partition into ≤2 path-disjoint tasks (each with path_prefix when possible) and call run_coding_workers ON THIS TURN early. Do not implement the whole surface yourself with sequential edit_code/write_file.
3. Workers return digests — then you verify (git_diff / check_types / targeted read), fix glue yourself if needed, and answer the user once.
4. Direct edit_code / write_file yourself ONLY for: single-file / tiny hotfixes, or small glue after workers. A short in-chat checklist is fine; Plan cards are a separate composer mode the user chooses.
`
    : subOn
      ? `
AGENT MODE workers (optional): run_coding_workers is available when coding sub-agent is enabled. Use it for independent multi-area parallel work if it helps; otherwise implement yourself. Not required for small single-file tasks.
`
      : ''
}
Coding project root: ${path}`
}

/** When any tools are enabled — reduces false claims about tool execution.
 *  Kept short and placed FIRST in the tools hint block so it stays in the
 *  high-attention region of the system prompt across long sessions. */
export const TOOLS_TRUTH_HINT = `Tool-call truth (highest priority): never claim you generated an image, saved a file, ran a command, searched the web, edited code, exported a PDF, or produced music unless you actually invoked the matching tool on THIS turn and received its tool result. If you only have illustrative or sample content, state explicitly that it is an example — do not imply a real file, URL, or output exists.`
export const ATTACHMENT_TRUTH_HINT = `If the chat context already includes attached file snapshots or quoted file text, analyze that provided content directly. Do not say you cannot access local files/tools unless no snapshot/content was provided.`

/** @deprecated use TOOLS_WEB_SEARCH_HINT */
export const TOOLS_SYSTEM_HINT = TOOLS_WEB_SEARCH_HINT

/**
 * Effective UI index: messages before this are covered only by hiddenContextSummary.
 * Legacy sessions with summary but no index treat all current messages as compressed.
 */
export function resolveContextCompressedThroughIndex(
  hiddenContextSummary: string | undefined,
  contextCompressedThroughIndex: number | undefined,
  messageCount: number,
): number {
  if (!hiddenContextSummary?.trim()) return 0
  const count = Math.max(0, Math.round(messageCount))
  const stored = Math.max(0, Math.round(contextCompressedThroughIndex ?? 0))
  if (stored > 0) return Math.min(stored, count)
  return count
}

/** UI messages to include in the LLM prior-history (after context compression). */
export function sliceUiHistoryForContext(
  messages: UiMessage[],
  hiddenContextSummary: string | undefined,
  contextCompressedThroughIndex: number | undefined,
): UiMessage[] {
  const through = resolveContextCompressedThroughIndex(
    hiddenContextSummary,
    contextCompressedThroughIndex,
    messages.length,
  )
  if (through <= 0) return messages
  return messages.slice(through)
}

export function buildOllamaMessages(
  priorMessages: HistoryTurn[],
  newUserContent: string,
  opts: {
    systemPrompt: string
    /** Agent skills catalog (name + description); full bodies via read_skill */
    skillsSystemHint?: string
    /** Project AGENTS.md / CLAUDE.md from the open coding project */
    projectInstructionsHint?: string
    /** Plan mode instructions (read-only + JSON plan fence) */
    planModeSystemHint?: string
    /** Ask mode instructions (read-only Q&A, no plan artifact) */
    askModeSystemHint?: string
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
  const out: OllamaApiMessage[] = []
  const skillsHint = opts.skillsSystemHint?.trim()
  const projectInstructionsHint = opts.projectInstructionsHint?.trim()
  const planModeHint = opts.planModeSystemHint?.trim()
  const askModeHint = opts.askModeSystemHint?.trim()
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
  const sys = [
    base,
    projectInstructionsHint,
    planModeHint,
    askModeHint,
    skillsHint,
    runtimeHint,
    hint,
    ATTACHMENT_TRUTH_HINT,
    summarySection,
    memorySection,
  ]
    .filter(Boolean)
    .join('\n\n')
  if (sys) {
    out.push({ role: 'system', content: sys })
  }
  for (const m of priorMessages) {
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
