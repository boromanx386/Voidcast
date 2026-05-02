import { AGENT_EDITABLE_SETTINGS_FIELDS, type ToolsEnabled } from '@/lib/settings'

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
      'Save content as a formatted PDF into the user-configured output folder (Options → Tools). You MUST call this function to create a real file; do not claim a PDF was saved without calling it. Pass content (full body), optional title and filename. Content may use Markdown-style: # headings, `-` / `*` / `•` bullets, `1.` numbered lines, wrapped list continuations (no marker on next line), | tables |, --- rules, **bold**, and single newlines inside a paragraph for intentional line breaks. When the user attached image(s) to their message and wants them in the PDF, set embed_attached_images true and/or attached_image_indices (0-based). PNG and JPEG embed in the PDF after the text.',
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
      'MANDATORY: Generate an image with Runware from a text prompt. CRITICAL: When the user asks to create/make/draw/generate a new image, you MUST call this tool BEFORE responding with any text. Do NOT describe what you would create - actually call the tool. Do NOT say "Here is the image" without calling this tool first. Never claim an image was generated unless this tool returned a real result with image_url; if generation fails, report the tool error.',
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
      'Edit or transform images with Runware using attached chat images as references. Use when the user asks to modify an existing image or combine details from attached images.',
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
      'Recall image bytes from the internal conversation image catalog so the model can analyze or edit historical images in the current runtime turn.',
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
            'Optional absolute image path(s) from chat history (single path or comma/newline-separated list).',
        },
        purpose: {
          type: 'string',
          description:
            'Optional intent for recall usage: "vision" (analysis) or "edit" (image editing).',
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
      'MANDATORY: Generate music/audio with Runware ACE-Step v1.5 Turbo from a text prompt. CRITICAL: When the user asks to create/make/generate a song, beat, background music, jingle, soundtrack, or vocals, you MUST call this tool BEFORE responding with any text. Do NOT describe what music you would create - actually call the tool. Do NOT say "Here is the music" or "I created the song" without calling this tool first. Never claim music was generated unless this tool returned a real result with audio_url; if generation fails, report the tool error.',
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
          description: 'Optional duration in seconds (6-300).',
        },
        steps: {
          type: 'number',
          description: 'Optional number of denoising steps (1-20).',
        },
        cfg_scale: {
          type: 'number',
          description: 'Optional guidance scale (1-30).',
        },
        output_format: {
          type: 'string',
          description: 'Optional output format: MP3, WAV, FLAC, or OGG.',
        },
        seed: {
          type: 'number',
          description: 'Optional fixed seed for reproducible generation.',
        },
        bpm: {
          type: 'number',
          description: 'Optional beats per minute (30-300).',
        },
        key_scale: {
          type: 'string',
          description: 'Optional musical key and scale (for example: "C major", "F# minor").',
        },
        guidance_type: {
          type: 'string',
          description: 'Optional guidance type: apg or cfg.',
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
            'Setting key to update. Allowed: llmSystemPrompt, llmNumCtx, llmTemperature, uiTheme, longMemoryAdd, runwareResolution, runwareWidth, runwareHeight, runwareImageModel, runwareEditModel.',
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
      'Read a file from the configured coding project. Prefer start_line/end_line or max_chars on large files (whole-file reads above ~220k characters are rejected unless you use a range). Lines are returned as N|text with 1-based line numbers.',
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
      'Write full file content in the configured coding project directory. This overwrites file content; read the file first when changing existing code.',
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
      'Edit existing file content by replacing a target snippet with new text inside the configured coding project directory.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative file path inside coding project.',
        },
        find_text: {
          type: 'string',
          description: 'Exact text snippet to find in the file.',
        },
        replace_text: {
          type: 'string',
          description: 'Replacement text snippet.',
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
      'Search file contents under the coding project using a plain-text query (case-insensitive). Skips node_modules, dist, build, .git, and similar folders.',
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
            'File extensions without dot, e.g. ["ts","tsx"]. If omitted, uses a sensible default set (ts, tsx, js, jsx, json, md, css, html, py, rs, go, vue).',
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

const CODING_EXECUTE_COMMAND_TOOL: OllamaToolDefinition = {
  type: 'function',
  function: {
    name: 'execute_command',
    description:
      'Execute a shell command in the configured coding project directory and return stdout/stderr.',
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

export function buildOllamaToolsList(enabled: ToolsEnabled): OllamaToolDefinition[] {
  const out: OllamaToolDefinition[] = []
  if (enabled.webSearch) out.push(WEB_SEARCH_TOOL)
  if (enabled.youtube) out.push(SEARCH_YOUTUBE_TOOL)
  if (enabled.weather) out.push(GET_WEATHER_TOOL)
  if (enabled.scrape) out.push(SCRAPE_URL_TOOL)
  if (enabled.pdf) out.push(SAVE_PDF_TOOL)
  if (enabled.runwareImage) {
    out.push(GENERATE_IMAGE_TOOL)
    out.push(EDIT_IMAGE_RUNWARE_TOOL)
    out.push(IMAGE_RECALL_TOOL)
  }
  if (enabled.runwareMusic) out.push(GENERATE_MUSIC_RUNWARE_TOOL)
  if (enabled.coding) {
    out.push(CODING_LIST_DIRECTORY_TOOL)
    out.push(CODING_READ_FILE_TOOL)
    out.push(CODING_WRITE_FILE_TOOL)
    out.push(CODING_EDIT_CODE_TOOL)
    out.push(CODING_SEARCH_FILES_TOOL)
    out.push(CODING_GLOB_FILES_TOOL)
    out.push(CODING_GIT_STATUS_TOOL)
    out.push(CODING_GIT_DIFF_TOOL)
    out.push(CODING_EXECUTE_COMMAND_TOOL)
  }
  out.push(UPDATE_SETTINGS_TOOL)
  return out
}

export function anyToolEnabled(enabled: ToolsEnabled): boolean {
  return (
    enabled.webSearch ||
    enabled.youtube ||
    enabled.weather ||
    enabled.scrape ||
    enabled.pdf ||
    enabled.runwareImage ||
    enabled.runwareMusic ||
    enabled.coding
  )
}
