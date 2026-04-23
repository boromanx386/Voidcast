import type { ToolsEnabled } from '@/lib/settings'

/** Ollama /api/chat `tools` entry (OpenAI-style function tool) */
export type OllamaToolDefinition = {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: {
      type: 'object'
      properties: Record<string, { type: string; description?: string }>
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
      'Save content as a formatted PDF into the user-configured output folder (Options → Tools). You MUST call this function to create a real file; do not claim a PDF was saved without calling it. Pass content (full body), optional title and filename. Content may use Markdown-style: # headings, - bullets, | tables |, --- rules, **bold**.',
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
      'Generate an image with Runware from a text prompt. Use when the user asks to create an image, illustration, render, poster, logo, wallpaper, concept art, or similar visual asset.',
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
      'Generate music/audio with Runware ACE-Step v1.5 Turbo from a text prompt. Use when the user asks to create a song, beat, background music, jingle, soundtrack, or vocals.',
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
    enabled.runwareMusic
  )
}
