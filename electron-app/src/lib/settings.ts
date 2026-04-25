export type VoiceMode = 'design' | 'clone'

/** UI shell: dystopian (neon/CRT), minimal (zinc/indigo), matrix (soft green), light (warm paper) */
export type UiTheme = 'dystopian' | 'minimal' | 'matrix' | 'light'

export type RunwareModelProfile = {
  width: number
  height: number
  steps: number
  cfgScale: number
  /** OpenAI GPT Image quality setting (used only for GPT Image models). */
  gptQuality?: 'auto' | 'low' | 'medium' | 'high'
}

export const RUNWARE_FLUX_9B_MODEL_ID = 'runware:400@6'
export const RUNWARE_GPT_IMAGE_2_MODEL_ID = 'openai:gpt-image@2'
export const RUNWARE_Z_IMAGE_TURBO_MODEL_ID = 'runware:z-image@turbo'
export const RUNWARE_CONFIGURED_MODELS: Array<{ id: string; label: string }> = [
  { id: RUNWARE_FLUX_9B_MODEL_ID, label: 'FLUX 9B' },
  { id: RUNWARE_Z_IMAGE_TURBO_MODEL_ID, label: 'Z Image Turbo' },
  { id: RUNWARE_GPT_IMAGE_2_MODEL_ID, label: 'GPT Image 2' },
]

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
  /** Generate music/audio via Runware ACE-Step model */
  runwareMusic: boolean
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
  /** Default Runware model id for image editing with references */
  runwareEditModel: string
  /** Default output width for generated images */
  runwareWidth: number
  /** Default output height for generated images */
  runwareHeight: number
  /** Default inference steps for image generation */
  runwareSteps: number
  /** Default guidance scale (model-dependent effect) */
  runwareCfgScale: number
  /** Per-model defaults used for generation/edit parameters */
  runwareModelProfiles: Record<string, RunwareModelProfile>
  /** Optional default negative prompt */
  runwareNegativePrompt: string
  /** Auto-save generated Runware images to this folder (desktop app). */
  runwareImageOutputDir: string
  /** If true, each generated image is saved automatically to output folder. */
  runwareAutoSaveImages: boolean
  /** Runware music output format. */
  runwareMusicOutputFormat: 'MP3' | 'WAV' | 'FLAC' | 'OGG'
  /** Runware music duration in seconds. */
  runwareMusicDurationSec: number
  /** Runware music inference steps. */
  runwareMusicSteps: number
  /** Runware music guidance scale. */
  runwareMusicCfgScale: number
  /** Runware music guidance type. */
  runwareMusicGuidanceType: 'apg' | 'cfg'
  /** Runware music vocals language (ISO 639-1 code or unknown). */
  runwareMusicVocalLanguage: string
  /** Optional fixed Runware seed for reproducible music generation. */
  runwareMusicSeed: number | null
  /** Auto-save generated Runware music to this folder (desktop app). */
  runwareMusicOutputDir: string
  /** If true, each generated music file is saved automatically to output folder. */
  runwareAutoSaveMusic: boolean
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
    runwareMusic: false,
  },
  pdfOutputDir: '',
  uiTheme: 'dystopian',
  runwareApiBaseUrl: 'https://api.runware.ai/v1',
  runwareApiKey: '',
  runwareImageModel: RUNWARE_FLUX_9B_MODEL_ID,
  runwareEditModel: RUNWARE_FLUX_9B_MODEL_ID,
  runwareWidth: 1024,
  runwareHeight: 1024,
  runwareSteps: 4,
  runwareCfgScale: 1,
  runwareModelProfiles: {
    [RUNWARE_FLUX_9B_MODEL_ID]: {
      width: 1024,
      height: 1024,
      steps: 4,
      cfgScale: 1,
    },
    [RUNWARE_GPT_IMAGE_2_MODEL_ID]: {
      width: 1024,
      height: 1024,
      steps: 30,
      cfgScale: 7,
      gptQuality: 'auto',
    },
    [RUNWARE_Z_IMAGE_TURBO_MODEL_ID]: {
      width: 1024,
      height: 1024,
      steps: 8,
      cfgScale: 1,
    },
  },
  runwareNegativePrompt: '',
  runwareImageOutputDir: '',
  runwareAutoSaveImages: false,
  runwareMusicOutputFormat: 'MP3',
  runwareMusicDurationSec: 60,
  runwareMusicSteps: 10,
  runwareMusicCfgScale: 10,
  runwareMusicGuidanceType: 'apg',
  runwareMusicVocalLanguage: 'en',
  runwareMusicSeed: null,
  runwareMusicOutputDir: '',
  runwareAutoSaveMusic: false,
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
      runwareMusic:
        typeof te?.runwareMusic === 'boolean'
          ? te.runwareMusic
          : defaults.toolsEnabled.runwareMusic,
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
    t === 'minimal' || t === 'dystopian' || t === 'matrix' || t === 'light' ? t : 'dystopian'
  return { ...s, uiTheme }
}

function normalizeRunware(s: AppSettings): AppSettings {
  const width = Number(s.runwareWidth)
  const height = Number(s.runwareHeight)
  const steps = Number(s.runwareSteps)
  const cfg = Number(s.runwareCfgScale)
  const configuredModelIdSet = new Set(RUNWARE_CONFIGURED_MODELS.map((x) => x.id))
  const apiBase = typeof s.runwareApiBaseUrl === 'string'
    ? s.runwareApiBaseUrl.trim()
    : ''
  const apiKey = typeof s.runwareApiKey === 'string' ? s.runwareApiKey.trim() : ''
  const model =
    typeof s.runwareImageModel === 'string' && s.runwareImageModel.trim()
      ? s.runwareImageModel.trim()
      : defaults.runwareImageModel
  const editModel =
    typeof s.runwareEditModel === 'string' && s.runwareEditModel.trim()
      ? s.runwareEditModel.trim()
      : defaults.runwareEditModel
  const negative =
    typeof s.runwareNegativePrompt === 'string' ? s.runwareNegativePrompt : ''
  const outputDir =
    typeof s.runwareImageOutputDir === 'string' ? s.runwareImageOutputDir.trim() : ''
  const musicOutputFormatRaw = typeof s.runwareMusicOutputFormat === 'string'
    ? s.runwareMusicOutputFormat.trim().toUpperCase()
    : ''
  const musicOutputFormat =
    musicOutputFormatRaw === 'WAV' || musicOutputFormatRaw === 'FLAC' || musicOutputFormatRaw === 'OGG'
      ? musicOutputFormatRaw
      : 'MP3'
  const musicDuration = Number(s.runwareMusicDurationSec)
  const musicSteps = Number(s.runwareMusicSteps)
  const musicCfg = Number(s.runwareMusicCfgScale)
  const musicGuidanceRaw = typeof s.runwareMusicGuidanceType === 'string'
    ? s.runwareMusicGuidanceType.trim().toLowerCase()
    : ''
  const musicGuidanceType = musicGuidanceRaw === 'cfg' ? 'cfg' : 'apg'
  const musicVocalLangRaw = typeof s.runwareMusicVocalLanguage === 'string'
    ? s.runwareMusicVocalLanguage.trim().toLowerCase()
    : ''
  const musicVocalLanguage = musicVocalLangRaw || defaults.runwareMusicVocalLanguage
  const musicSeedRaw = Number(s.runwareMusicSeed)
  const musicSeed = Number.isFinite(musicSeedRaw)
    ? clamp(Math.round(musicSeedRaw), 0, 2147483647)
    : null
  const musicOutputDir =
    typeof s.runwareMusicOutputDir === 'string' ? s.runwareMusicOutputDir.trim() : ''
  const legacyProfile: RunwareModelProfile = {
    width: Number.isFinite(width) ? clamp(Math.round(width), 256, 2048) : defaults.runwareWidth,
    height: Number.isFinite(height)
      ? clamp(Math.round(height), 256, 2048)
      : defaults.runwareHeight,
    steps: Number.isFinite(steps) ? clamp(Math.round(steps), 1, 80) : defaults.runwareSteps,
    cfgScale: Number.isFinite(cfg) ? clamp(cfg, 0, 30) : defaults.runwareCfgScale,
  }
  const parsedProfiles =
    s.runwareModelProfiles && typeof s.runwareModelProfiles === 'object'
      ? (s.runwareModelProfiles as Record<string, Partial<RunwareModelProfile>>)
      : {}
  const normalizedProfiles: Record<string, RunwareModelProfile> = {}
  for (const m of RUNWARE_CONFIGURED_MODELS) {
    const fallback =
      m.id === RUNWARE_FLUX_9B_MODEL_ID
        ? legacyProfile
        : defaults.runwareModelProfiles[m.id] ?? legacyProfile
    const incoming = parsedProfiles[m.id] ?? {}
    const w = Number(incoming.width)
    const h = Number(incoming.height)
    const st = Number(incoming.steps)
    const cf = Number(incoming.cfgScale)
    const gptQualityRaw = typeof incoming.gptQuality === 'string' ? incoming.gptQuality : ''
    const normalizedGptQuality =
      gptQualityRaw === 'auto' || gptQualityRaw === 'low' || gptQualityRaw === 'medium' || gptQualityRaw === 'high'
        ? gptQualityRaw
        : undefined
    const isGptImage2 = m.id === RUNWARE_GPT_IMAGE_2_MODEL_ID
    const isZImageTurbo = m.id === RUNWARE_Z_IMAGE_TURBO_MODEL_ID
    const minSide = isGptImage2 ? 480 : isZImageTurbo ? 128 : 256
    const maxSide = isGptImage2 ? 3840 : 2048
    normalizedProfiles[m.id] = {
      width: Number.isFinite(w) ? clamp(Math.round(w), minSide, maxSide) : fallback.width,
      height: Number.isFinite(h) ? clamp(Math.round(h), minSide, maxSide) : fallback.height,
      steps: Number.isFinite(st) ? clamp(Math.round(st), 1, 80) : fallback.steps,
      cfgScale: Number.isFinite(cf) ? clamp(cf, 0, 30) : fallback.cfgScale,
      ...(isGptImage2
        ? {
            gptQuality:
              normalizedGptQuality ??
              fallback.gptQuality ??
              defaults.runwareModelProfiles[RUNWARE_GPT_IMAGE_2_MODEL_ID]?.gptQuality ??
              'auto',
          }
        : {}),
    }
  }
  const safeModel = configuredModelIdSet.has(model) ? model : defaults.runwareImageModel
  const safeEditModel = configuredModelIdSet.has(editModel) ? editModel : defaults.runwareEditModel
  const activeProfile =
    normalizedProfiles[safeModel] ??
    defaults.runwareModelProfiles[safeModel] ??
    defaults.runwareModelProfiles[defaults.runwareImageModel]
  return {
    ...s,
    runwareApiBaseUrl: apiBase || defaults.runwareApiBaseUrl,
    runwareApiKey: apiKey,
    runwareImageModel: safeModel,
    runwareEditModel: safeEditModel,
    runwareWidth: activeProfile.width,
    runwareHeight: activeProfile.height,
    runwareSteps: activeProfile.steps,
    runwareCfgScale: activeProfile.cfgScale,
    runwareModelProfiles: normalizedProfiles,
    runwareNegativePrompt: negative,
    runwareImageOutputDir: outputDir,
    runwareAutoSaveImages:
      typeof s.runwareAutoSaveImages === 'boolean'
        ? s.runwareAutoSaveImages
        : defaults.runwareAutoSaveImages,
    runwareMusicOutputFormat: musicOutputFormat,
    runwareMusicDurationSec: Number.isFinite(musicDuration)
      ? clamp(musicDuration, 6, 300)
      : defaults.runwareMusicDurationSec,
    runwareMusicSteps: Number.isFinite(musicSteps)
      ? clamp(Math.round(musicSteps), 1, 20)
      : defaults.runwareMusicSteps,
    runwareMusicCfgScale: Number.isFinite(musicCfg)
      ? clamp(musicCfg, 1, 30)
      : defaults.runwareMusicCfgScale,
    runwareMusicGuidanceType: musicGuidanceType,
    runwareMusicVocalLanguage: musicVocalLanguage,
    runwareMusicSeed: musicSeed,
    runwareMusicOutputDir: musicOutputDir,
    runwareAutoSaveMusic:
      typeof s.runwareAutoSaveMusic === 'boolean'
        ? s.runwareAutoSaveMusic
        : defaults.runwareAutoSaveMusic,
  }
}

function normalizeAll(s: AppSettings): AppSettings {
  return normalizeRunware(
    normalizeUiTheme(normalizePdfDir(normalizeTools(normalizeLlm(s)))),
  )
}

function applyWebRuntimeOverrides(s: AppSettings): AppSettings {
  if (typeof window !== 'undefined' && isWebStandalone()) {
    return {
      ...s,
      ttsBaseUrl: defaultTtsBaseUrlForRuntime(),
      ollamaBaseUrl: ollamaUrlShouldUseDesktopProxy(s.ollamaBaseUrl)
        ? defaultOllamaBaseUrlForRuntime()
        : s.ollamaBaseUrl,
      // Browser/LAN UI has no desktop WAV clone file; synced "clone" would fail. TTS uses instruct (+ optional anchor baked on this device).
      voiceMode: 'design',
    }
  }
  return s
}

export function normalizeSettingsCandidate(candidate: Partial<AppSettings>): AppSettings {
  return applyWebRuntimeOverrides(normalizeAll({ ...defaults, ...candidate }))
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

  return applyWebRuntimeOverrides(merged)
}

export function saveSettings(s: AppSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
}

export function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '')
}

export function getRunwareProfileForModel(
  s: Pick<AppSettings, 'runwareModelProfiles'>,
  modelId: string,
): RunwareModelProfile {
  const incoming = s.runwareModelProfiles?.[modelId]
  if (incoming) return incoming
  const fallback = defaults.runwareModelProfiles[modelId]
  if (fallback) return fallback
  return defaults.runwareModelProfiles[defaults.runwareImageModel]
}

export async function fetchDesktopSyncedSettings(
  ttsBaseUrl: string,
): Promise<Partial<AppSettings> | null> {
  const root = normalizeBaseUrl(ttsBaseUrl || defaultTtsBaseUrlForRuntime())
  try {
    const res = await fetch(`${root}/tools/desktop-settings`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    })
    if (!res.ok) return null
    const body = (await res.json().catch(() => ({}))) as {
      ok?: boolean
      hasSettings?: boolean
      settings?: Partial<AppSettings>
    }
    if (!body.ok || !body.hasSettings || !body.settings || typeof body.settings !== 'object') {
      return null
    }
    return body.settings
  } catch {
    return null
  }
}
