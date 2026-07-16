import { AGENT_EDITABLE_SETTINGS_FIELDS, type ToolsEnabled } from '@/lib/settings'
import type { AgentChatMode } from '@/types/chat'

/** Tools that mutate the system / filesystem / media — blocked in Plan mode. */
export const PLAN_MODE_BLOCKED_TOOLS = new Set([
  'write_file',
  'edit_code',
  'execute_command',
  'save_pdf',
  'generate_image',
  'edit_image_runware',
  'generate_music_runware',
  'update_settings',
  'add_reminder',
  'delete_reminder',
  'update_reminder',
  'update_plan_progress',
])

export function isPlanModeBlockedTool(name: string): boolean {
  return PLAN_MODE_BLOCKED_TOOLS.has(name)
}

/** Minimal JSON-schema subset for tool `parameters.properties` values */
export type OllamaToolParameterSchema = {
  type: string
  description?: string
  enum?: readonly string[]
  items?: { type: string; minimum?: number }
}

/** Ollama /api/chat `tools` entry (OpenAI-style function tool) */
export type OllamaToolDefinition = {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: {
      type: 'object'
      properties: Record<string, OllamaToolParameterSchema>
      required?: string[]
    }
  }
}

const GET_WEATHER_TOOL: OllamaToolDefinition = {
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

const SCRAPE_URL_TOOL: OllamaToolDefinition = {
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

const SAVE_PDF_TOOL: OllamaToolDefinition = {
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

const WEB_SEARCH_TOOL: OllamaToolDefinition = {
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

const REDDIT_FEED_TOOL: OllamaToolDefinition = {
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

const SEARCH_YOUTUBE_TOOL: OllamaToolDefinition = {
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

const GENERATE_IMAGE_TOOL: OllamaToolDefinition = {
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

const EDIT_IMAGE_RUNWARE_TOOL: OllamaToolDefinition = {
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

const IMAGE_RECALL_TOOL: OllamaToolDefinition = {
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

const GENERATE_MUSIC_RUNWARE_TOOL: OllamaToolDefinition = {
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

const UPDATE_SETTINGS_TOOL: OllamaToolDefinition = {
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

const CODING_LIST_DIRECTORY_TOOL: OllamaToolDefinition = {
  type: 'function',
  function: {
    name: 'list_directory',
    description:
      'List files and folders inside the configured coding project directory. Use this to browse project structure before reading or editing files.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Optional relative path inside coding project. Empty means project root.',
        },
      },
    },
  },
}

const CODING_READ_FILE_TOOL: OllamaToolDefinition = {
  type: 'function',
  function: {
    name: 'read_file',
    description:
      'Read a file from the configured coding project. Binary files (e.g. containing null bytes) are rejected. Prefer start_line/end_line or max_chars on large files (whole-file reads above ~220k characters are rejected unless you use a range). Lines are returned as N|text with 1-based line numbers.',
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
      },
      required: ['path'],
    },
  },
}

const CODING_WRITE_FILE_TOOL: OllamaToolDefinition = {
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

const CODING_EDIT_CODE_TOOL: OllamaToolDefinition = {
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
      },
      required: ['path', 'find_text', 'replace_text'],
    },
  },
}

const CODING_SEARCH_FILES_TOOL: OllamaToolDefinition = {
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

const CODING_GLOB_FILES_TOOL: OllamaToolDefinition = {
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

const CODING_GIT_STATUS_TOOL: OllamaToolDefinition = {
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

const CODING_GIT_DIFF_TOOL: OllamaToolDefinition = {
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

const CODING_GIT_LOG_TOOL: OllamaToolDefinition = {
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

const CODING_GIT_SHOW_TOOL: OllamaToolDefinition = {
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

const CODING_CHECK_TYPES_TOOL: OllamaToolDefinition = {
  type: 'function',
  function: {
    name: 'check_types',
    description:
      'Run TypeScript typecheck (tsc --noEmit) in the coding project. Use after editing .ts/.tsx files to catch type errors before claiming the fix is complete. Read-only — safe in Plan mode. Requires tsconfig.json in the check root (project root or path_prefix subfolder).',
    parameters: {
      type: 'object',
      properties: {
        path_prefix: {
          type: 'string',
          description:
            'Optional subdirectory inside the project where tsconfig.json lives (e.g. electron-app). Default: project root.',
        },
        paths: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optional list of project-relative file paths to limit reported errors (useful after editing specific files).',
        },
      },
    },
  },
}

const CODING_EXECUTE_COMMAND_TOOL: OllamaToolDefinition = {
  type: 'function',
  function: {
    name: 'execute_command',
    description:
      'MANDATORY: Execute a shell command in the configured coding project directory and return stdout/stderr. CRITICAL: When the user asks to run, execute, build, test, install, start, stop, or invoke any command/script, you MUST call this tool BEFORE responding with any text. Do NOT show example terminal output and claim the command ran - actually call the tool. Do NOT say "I ran the command" or paste fake stdout without calling this tool first. Never claim a command produced output unless this tool returned a real result with stdout/stderr in this turn.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'Shell command to execute.',
        },
        timeout_sec: {
          type: 'number',
          description: 'Optional timeout in seconds (default 20, max 120).',
        },
        run_in_background: {
          type: 'boolean',
          description:
            'If true, starts command in background and returns immediately with process id.',
        },
      },
      required: ['command'],
    },
  },
}

const ADD_REMINDER_TOOL: OllamaToolDefinition = {
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

const LIST_REMINDERS_TOOL: OllamaToolDefinition = {
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

const DELETE_REMINDER_TOOL: OllamaToolDefinition = {
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

const UPDATE_REMINDER_TOOL: OllamaToolDefinition = {
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

const READ_SKILL_TOOL: OllamaToolDefinition = {
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

const ENTER_PLAN_MODE_TOOL: OllamaToolDefinition = {
  type: 'function',
  function: {
    name: 'enter_plan_mode',
    description:
      'Switch the conversation into Plan mode. Call this when the task is complex, risky, or has meaningful tradeoffs — before making any changes — or whenever the user explicitly asks for a plan. Plan mode explores read-only and presents an editable plan card for approval before anything is implemented.',
    parameters: { type: 'object', properties: {} },
  },
}

const UPDATE_PLAN_PROGRESS_TOOL: OllamaToolDefinition = {
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

export function buildOllamaToolsList(
  enabled: ToolsEnabled,
  skillsEnabled = false,
  opts?: { agentMode?: AgentChatMode },
): OllamaToolDefinition[] {
  const planMode = opts?.agentMode === 'plan'
  const out: OllamaToolDefinition[] = []
  if (enabled.webSearch) out.push(WEB_SEARCH_TOOL)
  if (enabled.youtube) out.push(SEARCH_YOUTUBE_TOOL)
  if (enabled.reddit) out.push(REDDIT_FEED_TOOL)
  if (enabled.weather) out.push(GET_WEATHER_TOOL)
  if (enabled.scrape) out.push(SCRAPE_URL_TOOL)
  if (enabled.pdf && !planMode) out.push(SAVE_PDF_TOOL)
  if (enabled.runwareImage) {
    if (!planMode) {
      out.push(GENERATE_IMAGE_TOOL)
      out.push(EDIT_IMAGE_RUNWARE_TOOL)
    }
    out.push(IMAGE_RECALL_TOOL)
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
    out.push(CODING_GIT_STATUS_TOOL)
    out.push(CODING_GIT_DIFF_TOOL)
    out.push(CODING_GIT_LOG_TOOL)
    out.push(CODING_GIT_SHOW_TOOL)
    out.push(CODING_CHECK_TYPES_TOOL)
    if (!planMode) out.push(CODING_EXECUTE_COMMAND_TOOL)
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
  return out
}

export function anyToolEnabled(enabled: ToolsEnabled, skillsEnabled = false): boolean {
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
    skillsEnabled
  )
}
