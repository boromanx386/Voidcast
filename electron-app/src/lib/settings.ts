export type VoiceMode = 'auto' | 'design' | 'clone'

/** Per-tool toggles; extend with new keys as tools are added */
export type ToolsEnabled = {
  webSearch: boolean
  weather: boolean
  /** Fetch public URL in main process → plain text (HTML stripped) */
  scrape: boolean
  /** Save text as PDF into `pdfOutputDir` (main process) */
  pdf: boolean
  /** YouTube search / video info / transcript (TTS server: yt-dlp + transcript API) */
  youtube: boolean
}

export type AppSettings = {
  ollamaBaseUrl: string
  ollamaModel: string
  /** Ollama options.temperature */
  llmTemperature: number
  /** Ollama options.num_ctx — context window size in tokens */
  llmNumCtx: number
  /**
   * Max prior user/assistant messages per request; 0 = no limit.
   * System prompt is always sent separately.
   */
  llmMaxHistoryMessages: number
  /** System message prepended to each request */
  llmSystemPrompt: string
  ttsBaseUrl: string
  voiceInstruct: string
  /** auto = no instruct; design = instruct; clone = ref_audio + optional ref_text */
  voiceMode: VoiceMode
  /** Reference transcript for clone; empty = model may use Whisper (slower) */
  cloneRefText: string
  /** Play TTS automatically after assistant reply finishes */
  autoVoice: boolean
  /** TTS generate speed (>1 faster) */
  ttsSpeed: number
  /** Diffusion steps (fewer = faster, lower quality) */
  ttsNumStep: number
  /** Fixed duration in seconds; null = automatic */
  ttsDurationSec: number | null
  /** Long text split into chunks; approximate chars per chunk */
  ttsChunkMaxChars: number
  /** Short line spoken when baking a voice anchor (auto/design → consistent chunks) */
  voiceBakePhrase: string
  /** Which LLM tools are registered with Ollama (see Tools settings tab) */
  toolsEnabled: ToolsEnabled
  /** Where `save_pdf` writes files (no dialog). Empty = tool returns an error until set. */
  pdfOutputDir: string
}

import {
  defaultOllamaBaseUrlForRuntime,
  defaultTtsBaseUrlForRuntime,
  isWebStandalone,
} from '@/lib/platform'

const STORAGE_KEY = 'voidcast-settings-v1'
/** Previous key; read once to migrate */
const LEGACY_STORAGE_KEY = 'omnivoice-chat-settings-v1'

const defaults: AppSettings = {
  ollamaBaseUrl: 'http://localhost:11434',
  ollamaModel: 'llama3.2',
  llmTemperature: 0.8,
  llmNumCtx: 8192,
  llmMaxHistoryMessages: 0,
  llmSystemPrompt: '',
  ttsBaseUrl: 'http://127.0.0.1:8765',
  voiceInstruct: '',
  voiceMode: 'auto',
  cloneRefText: '',
  autoVoice: false,
  ttsSpeed: 1.0,
  ttsNumStep: 32,
  ttsDurationSec: null,
  ttsChunkMaxChars: 380,
  voiceBakePhrase: 'This is my reference voice for consistent synthesis.',
  toolsEnabled: {
    webSearch: false,
    weather: false,
    scrape: false,
    pdf: false,
    youtube: false,
  },
  pdfOutputDir: '',
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

function normalizeTools(s: AppSettings): AppSettings {
  const te = s.toolsEnabled
  return {
    ...s,
    toolsEnabled: {
      webSearch:
        typeof te?.webSearch === 'boolean' ? te.webSearch : defaults.toolsEnabled.webSearch,
      weather:
        typeof te?.weather === 'boolean' ? te.weather : defaults.toolsEnabled.weather,
      scrape: typeof te?.scrape === 'boolean' ? te.scrape : defaults.toolsEnabled.scrape,
      pdf: typeof te?.pdf === 'boolean' ? te.pdf : defaults.toolsEnabled.pdf,
      youtube:
        typeof te?.youtube === 'boolean' ? te.youtube : defaults.toolsEnabled.youtube,
    },
  }
}

function normalizeLlm(s: AppSettings): AppSettings {
  const t = Number(s.llmTemperature)
  const ctx = Number(s.llmNumCtx)
  const hist = Number(s.llmMaxHistoryMessages)
  return {
    ...s,
    llmTemperature: Number.isFinite(t) ? clamp(t, 0, 2) : defaults.llmTemperature,
    llmNumCtx: Number.isFinite(ctx)
      ? clamp(Math.round(ctx), 512, 262144)
      : defaults.llmNumCtx,
    llmMaxHistoryMessages: Number.isFinite(hist)
      ? clamp(Math.round(hist), 0, 500)
      : defaults.llmMaxHistoryMessages,
    llmSystemPrompt:
      typeof s.llmSystemPrompt === 'string' ? s.llmSystemPrompt : '',
  }
}

function normalizePdfDir(s: AppSettings): AppSettings {
  const dir = typeof s.pdfOutputDir === 'string' ? s.pdfOutputDir.trim() : ''
  return { ...s, pdfOutputDir: dir }
}

function normalizeAll(s: AppSettings): AppSettings {
  return normalizePdfDir(normalizeTools(normalizeLlm(s)))
}

/** On phone browser, localhost / 127.0.0.1 point at the device — never reach the desktop server. */
function ollamaUrlShouldUseDesktopProxy(url: string): boolean {
  const u = url.trim()
  if (!u) return true
  try {
    const parsed = new URL(u.includes('://') ? u : `http://${u}`)
    const h = parsed.hostname.toLowerCase()
    return h === 'localhost' || h === '127.0.0.1'
  } catch {
    return true
  }
}

export function loadSettings(): AppSettings {
  let merged: AppSettings
  try {
    const rawNew = localStorage.getItem(STORAGE_KEY)
    const rawLegacy = localStorage.getItem(LEGACY_STORAGE_KEY)
    const raw = rawNew ?? rawLegacy
    if (!raw) {
      merged = { ...defaults }
    } else {
      const parsed = JSON.parse(raw) as Partial<AppSettings>
      merged = normalizeAll({ ...defaults, ...parsed })
      if (!rawNew && rawLegacy) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(merged))
      }
    }
  } catch {
    merged = { ...defaults }
  }

  if (typeof window !== 'undefined' && isWebStandalone()) {
    merged = {
      ...merged,
      ttsBaseUrl: defaultTtsBaseUrlForRuntime(),
      ollamaBaseUrl: ollamaUrlShouldUseDesktopProxy(merged.ollamaBaseUrl)
        ? defaultOllamaBaseUrlForRuntime()
        : merged.ollamaBaseUrl,
    }
  }
  return merged
}

export function saveSettings(s: AppSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
}

export function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '')
}
