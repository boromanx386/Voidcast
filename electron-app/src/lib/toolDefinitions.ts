import { AGENT_EDITABLE_SETTINGS_FIELDS, type ToolsEnabled } from '@/lib/settings'
import type { AgentChatMode } from '@/types/chat'
import {
  MCP_CALL_NAME,
  MCP_GET_TOOL_NAME,
  MCP_LIST_TOOLS_NAME,
  MCP_READ_RESULT_NAME,
  type McpToolInfo,
} from '@/lib/mcpTools'

/** Tools that mutate the system / filesystem / media — blocked in Plan mode. */
export const PLAN_MODE_BLOCKED_TOOLS = new Set([
  'write_file',
  'edit_code',
  'execute_command',
  'stop_process',
  'git_restore',
  'git_stash',
  'save_pdf',
  'generate_image',
  'edit_image_runware',
  'generate_music_runware',
  'update_settings',
  'add_reminder',
  'delete_reminder',
  'update_reminder',
  'update_plan_progress',
  MCP_CALL_NAME,
])

export function isPlanModeBlockedTool(name: string): boolean {
  if (name.startsWith('mcp__')) return true
  return PLAN_MODE_BLOCKED_TOOLS.has(name)
}

/** Minimal JSON-schema subset for tool `parameters.properties` values */
export type AgentToolParameterSchema = {
  type: string
  description?: string
  enum?: readonly string[]
  items?: { type: string; minimum?: number }
}

/** Shared OpenAI-style function tool definition (Ollama / OpenRouter / future providers). */
export type AgentToolDefinition = {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: {
      type: 'object'
      properties: Record<string, AgentToolParameterSchema>
      required?: string[]
    }
  }
}

const GET_WEATHER_TOOL: AgentToolDefinition = {
  type: 'function',
  function: {
    name: 'get_weather',
    description:
      'Get current weather and optionally a short multi-day forecast for a city or town (wttr.in).',
    parameters: {
      type: 'object',
      properties: {
        city: {
          type: 'string',
          description: 'City or location name (e.g. Belgrade, London)',
        },
        forecast: {
          type: 'boolean',
          description: 'If true, include a brief 3-day outlook. Default false.',
        },
      },
      required: ['city'],
    },
  },
}

const SCRAPE_URL_TOOL: AgentToolDefinition = {
  type: 'function',
  function: {
    name: 'scrape_url',
    description:
      'Fetch a public web page over HTTP(S) and return its main text content (HTML stripped). Use when the user gives a URL or needs article/page content. Only public internet URLs; local/private hosts are blocked.',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Full http(s) URL to fetch',
        },
        max_chars: {
          type: 'number',
          description:
            'Max characters of text to return (default ~40000; larger pages are truncated).',
        },
      },
      required: ['url'],
    },
  },
}

const SAVE_PDF_TOOL: AgentToolDefinition = {
  type: 'function',
  function: {
    name: 'save_pdf',
    description:
      'Save content as a formatted PDF into the user-configured output folder (Options → Tools). You MUST call this function to create a real file; do not claim a PDF was saved without calling it. Pass content (full body), optional title and filename. Content may use Markdown-style: # headings, `-` / `*` / `•` bullets, `1.` numbered lines, wrapped list continuations (no marker on next line), | tables |, --- rules, **bold**, and single newlines inside a paragraph for intentional line breaks. To embed images: (a) for images the user attached to the current message, set embed_attached_images true and/or attached_image_indices (0-based); (b) for AI-generated images saved in this chat session, pass absolute local paths in image_paths and/or 1-based session catalog indexes in generated_image_indexes (same indexes as image_recall — paths from the catalog block are preferred); (c) only if no local path exists, use public http(s) CDN URLs in image_urls. PNG/JPEG/WebP supported. Image placement: by default any image not referenced inline appears after the body text in order. To place an image at a specific spot inside the body, put a standalone markdown image line `![alt](attached:N)` (for the N-th attached/local-path image in combined order, 0-based) or `![alt](url:N)` (for the N-th image_urls entry, 0-based) on its own line — that exact position in the PDF will receive the image.',
    parameters: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'Full text body to put in the PDF',
        },
        title: {
          type: 'string',
          description: 'Optional document title shown at the top (default: Document)',
        },
        filename: {
          type: 'string',
          description:
            'Optional suggested file name without path (e.g. report); .pdf is added if missing',
        },
        embed_attached_images: {
          type: 'boolean',
          description:
            'If true, embed every image the user attached to the current message (after body text). Ignored if attached_image_indices is provided.',
        },
        attached_image_indices: {
          type: 'array',
          items: { type: 'integer', minimum: 0 },
          description:
            'Optional 0-based indices into the images attached with the user message (first image is 0). Use this for a subset instead of embed_attached_images.',
        },
        image_urls: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optional public http(s) image URLs to fetch and embed (PNG/JPEG/WebP). Fallback when no local path exists for a generated image. Prefer image_paths or generated_image_indexes for Runware outputs saved locally.',
        },
        image_paths: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optional absolute local file paths to embed (PNG/JPEG/WebP). Use paths from the session image catalog for generate_image / edit_image_runware outputs (e.g. Q:\\...\\voidcast\\....jpg). The tools server reads them on the host PC.',
        },
        generated_image_indexes: {
          type: 'string',
          description:
            'Optional 1-based session catalog indexes for generated/attached images to embed (same numbering as image_recall). Example: "1" for the most recent catalog image. Resolves to local path when available.',
        },
      },
      required: ['content'],
    },
  },
}

const WEB_SEARCH_TOOL: AgentToolDefinition = {
  type: 'function',
  function: {
    name: 'web_search',
    description:
      'Search the public web (news, facts, URLs, current events). Call this whenever the user wants information that may be online or time-sensitive. Pass a short `query` string.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query in concise natural language',
        },
      },
      required: ['query'],
    },
  },
}

const REDDIT_FEED_TOOL: AgentToolDefinition = {
  type: 'function',
  function: {
    name: 'reddit_feed',
    description:
      'Read-only Reddit access via public JSON endpoints (no API key). Three modes: (A) browse a subreddit feed by passing subreddit + sort; (B) fetch a single post with top comments by passing post_url; (C) search posts by passing query (optionally restricted to a subreddit). Use when the user asks "what is r/<sub> saying", "top posts on Reddit about X", "summarize this Reddit thread", or gives a reddit.com URL. Names are case-sensitive only for display; pass the bare subreddit name without the leading r/.',
    parameters: {
      type: 'object',
      properties: {
        subreddit: {
          type: 'string',
          description:
            'Subreddit name without "r/" prefix (e.g. "audio", "askreddit"). Omit for the global front page mix in feed mode, or for a global search in query mode.',
        },
        sort: {
          type: 'string',
          enum: ['hot', 'new', 'top', 'rising', 'controversial', 'best'],
          description:
            'Listing sort for feed mode (default "hot"). Only relevant when query and post_url are not set.',
        },
        time: {
          type: 'string',
          enum: ['hour', 'day', 'week', 'month', 'year', 'all'],
          description:
            'Time window for top/controversial listings and search relevance (default "day").',
        },
        limit: {
          type: 'number',
          description: 'Max posts to return for feed/search mode (default 10, max 25).',
        },
        query: {
          type: 'string',
          description:
            'If set, runs a Reddit search instead of a feed. Pair with subreddit to restrict to that sub, or omit subreddit for a global search.',
        },
        post_url: {
          type: 'string',
          description:
            'If set, returns one post + top comments. Accepts: a full reddit.com /r/<sub>/comments/<id>/... URL (always shown after "post: " in feed/search output), a redd.it short URL, or a bare base36 post id (the value shown after "id=" in feed output, e.g. "1t8kumi"). Never pass a media URL (v.redd.it, i.redd.it, imgur, etc.) — those are not Reddit threads.',
        },
        max_comments: {
          type: 'number',
          description: 'Max top-level comments to return when post_url is set (default 10, max 50).',
        },
      },
    },
  },
}

const SEARCH_YOUTUBE_TOOL: AgentToolDefinition = {
  type: 'function',
  function: {
    name: 'search_youtube',
    description:
      'Search YouTube for videos, or get details and optional transcript for a specific YouTube URL. Use when the user asks for videos on a topic, or wants a summary/transcript of a YouTube video. For transcript, pass the watch URL and get_transcript: true.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Search phrase to find YouTube videos (e.g. "rust tutorial"). Omit if video_url is set.',
        },
        video_url: {
          type: 'string',
          description:
            'Full YouTube watch or youtu.be URL when you need metadata or captions for one video.',
        },
        get_transcript: {
          type: 'boolean',
          description:
            'If true, fetch captions when video_url is set (English preferred, then other languages). Default false.',
        },
        max_results: {
          type: 'number',
          description: 'Max search hits when using query (default 5, max 20).',
        },
      },
    },
  },
}

const GENERATE_IMAGE_TOOL: AgentToolDefinition = {
  type: 'function',
  function: {
    name: 'generate_image',
    description:
      'MANDATORY: Generate an image from a text prompt (Runware or OpenRouter, per Media options). CRITICAL: When the user asks to create/make/draw/generate a new image, you MUST call this tool BEFORE responding with any text. Do NOT describe what you would create - actually call the tool. Do NOT say "Here is the image" without calling this tool first. Never claim an image was generated unless this tool returned a real result with image_url; if generation fails, report the tool error.',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Primary text prompt describing the image to generate.',
        },
        negative_prompt: {
          type: 'string',
          description: 'Optional negative prompt for elements to avoid.',
        },
        steps: {
          type: 'number',
          description: 'Optional number of inference steps.',
        },
        cfg_scale: {
          type: 'number',
          description: 'Optional guidance scale.',
        },
        model: {
          type: 'string',
          description: 'Optional Runware model id override.',
        },
      },
      required: ['prompt'],
    },
  },
}

const EDIT_IMAGE_RUNWARE_TOOL: AgentToolDefinition = {
  type: 'function',
  function: {
    name: 'edit_image_runware',
    description:
      'MANDATORY: Edit or transform images using attached chat images as references (Runware or OpenRouter, per Media options). CRITICAL: When the user asks to modify, change, edit, transform, or combine existing image(s), you MUST call this tool BEFORE responding with any text. Do NOT describe how the edited image would look - actually call the tool. Do NOT say "Here is the edited image" without calling this tool first. Never claim an image was edited or transformed unless this tool returned a real result with image_url; if editing fails, report the tool error.',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Instruction for how the referenced image(s) should be edited or transformed.',
        },
        reference_image_indexes: {
          type: 'string',
          description:
            'Optional 1-based image indexes from the internal conversation image catalog (for example: "1" or "1,2"), where index 1 is the most recent image.',
        },
        reference_image_paths: {
          type: 'string',
          description:
            'Optional absolute image path(s) from chat history (single path or comma/newline-separated list). Use when user references image by path/name from history.',
        },
        negative_prompt: {
          type: 'string',
          description: 'Optional negative prompt for elements to avoid.',
        },
        steps: {
          type: 'number',
          description: 'Optional number of inference steps.',
        },
        cfg_scale: {
          type: 'number',
          description: 'Optional guidance scale.',
        },
        model: {
          type: 'string',
          description: 'Optional Runware edit model id override.',
        },
      },
      required: ['prompt'],
    },
  },
}

const IMAGE_RECALL_TOOL: AgentToolDefinition = {
  type: 'function',
  function: {
    name: 'image_recall',
    description:
      'Recall image bytes for vision or edit prep in the current runtime turn. Resolves reference_image_indexes and/or reference_image_paths against the session image catalog. When coding tools are enabled, reference_image_paths can also name PNG/JPEG/WebP/GIF/BMP files inside the configured coding project folder (absolute path or path relative to project root).',
    parameters: {
      type: 'object',
      properties: {
        reference_image_indexes: {
          type: 'string',
          description:
            'Optional 1-based indexes from the internal conversation image catalog (for example: "1" or "1,2"), where index 1 is the most recent image.',
        },
        reference_image_paths: {
          type: 'string',
          description:
            'Optional image path(s): session catalog absolute paths from chat, and/or project-relative/absolute paths under the coding project root when coding tools are on (comma/newline-separated).',
        },
        purpose: {
          type: 'string',
          description:
            'Optional intent for recall usage: "vision" (analysis) or "edit" (image editing).',
        },
        focus: {
          type: 'string',
          description:
            'Optional vision focus when sub-agent analysis is enabled — what the main agent needs from the image (e.g. "read the error in the status bar", "color and label of the submit button"). Tailors the sub-agent description; cached per image+focus.',
        },
      },
      required: [],
    },
  },
}

const GENERATE_MUSIC_RUNWARE_TOOL: AgentToolDefinition = {
  type: 'function',
  function: {
    name: 'generate_music_runware',
    description:
      'MANDATORY: Generate music/audio with the Runware ACE-Step music model from a text prompt. CRITICAL: When the user asks to create/make/generate a song, beat, background music, jingle, soundtrack, or vocals, you MUST call this tool BEFORE responding with any text. Do NOT describe what music you would create - actually call the tool. Do NOT say "Here is the music" or "I created the song" without calling this tool first. Never claim music was generated unless this tool returned a real result with audio_url; if generation fails, report the tool error. After success, give a short caption only — do NOT paste audio_url or http(s) links in chat (the app shows the player). Audio engine settings (model variant, denoising steps, CFG scale, output format, seed, guidance type) are controlled by the user in Options - never include them as arguments here.',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Primary music prompt describing style, mood, instruments, vocals, and structure.',
        },
        negative_prompt: {
          type: 'string',
          description: 'Optional negative prompt for unwanted music qualities.',
        },
        lyrics: {
          type: 'string',
          description: 'Optional lyrics text.',
        },
        duration_sec: {
          type: 'number',
          description: 'Optional duration in seconds (6-300). Only set when the user explicitly asks for a specific length.',
        },
        bpm: {
          type: 'number',
          description: 'Optional beats per minute (30-300).',
        },
        key_scale: {
          type: 'string',
          description: 'Optional musical key and scale (for example: "C major", "F# minor").',
        },
        vocal_language: {
          type: 'string',
          description: 'Optional vocal language code (for example: en, es, de, unknown).',
        },
      },
      required: ['prompt'],
    },
  },
}

const UPDATE_SETTINGS_TOOL: AgentToolDefinition = {
  type: 'function',
  function: {
    name: 'update_settings',
    description:
      'MANDATORY: Update app settings. CRITICAL: When the user asks to change system prompt, context window, temperature, theme, image resolution, or image/edit models, you MUST call this tool BEFORE replying with confirmation text.',
    parameters: {
      type: 'object',
      properties: {
        field: {
          type: 'string',
          enum: AGENT_EDITABLE_SETTINGS_FIELDS,
          description:
            'Setting key to update. Allowed: llmSystemPrompt, llmNumCtx, llmTemperature, uiTheme, longMemoryAdd, autoVoice, runwareResolution, runwareWidth, runwareHeight, runwareImageModel, runwareEditModel.',
        },
        value: {
          type: 'string',
          description:
            'New value to apply. Numeric settings should be passed as numeric text. For longMemoryAdd, pass either plain text or JSON string like {"text":"...","kind":"fact","importance":0.7,"confidence":0.8,"tags":["x","y"]}.',
        },
      },
      required: ['field', 'value'],
    },
  },
}

const CODING_LIST_DIRECTORY_TOOL: AgentToolDefinition = {
  type: 'function',
  function: {
    name: 'list_directory',
    description:
      'List files and folders inside the configured coding project directory. Use this to browse project structure before reading or editing files. By default skips heavy/generated folders (node_modules, .venv, dist, __pycache__, etc.); set include_ignored=true to show them.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Optional relative path inside coding project. Empty means project root.',
        },
        include_ignored: {
          type: 'boolean',
          description:
            'If true, include normally skipped folders (node_modules, .venv, dist, etc.). Default false.',
        },
      },
    },
  },
}

const CODING_READ_FILE_TOOL: AgentToolDefinition = {
  type: 'function',
  function: {
    name: 'read_file',
    description:
      'Read a file from the configured coding project. Binary files (e.g. containing null bytes) are rejected. For large or unfamiliar files, prefer find_symbols first, then read with start_line/end_line (whole-file reads above ~220k characters are rejected unless you use a range). Whole-file re-reads of a path already in session digests or this turn\'s working set are soft-denied (returns a short digest reminder) — use start_line/end_line, or force:true only when you truly need the full file again. Lines are returned as N|text with 1-based line numbers.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative file path inside coding project.',
        },
        start_line: {
          type: 'number',
          description: 'Optional 1-based start line. Use with end_line or alone (then up to ~400 lines are returned).',
        },
        end_line: {
          type: 'number',
          description: 'Optional 1-based inclusive end line.',
        },
        max_chars: {
          type: 'number',
          description:
            'Optional cap on returned characters after line slicing (default unlimited within range).',
        },
        force: {
          type: 'boolean',
          description:
            'If true, allow a whole-file re-read even when the path is already in digests/working-set cache. Prefer range-read instead whenever possible.',
        },
      },
      required: ['path'],
    },
  },
}

const CODING_WRITE_FILE_TOOL: AgentToolDefinition = {
  type: 'function',
  function: {
    name: 'write_file',
    description:
      'MANDATORY: Write full file content in the configured coding project directory. CRITICAL: When the user asks to create a new file, save code, or replace a file\'s contents, you MUST call this tool BEFORE responding with any text. Do NOT show the file contents in chat and claim it was saved - actually call the tool. Do NOT say "File created" or "Saved to ..." without calling this tool first. Never claim a file was written unless this tool returned a successful result in this turn. This overwrites file content; read the file first when changing existing code.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative file path inside coding project.',
        },
        content: {
          type: 'string',
          description: 'Full file content to write.',
        },
      },
      required: ['path', 'content'],
    },
  },
}

const CODING_EDIT_CODE_TOOL: AgentToolDefinition = {
  type: 'function',
  function: {
    name: 'edit_code',
    description:
      'MANDATORY: Edit existing file content by replacing a target snippet with new text inside the configured coding project directory. CRITICAL: When the user asks to change, fix, refactor, rename, or modify code inside an existing file, you MUST call this tool BEFORE responding with any text. Do NOT show the patched code in chat and claim it was applied - actually call the tool. Do NOT say "I changed ..." or "Updated the function" without calling this tool first. Never claim a file was edited unless this tool returned a successful result in this turn.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative file path inside coding project.',
        },
        find_text: {
          type: 'string',
          description:
            'Text snippet to find. Use \\n for line breaks even on CRLF (Windows) files — matching is EOL-aware.',
        },
        replace_text: {
          type: 'string',
          description: 'Replacement text snippet (\\n line breaks are fine on CRLF files).',
        },
        replace_all: {
          type: 'boolean',
          description: 'If true, replace all matches. Default false (first match only).',
        },
        start_line: {
          type: 'number',
          description:
            'Optional 1-based start line to restrict the search (use with end_line when the snippet repeats).',
        },
        end_line: {
          type: 'number',
          description: 'Optional 1-based end line to restrict the search.',
        },
        ignore_whitespace: {
          type: 'boolean',
          description:
            'If true, match ignoring indentation and runs of spaces (useful after reformats). Default false.',
        },
      },
      required: ['path', 'find_text', 'replace_text'],
    },
  },
}

const CODING_SEARCH_FILES_TOOL: AgentToolDefinition = {
  type: 'function',
  function: {
    name: 'search_files',
    description:
      'Search file contents under the coding project using a plain-text query (case-insensitive, literal substring—fixed string, not regex). Results are ranked by relevance (filename/path match, definition-like lines, recent files) and returned as contextual blocks with a few lines before/after each match—not a flat dump of every hit. Uses a bundled ripgrep binary in the desktop app (override with VOIDCAST_RG_PATH, or system rg on PATH as fallback); if ripgrep is unavailable, a built-in walk runs the same query. Both paths share the same source-like extension list and skip the same heavy folders (node_modules, dist, .git, etc.). Ripgrep is run with --no-ignore and --hidden so match sets stay close to the fallback walk, which does not read .gitignore and does enter most dot-directories except a fixed skip list. Use read_file for full contents of promising paths.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search text to match inside files.',
        },
        path_prefix: {
          type: 'string',
          description:
            'Optional relative folder inside the project to limit the search (e.g. src/components).',
        },
      },
      required: ['query'],
    },
  },
}

const CODING_GLOB_FILES_TOOL: AgentToolDefinition = {
  type: 'function',
  function: {
    name: 'glob_files',
    description:
      'List source-like files under the coding project by extension. Faster than repeated list_directory for finding TypeScript, configs, etc. Skips node_modules, dist, build, .git, and similar folders.',
    parameters: {
      type: 'object',
      properties: {
        path_prefix: {
          type: 'string',
          description: 'Optional relative folder to search under (default: project root).',
        },
        extensions: {
          type: 'array',
          items: { type: 'string' },
          description:
            'File extensions without dot, e.g. ["ts","tsx"]. If omitted, uses the same default set as search_files (TypeScript/JavaScript stack, configs, markdown, Rust, Go, Vue, Svelte, Kotlin, shell, toml, etc.).',
        },
        max_results: {
          type: 'number',
          description: 'Maximum paths to return (default 150, max 500).',
        },
      },
    },
  },
}

const CODING_FIND_SYMBOLS_TOOL: AgentToolDefinition = {
  type: 'function',
  function: {
    name: 'find_symbols',
    description:
      'Read-only symbol outline (functions, classes, methods, interfaces, types, exports, headings) with 1-based line numbers for ONE file. Prefer this before paging large files with many read_file ranges. Returned line numbers feed edit_code start_line/end_line and targeted read_file ranges. Regex-based per-language heuristics (TS/JS, Python, Go, Rust, Markdown), no external deps. Supports an optional query filter on symbol name.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative file path inside the coding project (required).',
        },
        query: {
          type: 'string',
          description: 'Optional substring filter on symbol name (case-insensitive).',
        },
        max_symbols: {
          type: 'number',
          description: 'Maximum symbols to return (default 400).',
        },
      },
      required: ['path'],
    },
  },
}

const CODING_GIT_STATUS_TOOL: AgentToolDefinition = {
  type: 'function',
  function: {
    name: 'git_status',
    description:
      'Show git branch and short working-tree status for the coding project (modified, staged, untracked paths). Use to see what changed before or after edits. Requires the project folder to be a git repository.',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
}

const CODING_GIT_DIFF_TOOL: AgentToolDefinition = {
  type: 'function',
  function: {
    name: 'git_diff',
    description:
      'Show unified diff for the coding project. Unstaged changes by default; set staged=true for staged (cached) diff. Optional path limits diff to one file or subdirectory (relative to project root). Requires git.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Optional relative path to a file or folder inside the project. Omit for full tree diff.',
        },
        staged: {
          type: 'boolean',
          description: 'If true, show staged changes (git diff --cached). Default false (working tree vs index).',
        },
      },
    },
  },
}

const CODING_GIT_LOG_TOOL: AgentToolDefinition = {
  type: 'function',
  function: {
    name: 'git_log',
    description:
      'Show recent git commits for the coding project (oneline with decorations). Optional path limits history to that file or folder. Requires git.',
    parameters: {
      type: 'object',
      properties: {
        max_commits: {
          type: 'number',
          description: 'How many commits to show (default 25, max 100).',
        },
        path: {
          type: 'string',
          description:
            'Optional relative file or directory inside the project to scope the log (git log -- path).',
        },
      },
    },
  },
}

const CODING_GIT_SHOW_TOOL: AgentToolDefinition = {
  type: 'function',
  function: {
    name: 'git_show',
    description:
      'Show a git object (commit, tag, etc.): metadata and patch. Default ref is HEAD. With path, limits output to that file in the commit (git show ref -- path). Large output may be truncated. Requires git.',
    parameters: {
      type: 'object',
      properties: {
        ref: {
          type: 'string',
          description: 'Commit-ish (hash, HEAD, HEAD~1, branch name, tag). Default HEAD.',
        },
        path: {
          type: 'string',
          description:
            'Optional relative file inside the project to show changes for at that commit.',
        },
      },
    },
  },
}

const CODING_GIT_RESTORE_TOOL: AgentToolDefinition = {
  type: 'function',
  function: {
    name: 'git_restore',
    description:
      'Recover a tracked file after a bad edit: restore one project-relative path via git restore. Default restores the worktree from the index (undoes unstaged edit_code/write changes for tracked files). Set to_head=true to reset both index and worktree to HEAD for that path. Does NOT commit, reset the whole repo, or delete untracked files. Prefer this over rewriting a broken file from memory.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Required relative file path inside the project to restore.',
        },
        to_head: {
          type: 'boolean',
          description:
            'If true, restore staged+worktree from HEAD for this path. Default false (worktree from index only).',
        },
      },
      required: ['path'],
    },
  },
}

const CODING_GIT_STASH_TOOL: AgentToolDefinition = {
  type: 'function',
  function: {
    name: 'git_stash',
    description:
      'Safe checkpoint without committing. action=list shows stashes; action=push saves current changes (optional path scope, optional include_untracked); action=pop reapplies stash@{n} (default 0). Does NOT commit or rewrite history. Use push before a risky multi-file refactor; pop to recover. Conflicts on pop are reported — resolve carefully.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: 'One of: list, push, pop. Default list.',
        },
        message: {
          type: 'string',
          description: 'Optional stash message for action=push (default: voidcast checkpoint).',
        },
        path: {
          type: 'string',
          description: 'Optional relative path to stash only that file/folder (action=push).',
        },
        include_untracked: {
          type: 'boolean',
          description: 'If true with action=push, include untracked files (-u). Default false.',
        },
        stash_ref: {
          type: 'string',
          description: 'For action=pop: stash@{n} or n (default stash@{0}).',
        },
      },
    },
  },
}

const CODING_CHECK_TYPES_TOOL: AgentToolDefinition = {
  type: 'function',
  function: {
    name: 'check_types',
    description:
      'Run a project check after edits. Auto-detects TypeScript (tsc --noEmit), Python (ruff, then pyright), Go (go vet), or Rust (cargo check). Detection uses path extensions (.ts/.tsx/.py/.go/.rs) and project markers (tsconfig.json, pyproject/requirements, go.mod, Cargo.toml). Use path_prefix for monorepo packages. Pass paths of edited files to bias detection and limit reported issues. Read-only — safe in Plan mode.',
    parameters: {
      type: 'object',
      properties: {
        path_prefix: {
          type: 'string',
          description:
            'Optional subdirectory to check (e.g. electron-app for tsconfig, crate root for Cargo.toml). Default: project root.',
        },
        paths: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optional project-relative file paths. Extension selects the checker (.ts/.tsx → TypeScript, .py → Python, .go → Go, .rs → Rust). Also limits reported diagnostics when possible.',
        },
      },
    },
  },
}

const CODING_EXECUTE_COMMAND_TOOL: AgentToolDefinition = {
  type: 'function',
  function: {
    name: 'execute_command',
    description:
      'MANDATORY: Execute a shell command in the configured coding project directory and return stdout/stderr. CRITICAL: When the user asks to run, execute, build, test, install, start, stop, or invoke any command/script, you MUST call this tool BEFORE responding with any text. Do NOT show example terminal output and claim the command ran - actually call the tool. Do NOT say "I ran the command" or paste fake stdout without calling this tool first. Never claim a command produced output unless this tool returned a real result with stdout/stderr in this turn. For long-lived CLIs that print then keep running (dev servers, agent-browser open/session, watchers), set run_in_background=true — otherwise the app may wait on process exit and stall the agent loop.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'Shell command to execute.',
        },
        timeout_sec: {
          type: 'number',
          description: 'Optional timeout in seconds (default 20, max 120). Ignored when run_in_background is true.',
        },
        run_in_background: {
          type: 'boolean',
          description:
            'If true, starts command in background and returns immediately with process id. Use for servers, watchers, and browser/agent CLIs that stay running after printing success. Manage with list_processes / read_process_output / stop_process.',
        },
      },
      required: ['command'],
    },
  },
}

const CODING_LIST_PROCESSES_TOOL: AgentToolDefinition = {
  type: 'function',
  function: {
    name: 'list_processes',
    description:
      'List active coding shell processes started via execute_command (foreground and background). Returns runId, command, status snippet. Use before starting a duplicate server/dev command.',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
}

const CODING_STOP_PROCESS_TOOL: AgentToolDefinition = {
  type: 'function',
  function: {
    name: 'stop_process',
    description:
      'Stop an active coding process by runId (from list_processes or the Active coding processes hint). Prefer this over starting a duplicate.',
    parameters: {
      type: 'object',
      properties: {
        run_id: {
          type: 'string',
          description: 'Process runId from list_processes / Active coding processes hint.',
        },
      },
      required: ['run_id'],
    },
  },
}

const CODING_READ_PROCESS_OUTPUT_TOOL: AgentToolDefinition = {
  type: 'function',
  function: {
    name: 'read_process_output',
    description:
      'Read retained stdout/stderr from an active coding process (last ~64KB). Pass offset from a previous nextOffset to poll for new output (e.g. wait for "Listening on").',
    parameters: {
      type: 'object',
      properties: {
        run_id: {
          type: 'string',
          description: 'Process runId from list_processes / Active coding processes hint.',
        },
        offset: {
          type: 'number',
          description:
            'Optional absolute byte offset from a prior nextOffset (omit to read from the start of the retained buffer).',
        },
      },
      required: ['run_id'],
    },
  },
}

const CODING_EXPLORE_TOOL: AgentToolDefinition = {
  type: 'function',
  function: {
    name: 'coding_explore',
    description:
      'Delegate a read-only codebase exploration to the coding sub-agent. ' +
      'Use when you need a map of relevant files/APIs before editing. ' +
      'Returns a compact digest (paths, findings, suggested next edits). ' +
      'Do not use for applying edits — use edit_code/write_file after.',
    parameters: {
      type: 'object',
      properties: {
        goal: {
          type: 'string',
          description: 'What to find or understand (1–3 sentences).',
        },
        path_prefix: {
          type: 'string',
          description: 'Optional subdirectory to scope search (project-relative).',
        },
        max_rounds: {
          type: 'number',
          description: 'Max nested tool rounds (default 8, max 12).',
        },
      },
      required: ['goal'],
    },
  },
}

const ADD_REMINDER_TOOL: AgentToolDefinition = {
  type: 'function',
  function: {
    name: 'add_reminder',
    description:
      'Add a reminder. Use when the user asks to be reminded, schedule something, or set a note. If the user gives a specific time, pass it as ISO datetime in `when`. If no time is given, omit `when` for a general reminder.',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Reminder text. Required.',
        },
        when: {
          type: 'string',
          description:
            'Optional scheduled time as ISO datetime (e.g. 2026-05-10T09:00). Omit for a general reminder with no specific time.',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional tags for categorizing the reminder.',
        },
      },
      required: ['text'],
    },
  },
}

const LIST_REMINDERS_TOOL: AgentToolDefinition = {
  type: 'function',
  function: {
    name: 'list_reminders',
    description:
      'List reminders. Use when the user asks what they have scheduled, what is coming up, or for a reminder report. Pass from/to as ISO dates (YYYY-MM-DD) or natural language (today, tomorrow, next 3 days). Set include_general to false if the user only wants time-based reminders.',
    parameters: {
      type: 'object',
      properties: {
        from: {
          type: 'string',
          description:
            'Optional start date as ISO date (YYYY-MM-DD) or natural language (today, tomorrow). Defaults to today if omitted.',
        },
        to: {
          type: 'string',
          description:
            'Optional end date as ISO date (YYYY-MM-DD) or natural language (next 3 days). Defaults to end of the from day if only from is given, or end of today if neither is given.',
        },
        include_general: {
          type: 'boolean',
          description:
            'If true, include general reminders with no specific time. Defaults to true.',
        },
      },
    },
  },
}

const DELETE_REMINDER_TOOL: AgentToolDefinition = {
  type: 'function',
  function: {
    name: 'delete_reminder',
    description:
      'Delete a reminder. Use when the user asks to cancel, remove, or delete a reminder. Search by text to find the reminder ID, then delete it.',
    parameters: {
      type: 'object',
      properties: {
        search_text: {
          type: 'string',
          description:
            'Text to search for in reminders. The tool will find the best matching reminder and delete it.',
        },
      },
      required: ['search_text'],
    },
  },
}

const UPDATE_REMINDER_TOOL: AgentToolDefinition = {
  type: 'function',
  function: {
    name: 'update_reminder',
    description:
      'Update a reminder. Use when the user asks to change, reschedule, or edit a reminder. Search by text to find the reminder, then update its text, time, or tags.',
    parameters: {
      type: 'object',
      properties: {
        search_text: {
          type: 'string',
          description:
            'Text to search for in reminders. The tool will find the best matching reminder and update it.',
        },
        text: {
          type: 'string',
          description: 'New reminder text. Omit to keep existing text.',
        },
        when: {
          type: 'string',
          description:
            'New scheduled time as ISO datetime (e.g. 2026-05-10T09:00). Pass empty string to remove the time (make it general). Omit to keep existing time.',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'New tags. Omit to keep existing tags.',
        },
      },
      required: ['search_text'],
    },
  },
}

const READ_SKILL_TOOL: AgentToolDefinition = {
  type: 'function',
  function: {
    name: 'read_skill',
    description:
      'Load the full instructions for an Agent Skill by name (from the skills catalog in the system prompt). Call this BEFORE following a skill workflow. Returns the SKILL.md markdown body.',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Skill name exactly as listed in the available skills catalog.',
        },
      },
      required: ['name'],
    },
  },
}

const ENTER_PLAN_MODE_TOOL: AgentToolDefinition = {
  type: 'function',
  function: {
    name: 'enter_plan_mode',
    description:
      'Switch the conversation into Plan mode. Call this when the task is complex, risky, or has meaningful tradeoffs — before making any changes — or whenever the user explicitly asks for a plan. Plan mode explores read-only and presents an editable plan card for approval before anything is implemented.',
    parameters: { type: 'object', properties: {} },
  },
}

const UPDATE_PLAN_PROGRESS_TOOL: AgentToolDefinition = {
  type: 'function',
  function: {
    name: 'update_plan_progress',
    description:
      'Mark one or more approved-plan steps as done (or reopen them) while implementing. Call this when you finish a plan step — do not rely on the UI guessing from file edits. Prefer step_ids from the build prompt; otherwise use 1-based step_indexes.',
    parameters: {
      type: 'object',
      properties: {
        step_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Plan step id(s) from the build prompt (e.g. ps-…).',
        },
        step_id: {
          type: 'string',
          description: 'Single plan step id (alias for step_ids with one entry).',
        },
        step_indexes: {
          type: 'array',
          items: { type: 'number', minimum: 1 },
          description: '1-based step number(s) matching the numbered Steps list.',
        },
        step_index: {
          type: 'number',
          description: 'Single 1-based step number (alias for step_indexes).',
        },
        status: {
          type: 'string',
          enum: ['done', 'pending'],
          description: 'done (default) marks complete; pending clears the check.',
        },
      },
    },
  },
}

const MCP_LIST_TOOLS_TOOL: AgentToolDefinition = {
  type: 'function',
  function: {
    name: MCP_LIST_TOOLS_NAME,
    description:
      'Search/list external MCP tools. Returns ONLY short names + one-line descriptions (no schemas). Always pass a focused query when possible. Then use mcp_get_tool for ONE tool schema before mcp_call.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Required for large catalogs: filter by server/tool/description (e.g. "image", "runware list", "wangp").',
        },
        limit: {
          type: 'number',
          description: 'Max matches to return (default 12, max 20).',
        },
      },
    },
  },
}

const MCP_GET_TOOL_TOOL: AgentToolDefinition = {
  type: 'function',
  function: {
    name: MCP_GET_TOOL_NAME,
    description:
      'Load the full input JSON Schema for exactly ONE MCP tool (by qualified name mcp__server__tool). Do not call this for many tools — one at a time.',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Qualified MCP tool name from mcp_list_tools, e.g. mcp__runware__list_models',
        },
      },
      required: ['name'],
    },
  },
}

const MCP_CALL_TOOL: AgentToolDefinition = {
  type: 'function',
  function: {
    name: MCP_CALL_NAME,
    description:
      'Execute one MCP tool by qualified name. Prefer mcp_get_tool first if you need the argument schema. Large results are saved under ~/.voidcast/mcp-results/ with a short preview — then use mcp_read_result. Blocked in Plan mode.',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Qualified MCP tool name, e.g. mcp__runware__list_models',
        },
        arguments: {
          type: 'object',
          description: 'Arguments object for the MCP tool (must match its input schema).',
        },
      },
      required: ['name'],
    },
  },
}

const MCP_READ_RESULT_TOOL: AgentToolDefinition = {
  type: 'function',
  function: {
    name: MCP_READ_RESULT_NAME,
    description:
      'Read a previously saved large MCP tool result from ~/.voidcast/mcp-results/ (path from <persisted-output>). Prefer item_offset/item_limit/query for JSON arrays, or start_line/end_line / offset/max_chars for text. Do not invent paths.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Absolute path from the <persisted-output> message.',
        },
        start_line: {
          type: 'number',
          description: '1-based start line (text paging).',
        },
        end_line: {
          type: 'number',
          description: '1-based end line (text paging).',
        },
        offset: {
          type: 'number',
          description: 'Character offset for text paging (default 0).',
        },
        max_chars: {
          type: 'number',
          description: 'Max characters to return for text paging (default 8000, max 50000).',
        },
        item_offset: {
          type: 'number',
          description: 'For JSON arrays: 0-based item index to start from.',
        },
        item_limit: {
          type: 'number',
          description: 'For JSON arrays: how many items to return (default 20, max 100).',
        },
        query: {
          type: 'string',
          description: 'For JSON arrays: keep items whose JSON text contains this substring.',
        },
      },
      required: ['path'],
    },
  },
}

export function buildToolsList(
  enabled: ToolsEnabled,
  skillsEnabled = false,
  opts?: { agentMode?: AgentChatMode; mcpTools?: McpToolInfo[]; subAgentCodingEnabled?: boolean },
): AgentToolDefinition[] {
  const planMode = opts?.agentMode === 'plan'
  const out: AgentToolDefinition[] = []
  if (enabled.webSearch) out.push(WEB_SEARCH_TOOL)
  if (enabled.youtube) out.push(SEARCH_YOUTUBE_TOOL)
  if (enabled.reddit) out.push(REDDIT_FEED_TOOL)
  if (enabled.weather) out.push(GET_WEATHER_TOOL)
  if (enabled.scrape) out.push(SCRAPE_URL_TOOL)
  if (enabled.pdf && !planMode) out.push(SAVE_PDF_TOOL)
  // Vision recall is independent of Runware generate/edit.
  out.push(IMAGE_RECALL_TOOL)
  if (enabled.runwareImage && !planMode) {
    out.push(GENERATE_IMAGE_TOOL)
    out.push(EDIT_IMAGE_RUNWARE_TOOL)
  }
  if (enabled.runwareMusic && !planMode) out.push(GENERATE_MUSIC_RUNWARE_TOOL)
  if (enabled.coding) {
    out.push(CODING_LIST_DIRECTORY_TOOL)
    out.push(CODING_READ_FILE_TOOL)
    if (!planMode) {
      out.push(CODING_WRITE_FILE_TOOL)
      out.push(CODING_EDIT_CODE_TOOL)
    }
    out.push(CODING_SEARCH_FILES_TOOL)
    out.push(CODING_GLOB_FILES_TOOL)
    out.push(CODING_FIND_SYMBOLS_TOOL)
    out.push(CODING_GIT_STATUS_TOOL)
    out.push(CODING_GIT_DIFF_TOOL)
    out.push(CODING_GIT_LOG_TOOL)
    out.push(CODING_GIT_SHOW_TOOL)
    out.push(CODING_CHECK_TYPES_TOOL)
    out.push(CODING_LIST_PROCESSES_TOOL)
    out.push(CODING_READ_PROCESS_OUTPUT_TOOL)
    if (!planMode) {
      out.push(CODING_GIT_RESTORE_TOOL)
      out.push(CODING_GIT_STASH_TOOL)
      out.push(CODING_EXECUTE_COMMAND_TOOL)
      out.push(CODING_STOP_PROCESS_TOOL)
    }
    if (opts?.subAgentCodingEnabled) out.push(CODING_EXPLORE_TOOL)
  }
  if (skillsEnabled) out.push(READ_SKILL_TOOL)
  if (enabled.enterPlan && !planMode) out.push(ENTER_PLAN_MODE_TOOL)
  if (!planMode) out.push(UPDATE_PLAN_PROGRESS_TOOL)
  if (!planMode) out.push(UPDATE_SETTINGS_TOOL)
  if (!planMode) out.push(ADD_REMINDER_TOOL)
  out.push(LIST_REMINDERS_TOOL)
  if (!planMode) {
    out.push(DELETE_REMINDER_TOOL)
    out.push(UPDATE_REMINDER_TOOL)
  }
  // MCP progressive disclosure: catalog / get-one-schema / call (never dump all schemas).
  if (opts?.mcpTools?.length) {
    out.push(MCP_LIST_TOOLS_TOOL)
    out.push(MCP_GET_TOOL_TOOL)
    out.push(MCP_READ_RESULT_TOOL)
    if (!planMode) out.push(MCP_CALL_TOOL)
  }
  return out
}

export function anyToolEnabled(
  enabled: ToolsEnabled,
  skillsEnabled = false,
  mcpEnabled = false,
): boolean {
  return (
    enabled.webSearch ||
    enabled.youtube ||
    enabled.reddit ||
    enabled.weather ||
    enabled.scrape ||
    enabled.pdf ||
    enabled.runwareImage ||
    enabled.runwareMusic ||
    enabled.coding ||
    enabled.enterPlan ||
    skillsEnabled ||
    mcpEnabled
  )
}
