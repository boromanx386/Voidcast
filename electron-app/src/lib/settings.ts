export type VoiceMode = 'design' | 'clone'

/** UI shell: dystopian (neon/CRT) vs minimal (zinc/indigo, no overlays) */
export type UiTheme = 'dystopian' | 'minimal'

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
  /** Generate images via Runware API */
  runwareImage: boolean
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
  /** Visual chrome: cyberpunk shell vs calmer zinc/indigo layout */
  uiTheme: UiTheme
  /** Runware REST base URL */
  runwareApiBaseUrl: string
  /** Runware API key (stored locally on this device) */
  runwareApiKey: string
  /** Default Runware model id for text-to-image */
  runwareImageModel: string
  /** Default output width for generated images */
  runwareWidth: number
  /** Default output height for generated images */
  runwareHeight: number
  /** Default inference steps for image generation */
  runwareSteps: number
  /** Default guidance scale (model-dependent effect) */
  runwareCfgScale: number
  /** Optional default negative prompt */
  runwareNegativePrompt: string
  /** Auto-save generated Runware images to this folder (desktop app). */
  runwareImageOutputDir: string
  /** If true, each generated image is saved automatically to output folder. */
  runwareAutoSaveImages: boolean
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
  voiceMode: 'design',
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
    runwareImage: false,
  },
  pdfOutputDir: '',
  uiTheme: 'dystopian',
  runwareApiBaseUrl: 'https://api.runware.ai/v1',
  runwareApiKey: '',
  runwareImageModel: 'runware:101@1',
  runwareWidth: 1024,
  runwareHeight: 1024,
  runwareSteps: 30,
  runwareCfgScale: 7,
  runwareNegativePrompt: '',
  runwareImageOutputDir: '',
  runwareAutoSaveImages: false,
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
      runwareImage:
        typeof te?.runwareImage === 'boolean'
          ? te.runwareImage
          : defaults.toolsEnabled.runwareImage,
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

function normalizeUiTheme(s: AppSettings): AppSettings {
  const t = s.uiTheme
  const uiTheme: UiTheme =
    t === 'minimal' || t === 'dystopian' ? t : 'dystopian'
  return { ...s, uiTheme }
}

function normalizeRunware(s: AppSettings): AppSettings {
  const width = Number(s.runwareWidth)
  const height = Number(s.runwareHeight)
  const steps = Number(s.runwareSteps)
  const cfg = Number(s.runwareCfgScale)
  const apiBase = typeof s.runwareApiBaseUrl === 'string'
    ? s.runwareApiBaseUrl.trim()
    : ''
  const apiKey = typeof s.runwareApiKey === 'string' ? s.runwareApiKey.trim() : ''
  const model =
    typeof s.runwareImageModel === 'string' && s.runwareImageModel.trim()
      ? s.runwareImageModel.trim()
      : defaults.runwareImageModel
  const negative =
    typeof s.runwareNegativePrompt === 'string' ? s.runwareNegativePrompt : ''
  const outputDir =
    typeof s.runwareImageOutputDir === 'string' ? s.runwareImageOutputDir.trim() : ''
  return {
    ...s,
    runwareApiBaseUrl: apiBase || defaults.runwareApiBaseUrl,
    runwareApiKey: apiKey,
    runwareImageModel: model,
    runwareWidth: Number.isFinite(width) ? clamp(Math.round(width), 256, 2048) : defaults.runwareWidth,
    runwareHeight: Number.isFinite(height)
      ? clamp(Math.round(height), 256, 2048)
      : defaults.runwareHeight,
    runwareSteps: Number.isFinite(steps) ? clamp(Math.round(steps), 1, 80) : defaults.runwareSteps,
    runwareCfgScale: Number.isFinite(cfg) ? clamp(cfg, 0, 30) : defaults.runwareCfgScale,
    runwareNegativePrompt: negative,
    runwareImageOutputDir: outputDir,
    runwareAutoSaveImages:
      typeof s.runwareAutoSaveImages === 'boolean'
        ? s.runwareAutoSaveImages
        : defaults.runwareAutoSaveImages,
  }
}

function normalizeAll(s: AppSettings): AppSettings {
  return normalizeRunware(
    normalizeUiTheme(normalizePdfDir(normalizeTools(normalizeLlm(s)))),
  )
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
