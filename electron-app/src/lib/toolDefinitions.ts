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
        width: {
          type: 'number',
          description: 'Optional output width in pixels.',
        },
        height: {
          type: 'number',
          description: 'Optional output height in pixels.',
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

export function buildOllamaToolsList(enabled: ToolsEnabled): OllamaToolDefinition[] {
  const out: OllamaToolDefinition[] = []
  if (enabled.webSearch) out.push(WEB_SEARCH_TOOL)
  if (enabled.youtube) out.push(SEARCH_YOUTUBE_TOOL)
  if (enabled.weather) out.push(GET_WEATHER_TOOL)
  if (enabled.scrape) out.push(SCRAPE_URL_TOOL)
  if (enabled.pdf) out.push(SAVE_PDF_TOOL)
  if (enabled.runwareImage) out.push(GENERATE_IMAGE_TOOL)
  return out
}

export function anyToolEnabled(enabled: ToolsEnabled): boolean {
  return (
    enabled.webSearch ||
    enabled.youtube ||
    enabled.weather ||
    enabled.scrape ||
    enabled.pdf ||
    enabled.runwareImage
  )
}
