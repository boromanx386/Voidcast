import {
  normalizeNvidiaModelId,
  normalizeOpenRouterModelId,
} from '@/lib/cloudLlmPresets'

export type VoiceMode = 'design' | 'clone'
export type TtsProvider = 'local' | 'runware-xai' | 'openrouter-tts'
export type SttProvider = 'none' | 'openrouter'

/** Default OpenRouter TTS model (OpenAI gpt-4o-mini-tts was removed from OpenRouter). */
export const OPENROUTER_TTS_MODEL_DEFAULT = 'google/gemini-3.1-flash-tts-preview'

const RETIRED_OPENROUTER_TTS_MODELS = new Set([
  'openai/gpt-4o-mini-tts-2025-12-15',
  'openai/gpt-4o-mini-tts',
  'gpt-4o-mini-tts-2025-12-15',
  'gpt-4o-mini-tts',
])

const OPENAI_TTS_VOICES = new Set([
  'alloy',
  'ash',
  'ballad',
  'coral',
  'echo',
  'fable',
  'onyx',
  'nova',
  'sage',
  'shimmer',
  'verse',
  'marin',
  'cedar',
])

export const OPENROUTER_TTS_MODEL_PRESETS: Array<{ id: string; label: string }> = [
  { id: OPENROUTER_TTS_MODEL_DEFAULT, label: 'Google Gemini 3.1 Flash TTS' },
  { id: 'hexgrad/kokoro-82m', label: 'hexgrad Kokoro 82M (cheapest)' },
  { id: 'mistralai/voxtral-mini-tts-2603', label: 'Mistral Voxtral Mini TTS' },
  { id: 'x-ai/grok-voice-tts-1.0', label: 'xAI Grok Voice TTS' },
  { id: 'microsoft/mai-voice-2', label: 'Microsoft MAI-Voice-2' },
  { id: 'canopylabs/orpheus-3b-0.1-ft', label: 'Canopy Orpheus 3B' },
]

export const OPENROUTER_TTS_VOICES_BY_MODEL: Record<string, readonly string[]> = {
  [OPENROUTER_TTS_MODEL_DEFAULT]: [
    'Zephyr',
    'Puck',
    'Charon',
    'Kore',
    'Fenrir',
    'Aoede',
    'Leda',
    'Orus',
  ],
  'hexgrad/kokoro-82m': [
    'af_bella',
    'af_heart',
    'af_sarah',
    'am_adam',
    'am_michael',
    'bf_emma',
    'bm_george',
  ],
  'mistralai/voxtral-mini-tts-2603': [
    'en_paul_neutral',
    'en_paul_happy',
    'en_paul_sad',
    'en_paul_excited',
    'en_paul_frustrated',
  ],
  'x-ai/grok-voice-tts-1.0': ['eve', 'ara', 'rex', 'sal', 'leo'],
  'microsoft/mai-voice-2': [
    'en-US-Harper:MAI-Voice-2',
    'es-MX-Valeria:MAI-Voice-2',
    'fr-FR-Soleil:MAI-Voice-2',
    'de-DE-Klaus:MAI-Voice-2',
  ],
  'canopylabs/orpheus-3b-0.1-ft': ['tara', 'leah', 'jess', 'leo', 'dan'],
}

export function openRouterTtsVoicesForModel(model: string): readonly string[] {
  const id = model.trim()
  return OPENROUTER_TTS_VOICES_BY_MODEL[id] ?? OPENROUTER_TTS_VOICES_BY_MODEL[OPENROUTER_TTS_MODEL_DEFAULT]
}

export function openRouterTtsDefaultVoice(model: string): string {
  return openRouterTtsVoicesForModel(model)[0] || 'Kore'
}

export function normalizeOpenRouterTtsModel(model: string | undefined): string {
  const trimmed = (model || '').trim()
  if (!trimmed || RETIRED_OPENROUTER_TTS_MODELS.has(trimmed) || trimmed.startsWith('openai/gpt-4o-mini-tts')) {
    return OPENROUTER_TTS_MODEL_DEFAULT
  }
  return trimmed
}

export const RUNWARE_TTS_MODEL_DEFAULT = 'xai:tts@0'

const INWORLD_TTS_VOICES = [
  'Serena',
  'Claire',
  'James',
  'Olivia',
  'Liam',
  'Graham',
  'Ethan',
  'Victoria',
  'Alex',
  'Ashley',
  'Hank',
  'Julia',
  'Mark',
  'Sarah',
  'Theodore',
] as const

const GEMINI_RUNWARE_TTS_VOICES = [
  'Zephyr',
  'Kore',
  'Puck',
  'Charon',
  'Fenrir',
  'Aoede',
  'Leda',
  'Orus',
] as const

export const RUNWARE_TTS_MODEL_PRESETS: Array<{ id: string; label: string }> = [
  { id: RUNWARE_TTS_MODEL_DEFAULT, label: 'xAI Grok Voice TTS' },
  { id: 'google:gemini@3.1-flash-tts', label: 'Google Gemini 3.1 Flash TTS' },
  { id: 'inworld:tts@1.5-max', label: 'Inworld TTS 1.5 Max' },
  { id: 'inworld:tts@1.5-mini', label: 'Inworld TTS 1.5 Mini' },
  { id: 'minimax:speech@2.8', label: 'MiniMax Speech 2.8' },
  { id: 'alibaba:qwen@3-tts-1.7b-customvoice', label: 'Qwen3-TTS 1.7B CustomVoice' },
  { id: 'fishaudio:s2.1@pro', label: 'Fish Audio S2.1 Pro' },
]

export const RUNWARE_TTS_VOICES_BY_MODEL: Record<string, readonly string[]> = {
  [RUNWARE_TTS_MODEL_DEFAULT]: ['auto', 'eve', 'ara', 'leo', 'rex', 'sal', 'una'],
  'google:gemini@3.1-flash-tts': GEMINI_RUNWARE_TTS_VOICES,
  'inworld:tts@1.5-max': INWORLD_TTS_VOICES,
  'inworld:tts@1.5-mini': INWORLD_TTS_VOICES,
  'minimax:speech@2.8': [
    'English_expressive_narrator',
    'English_radiant_girl',
    'English_magnetic_voiced_man',
    'English_CalmWoman',
    'English_Gentle-voiced_man',
    'English_CaptivatingStoryteller',
    'English_Trustworth_Man',
    'English_PlayfulGirl',
  ],
  'alibaba:qwen@3-tts-1.7b-customvoice': [
    'vivian',
    'serena',
    'ryan',
    'aiden',
    'dylan',
    'eric',
    'sohee',
    'ono_anna',
    'uncle_fu',
  ],
  'fishaudio:s2.1@pro': [
    'b347db033a6549378b48d00acb0d06cd',
    'bf322df2096a46f18c579d0baa36f41d',
    '933563129e564b19a115bedd57b7406a',
    'e3cd384158934cc9a01029cd7d278634',
    '79d0bd3e4e5444b18f7b6d89b5927bf1',
  ],
}

export const RUNWARE_TTS_VOICE_LABELS: Record<string, string> = {
  b347db033a6549378b48d00acb0d06cd: 'Selene',
  bf322df2096a46f18c579d0baa36f41d: 'Adrian',
  '933563129e564b19a115bedd57b7406a': 'Sarah',
  e3cd384158934cc9a01029cd7d278634: 'Laura',
  '79d0bd3e4e5444b18f7b6d89b5927bf1': 'Jordan',
}

export function runwareTtsVoicesForModel(model: string): readonly string[] {
  const id = model.trim()
  return RUNWARE_TTS_VOICES_BY_MODEL[id] ?? RUNWARE_TTS_VOICES_BY_MODEL[RUNWARE_TTS_MODEL_DEFAULT]
}

export function runwareTtsDefaultVoice(model: string): string {
  return runwareTtsVoicesForModel(model)[0] || 'auto'
}

export function normalizeRunwareTtsModel(model: string | undefined): string {
  const trimmed = (model || '').trim()
  return trimmed || RUNWARE_TTS_MODEL_DEFAULT
}

export function runwareTtsSupportsLanguage(model: string): boolean {
  const id = model.trim()
  return (
    id === RUNWARE_TTS_MODEL_DEFAULT ||
    id === 'minimax:speech@2.8' ||
    id === 'alibaba:qwen@3-tts-1.7b-customvoice'
  )
}

export function runwareTtsLanguagePlaceholder(model: string): string {
  const id = model.trim()
  if (id === 'alibaba:qwen@3-tts-1.7b-customvoice') return 'English, Auto, Chinese…'
  if (id === 'minimax:speech@2.8') return 'en, auto, de, es…'
  return 'en, de, es-ES…'
}

function mapRunwareTtsLanguage(model: string, language: string): string | undefined {
  const lang = language.trim()
  const id = model.trim()
  if (id === RUNWARE_TTS_MODEL_DEFAULT) {
    return lang || undefined
  }
  if (id === 'minimax:speech@2.8') {
    return lang || 'auto'
  }
  if (id === 'alibaba:qwen@3-tts-1.7b-customvoice') {
    if (!lang) return 'Auto'
    const lower = lang.toLowerCase()
    const qwenMap: Record<string, string> = {
      auto: 'Auto',
      en: 'English',
      english: 'English',
      zh: 'Chinese',
      chinese: 'Chinese',
      ja: 'Japanese',
      japanese: 'Japanese',
      ko: 'Korean',
      korean: 'Korean',
      de: 'German',
      german: 'German',
      fr: 'French',
      french: 'French',
      ru: 'Russian',
      russian: 'Russian',
      pt: 'Portuguese',
      portuguese: 'Portuguese',
      es: 'Spanish',
      spanish: 'Spanish',
      it: 'Italian',
      italian: 'Italian',
    }
    return qwenMap[lower] || lang
  }
  return undefined
}

export function buildRunwareTtsSpeechPayload(
  model: string,
  text: string,
  voice: string,
  language: string,
): Record<string, unknown> {
  const id = normalizeRunwareTtsModel(model)
  const speech: Record<string, unknown> = {
    text,
    voice: voice.trim() || runwareTtsDefaultVoice(id),
  }
  const mappedLanguage = mapRunwareTtsLanguage(id, language)
  if (mappedLanguage) {
    speech.language = mappedLanguage
  }
  return speech
}

/** @deprecated Use string voice ids from `runwareTtsVoicesForModel`. */
export type RunwareXaiVoice = 'auto' | 'una' | 'leo' | 'eve' | 'ara' | 'sal' | 'rex'
export type LlmProvider = 'ollama' | 'openrouter' | 'nvidia'

/** Ollama `think` request + UI: off sends `think: false`; on = `true`; low/medium/high for GPT-OSS. */
export type LlmThinkLevel = 'off' | 'low' | 'medium' | 'high' | 'on'

/** UI shell: dystopian (neon/CRT), minimal (zinc/indigo), matrix (soft green), light (warm paper), blood-moon (crimson void) */
export type UiTheme = 'dystopian' | 'minimal' | 'matrix' | 'light' | 'blood-moon' | 'obsidian'

export type RunwareModelProfile = {
  width: number
  height: number
  steps: number
  cfgScale: number
  /** OpenAI GPT Image quality setting (used only for GPT Image models). */
  gptQuality?: 'auto' | 'low' | 'medium' | 'high'
}

/** Per-variant defaults for the ACE-Step music model family. */
export type RunwareMusicModelProfile = {
  outputFormat: 'MP3' | 'WAV' | 'FLAC' | 'OGG'
  durationSec: number
  steps: number
  cfgScale: number
  seed: number | null
}

/** Sub-agent config — delegates tasks (vision, etc.) to a separate model. */
export type SubAgentConfig = {
  /** When true, image_recall runs sub-agent instead of returning base64. */
  enabled: boolean
  /** Sub-agent model id (e.g. 'llava:13b', 'gpt-4o'). Provider is auto-detected. */
  model: string
  /** Max generated tokens per sub-agent call (default 1024). */
  outputTokens?: number
  /** Context window size sent to Ollama as num_ctx (default 4096). Ignored by OpenRouter. */
  contextTokens?: number
  /** When true, show the floating analysis panel during image_recall (default on). */
  showAnalysisWindow?: boolean
}

export const RUNWARE_FLUX_9B_MODEL_ID = 'runware:400@6'
export const RUNWARE_GPT_IMAGE_2_MODEL_ID = 'openai:gpt-image@2'
export const RUNWARE_Z_IMAGE_TURBO_MODEL_ID = 'runware:z-image@turbo'
export const RUNWARE_CONFIGURED_MODELS: Array<{ id: string; label: string }> = [
  { id: RUNWARE_FLUX_9B_MODEL_ID, label: 'FLUX 9B' },
  { id: RUNWARE_Z_IMAGE_TURBO_MODEL_ID, label: 'Z Image Turbo' },
  { id: RUNWARE_GPT_IMAGE_2_MODEL_ID, label: 'GPT Image 2' },
]

export const RUNWARE_ACE_STEP_V1_5_TURBO_MODEL_ID = 'runware:ace-step@v1.5-turbo'
export const RUNWARE_ACE_STEP_V1_5_BASE_MODEL_ID = 'runware:ace-step@v1.5-base'
export const RUNWARE_CONFIGURED_MUSIC_MODELS: Array<{ id: string; label: string }> = [
  { id: RUNWARE_ACE_STEP_V1_5_TURBO_MODEL_ID, label: 'ACE-Step v1.5 Turbo' },
  { id: RUNWARE_ACE_STEP_V1_5_BASE_MODEL_ID, label: 'ACE-Step v1.5 Base' },
]
const configuredMusicModelIdSet = new Set<string>(
  RUNWARE_CONFIGURED_MUSIC_MODELS.map((m) => m.id),
)
/** Per-model UI/clamp cap for inference steps (turbo caps low, base allows up to 300). */
export function maxStepsForMusicModelId(modelId: string): number {
  return modelId === RUNWARE_ACE_STEP_V1_5_BASE_MODEL_ID ? 300 : 20
}

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
  /** Reddit read-only feed / search / post fetch via public JSON endpoints (TTS server) */
  reddit: boolean
  /** Generate images via Runware API */
  runwareImage: boolean
  /** Generate music/audio via Runware ACE-Step model */
  runwareMusic: boolean
  /** Local coding tools (file read/write/search + terminal command execution) */
  coding: boolean
}

export type CodingSettings = {
  enabled: boolean
  projectPath: string
  /** Coding panel: show file tree section */
  showFileTree: boolean
  /** Coding panel: show file preview section */
  showFilePreview: boolean
  /** Coding panel: show terminal section */
  showTerminal: boolean
}

export type AppSettings = {
  llmProvider: LlmProvider
  ollamaBaseUrl: string
  ollamaModel: string
  openrouterBaseUrl: string
  openrouterApiKey: string
  openrouterModel: string
  nvidiaBaseUrl: string
  nvidiaApiKey: string
  nvidiaModel: string
  /** Default OpenRouter TTS model id. */
  openrouterTtsModel: string
  /** Optional OpenRouter TTS voice id/preset. */
  openrouterTtsVoice: string
  /** Ollama options.temperature */
  llmTemperature: number
  /** Ollama options.num_ctx — context window size in tokens */
  llmNumCtx: number
  /** Auto-run context compression when prompt usage reaches ~90% of num_ctx. */
  contextAutoCompress: boolean
  /** Default for new chats: whether to include long-term memory retrieval. */
  longMemoryDefaultEnabled: boolean
  /**
   * Ollama `think` level. Thinking models default to on unless `think: false` is sent.
   * OpenRouter/NVIDIA reasoning in the UI is shown when level is not `off`.
   */
  llmThinkLevel: LlmThinkLevel
  /** System message prepended to each request */
  llmSystemPrompt: string
  ttsBaseUrl: string
  /** TTS backend provider. local = OmniVoice HTTP server, runware-xai = Runware xAI TTS. */
  ttsProvider: TtsProvider
  /** STT backend provider. none = disabled, openrouter = OpenRouter Whisper. */
  sttProvider: SttProvider
  /** OpenRouter STT model id (Whisper). */
  openrouterSttModel: string
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
  /** xAI TTS voice id when Runware xAI provider is selected. */
  runwareXaiVoice: string
  /** Runware TTS model id for cloud speech synthesis. */
  runwareTtsModel: string
  /** Optional xAI language code (auto-detect when empty). */
  runwareXaiLanguage: string
  /** Short line spoken when baking a voice anchor (auto/design → consistent chunks) */
  voiceBakePhrase: string
  /** Which LLM tools are registered with Ollama (see Tools settings tab) */
  toolsEnabled: ToolsEnabled
  /** Standalone coding panel settings. */
  coding: CodingSettings
  /** Backward-compatible top-level alias for coding project path. */
  codingProjectPath: string
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
  /** Active Runware music model id (ACE-Step turbo or base). */
  runwareMusicModel: string
  /** Per-variant defaults for the ACE-Step music family. */
  runwareMusicModelProfiles: Record<string, RunwareMusicModelProfile>
  /** Runware music output format (legacy/back-compat; mirrors active profile.outputFormat). */
  runwareMusicOutputFormat: 'MP3' | 'WAV' | 'FLAC' | 'OGG'
  /** Runware music duration in seconds (legacy/back-compat; mirrors active profile.durationSec). */
  runwareMusicDurationSec: number
  /** Runware music inference steps (legacy/back-compat; mirrors active profile.steps). */
  runwareMusicSteps: number
  /** Runware music guidance scale (legacy/back-compat; mirrors active profile.cfgScale). */
  runwareMusicCfgScale: number
  /** Runware music guidance type. */
  runwareMusicGuidanceType: 'apg' | 'cfg'
  /** Runware music vocals language (ISO 639-1 code or unknown). */
  runwareMusicVocalLanguage: string
  /** Optional fixed Runware seed for reproducible music generation (legacy/back-compat). */
  runwareMusicSeed: number | null
  /** Auto-save generated Runware music to this folder (desktop app). */
  runwareMusicOutputDir: string
  /** If true, each generated music file is saved automatically to output folder. */
  runwareAutoSaveMusic: boolean
  /** If true, app should check updates automatically on startup (desktop). */
  autoUpdate: boolean
  /** If true, chat sessions are auto-saved. When off, a manual save button appears. */
  autoSaveChat: boolean
  /** If true, the renderer fires a desktop notification when a scheduled reminder becomes due. */
  reminderNotificationsEnabled: boolean
  /** If true, play the user-selected reply/error sound files on chat events. */
  notificationSoundsEnabled: boolean
  /** Output volume (0–1) for chat notification sounds. */
  notificationSoundVolume: number
  /** Sub-agent for delegating tasks (vision, etc.) to a separate model. */
  subAgent: SubAgentConfig
}

export const AGENT_EDITABLE_SETTINGS_FIELDS = [
  'llmSystemPrompt',
  'llmNumCtx',
  'llmTemperature',
  'uiTheme',
  'longMemoryAdd',
  'autoVoice',
  'runwareResolution',
  'runwareWidth',
  'runwareHeight',
  'runwareImageModel',
  'runwareEditModel',
] as const

export type AgentEditableSettingsField = (typeof AGENT_EDITABLE_SETTINGS_FIELDS)[number]

import {
  defaultOllamaBaseUrlForRuntime,
  defaultTtsBaseUrlForRuntime,
  isLanWebClient,
  nvidiaApiBaseForRuntime,
  openRouterApiBaseForRuntime,
} from '@/lib/platform'

const STORAGE_KEY = 'voidcast-settings-v1'
/** Previous key; read once to migrate */
const LEGACY_STORAGE_KEY = 'omnivoice-chat-settings-v1'
const AGENT_HIDDEN_SETTINGS_FIELDS = ['openrouterApiKey', 'nvidiaApiKey', 'runwareApiKey'] as const

export const defaults: AppSettings = {
  llmProvider: 'ollama',
  ollamaBaseUrl: 'http://localhost:11434',
  ollamaModel: 'llama3.2',
  openrouterBaseUrl: 'https://openrouter.ai/api/v1',
  openrouterApiKey: '',
  openrouterModel: 'openrouter/free',
  nvidiaBaseUrl: 'https://integrate.api.nvidia.com/v1',
  nvidiaApiKey: '',
  nvidiaModel: 'nvidia/nemotron-3-super-120b-a12b',
  openrouterTtsModel: OPENROUTER_TTS_MODEL_DEFAULT,
  openrouterTtsVoice: '',
  llmTemperature: 0.8,
  llmNumCtx: 8192,
  contextAutoCompress: true,
  longMemoryDefaultEnabled: false,
  llmThinkLevel: 'on',
  llmSystemPrompt: '',
  ttsBaseUrl: 'http://127.0.0.1:8765',
  ttsProvider: 'local',
  sttProvider: 'none',
  openrouterSttModel: 'openai/whisper-large-v3-turbo',
  voiceInstruct: '',
  voiceMode: 'design',
  cloneRefText: '',
  autoVoice: false,
  ttsSpeed: 1.0,
  ttsNumStep: 32,
  ttsDurationSec: null,
  ttsChunkMaxChars: 300,
  runwareXaiVoice: 'auto',
  runwareTtsModel: RUNWARE_TTS_MODEL_DEFAULT,
  runwareXaiLanguage: '',
  voiceBakePhrase: 'This is my reference voice for consistent synthesis.',
  toolsEnabled: {
    webSearch: false,
    weather: false,
    scrape: false,
    pdf: false,
    youtube: false,
    reddit: false,
    runwareImage: false,
    runwareMusic: false,
    coding: false,
  },
  coding: {
    enabled: false,
    projectPath: '',
    showFileTree: true,
    showFilePreview: true,
    showTerminal: true,
  },
  codingProjectPath: '',
  pdfOutputDir: '',
  uiTheme: 'minimal',
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
  runwareMusicModel: RUNWARE_ACE_STEP_V1_5_TURBO_MODEL_ID,
  runwareMusicModelProfiles: {
    [RUNWARE_ACE_STEP_V1_5_TURBO_MODEL_ID]: {
      outputFormat: 'MP3',
      durationSec: 60,
      steps: 10,
      cfgScale: 10,
      seed: null,
    },
    [RUNWARE_ACE_STEP_V1_5_BASE_MODEL_ID]: {
      outputFormat: 'MP3',
      durationSec: 60,
      steps: 100,
      cfgScale: 10,
      seed: null,
    },
  },
  runwareMusicOutputFormat: 'MP3',
  runwareMusicDurationSec: 60,
  runwareMusicSteps: 10,
  runwareMusicCfgScale: 10,
  runwareMusicGuidanceType: 'apg',
  runwareMusicVocalLanguage: 'en',
  runwareMusicSeed: null,
  runwareMusicOutputDir: '',
  runwareAutoSaveMusic: false,
  autoUpdate: false,
  autoSaveChat: true,
  reminderNotificationsEnabled: true,
  notificationSoundsEnabled: true,
  notificationSoundVolume: 0.8,
  subAgent: {
    enabled: false,
    model: 'llava:13b',
    outputTokens: 1024,
    contextTokens: 8192,
    showAnalysisWindow: true,
  },
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

function normalizeTools(s: AppSettings): AppSettings {
  const te = s.toolsEnabled
  const codingEnabled =
    typeof te?.coding === 'boolean'
      ? te.coding
      : typeof s.coding?.enabled === 'boolean'
        ? s.coding.enabled
        : defaults.toolsEnabled.coding
  const codingProjectPathRaw =
    typeof s.coding?.projectPath === 'string'
      ? s.coding.projectPath
      : typeof s.codingProjectPath === 'string'
        ? s.codingProjectPath
        : defaults.coding.projectPath
  const codingProjectPath = codingProjectPathRaw.trim()
  const showFileTree =
    typeof s.coding?.showFileTree === 'boolean' ? s.coding.showFileTree : defaults.coding.showFileTree
  const showFilePreview =
    typeof s.coding?.showFilePreview === 'boolean'
      ? s.coding.showFilePreview
      : defaults.coding.showFilePreview
  const showTerminal =
    typeof s.coding?.showTerminal === 'boolean' ? s.coding.showTerminal : defaults.coding.showTerminal
  let st = showFileTree
  let sp = showFilePreview
  let sm = showTerminal
  if (!st && !sp && !sm) {
    st = defaults.coding.showFileTree
    sp = defaults.coding.showFilePreview
    sm = defaults.coding.showTerminal
  }
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
      reddit:
        typeof te?.reddit === 'boolean' ? te.reddit : defaults.toolsEnabled.reddit,
      runwareImage:
        typeof te?.runwareImage === 'boolean'
          ? te.runwareImage
          : defaults.toolsEnabled.runwareImage,
      runwareMusic:
        typeof te?.runwareMusic === 'boolean'
          ? te.runwareMusic
          : defaults.toolsEnabled.runwareMusic,
      coding: codingEnabled,
    },
    coding: {
      enabled: codingEnabled,
      projectPath: codingProjectPath,
      showFileTree: st,
      showFilePreview: sp,
      showTerminal: sm,
    },
    codingProjectPath,
  }
}

const LLM_THINK_LEVELS = new Set<LlmThinkLevel>(['off', 'low', 'medium', 'high', 'on'])

export function normalizeLlmThinkLevel(
  saved: Record<string, unknown> | AppSettings,
  fallback: LlmThinkLevel = defaults.llmThinkLevel,
): LlmThinkLevel {
  const raw = (saved as Record<string, unknown>).llmThinkLevel
  if (typeof raw === 'string' && LLM_THINK_LEVELS.has(raw as LlmThinkLevel)) {
    return raw as LlmThinkLevel
  }
  const legacy = (saved as Record<string, unknown>).llmThinkingEnabled
  if (typeof legacy === 'boolean') return legacy ? 'on' : 'off'
  return fallback
}

function normalizeLlm(s: AppSettings): AppSettings {
  const providerRaw = typeof s.llmProvider === 'string' ? s.llmProvider : ''
  const llmProvider: LlmProvider =
    providerRaw === 'openrouter'
      ? 'openrouter'
      : providerRaw === 'nvidia'
        ? 'nvidia'
        : 'ollama'
  const t = Number(s.llmTemperature)
  const ctx = Number(s.llmNumCtx)
  const openrouterBaseUrl =
    typeof s.openrouterBaseUrl === 'string' && s.openrouterBaseUrl.trim()
      ? s.openrouterBaseUrl.trim()
      : defaults.openrouterBaseUrl
  const openrouterApiKey =
    typeof s.openrouterApiKey === 'string' ? s.openrouterApiKey.trim() : ''
  const openrouterModel = normalizeOpenRouterModelId(
    typeof s.openrouterModel === 'string' && s.openrouterModel.trim()
      ? s.openrouterModel.trim()
      : defaults.openrouterModel,
  )
  const nvidiaBaseUrl =
    typeof s.nvidiaBaseUrl === 'string' && s.nvidiaBaseUrl.trim()
      ? s.nvidiaBaseUrl.trim()
      : defaults.nvidiaBaseUrl
  const nvidiaApiKey =
    typeof s.nvidiaApiKey === 'string' ? s.nvidiaApiKey.trim() : ''
  const nvidiaModel = normalizeNvidiaModelId(
    typeof s.nvidiaModel === 'string' && s.nvidiaModel.trim()
      ? s.nvidiaModel.trim()
      : defaults.nvidiaModel,
  )
  return {
    ...s,
    llmProvider,
    openrouterBaseUrl,
    openrouterApiKey,
    openrouterModel,
    nvidiaBaseUrl,
    nvidiaApiKey,
    nvidiaModel,
    llmTemperature: Number.isFinite(t) ? clamp(t, 0, 2) : defaults.llmTemperature,
    llmNumCtx: Number.isFinite(ctx)
      ? clamp(Math.round(ctx), 512, 262144)
      : defaults.llmNumCtx,
    contextAutoCompress:
      typeof s.contextAutoCompress === 'boolean'
        ? s.contextAutoCompress
        : defaults.contextAutoCompress,
    longMemoryDefaultEnabled:
      typeof s.longMemoryDefaultEnabled === 'boolean'
        ? s.longMemoryDefaultEnabled
        : defaults.longMemoryDefaultEnabled,
    llmThinkLevel: normalizeLlmThinkLevel(s, defaults.llmThinkLevel),
    llmSystemPrompt:
      typeof s.llmSystemPrompt === 'string' ? s.llmSystemPrompt : '',
  }
}

function normalizeTts(s: AppSettings): AppSettings {
  const providerRaw = typeof s.ttsProvider === 'string' ? s.ttsProvider : ''
  const ttsProvider: TtsProvider =
    providerRaw === 'runware-xai'
      ? 'runware-xai'
      : providerRaw === 'openrouter-tts'
        ? 'openrouter-tts'
        : 'local'
  const voiceRaw = typeof s.runwareXaiVoice === 'string' ? s.runwareXaiVoice.trim() : ''
  const previousRunwareModel =
    typeof s.runwareTtsModel === 'string' ? s.runwareTtsModel.trim() : ''
  const runwareTtsModel = normalizeRunwareTtsModel(previousRunwareModel)
  const runwareModelChanged =
    Boolean(previousRunwareModel) && runwareTtsModel !== previousRunwareModel
  const runwareXaiVoice =
    runwareModelChanged || !voiceRaw ? runwareTtsDefaultVoice(runwareTtsModel) : voiceRaw
  const runwareXaiLanguage =
    typeof s.runwareXaiLanguage === 'string' ? s.runwareXaiLanguage.trim() : ''
  const previousModel =
    typeof s.openrouterTtsModel === 'string' ? s.openrouterTtsModel.trim() : ''
  const openrouterTtsModel = normalizeOpenRouterTtsModel(previousModel)
  const orTtsVoiceRaw = typeof s.openrouterTtsVoice === 'string' ? s.openrouterTtsVoice.trim() : ''
  const modelChanged = openrouterTtsModel !== previousModel
  const openrouterTtsVoice =
    modelChanged && OPENAI_TTS_VOICES.has(orTtsVoiceRaw) ? '' : orTtsVoiceRaw
  return {
    ...s,
    ttsProvider,
    runwareXaiVoice,
    runwareTtsModel,
    runwareXaiLanguage,
    openrouterTtsModel,
    openrouterTtsVoice,
  }
}

export function normalizeSubAgent(s: AppSettings): AppSettings {
  const raw = s.subAgent
  if (!raw || typeof raw !== 'object') return { ...s, subAgent: { ...defaults.subAgent } }
  const enabled = raw.enabled === true
  const rawModel = (typeof raw.model === 'string' && raw.model.trim()) || defaults.subAgent.model
  const model =
    rawModel.includes(':') && !rawModel.includes('/')
      ? rawModel
      : normalizeOpenRouterModelId(rawModel)
  // outputTokens — migrate old maxTokensPerImage key if present
  const rawAny = raw as any
  const outputTokens =
    typeof raw.outputTokens === 'number' && Number.isFinite(raw.outputTokens)
      ? Math.max(50, Math.min(4096, Math.round(raw.outputTokens)))
      : typeof rawAny.maxTokensPerImage === 'number' && Number.isFinite(rawAny.maxTokensPerImage)
        ? Math.max(50, Math.min(4096, Math.round(rawAny.maxTokensPerImage)))
        : defaults.subAgent.outputTokens
  const contextTokens =
    typeof raw.contextTokens === 'number' && Number.isFinite(raw.contextTokens)
      ? Math.max(512, Math.min(131072, Math.round(raw.contextTokens)))
      : defaults.subAgent.contextTokens
  const showAnalysisWindow = raw.showAnalysisWindow !== false
  return {
    ...s,
    subAgent: { enabled, model, outputTokens, contextTokens, showAnalysisWindow },
  }
}

function normalizePdfDir(s: AppSettings): AppSettings {
  const dir = typeof s.pdfOutputDir === 'string' ? s.pdfOutputDir.trim() : ''
  return { ...s, pdfOutputDir: dir }
}

function normalizeUiTheme(s: AppSettings): AppSettings {
  const t = s.uiTheme
  const uiTheme: UiTheme =
    t === 'minimal' || t === 'dystopian' || t === 'matrix' || t === 'light' || t === 'blood-moon' || t === 'obsidian' ? t : 'minimal'
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

  const legacyMusicProfile: RunwareMusicModelProfile = {
    outputFormat: musicOutputFormat,
    durationSec: Number.isFinite(musicDuration)
      ? clamp(musicDuration, 6, 300)
      : defaults.runwareMusicDurationSec,
    steps: Number.isFinite(musicSteps)
      ? clamp(Math.round(musicSteps), 1, 300)
      : defaults.runwareMusicSteps,
    cfgScale: Number.isFinite(musicCfg)
      ? clamp(musicCfg, 1, 30)
      : defaults.runwareMusicCfgScale,
    seed: musicSeed,
  }
  const parsedMusicProfiles =
    s.runwareMusicModelProfiles && typeof s.runwareMusicModelProfiles === 'object'
      ? (s.runwareMusicModelProfiles as Record<string, Partial<RunwareMusicModelProfile>>)
      : {}
  const normalizedMusicProfiles: Record<string, RunwareMusicModelProfile> = {}
  for (const m of RUNWARE_CONFIGURED_MUSIC_MODELS) {
    const isBase = m.id === RUNWARE_ACE_STEP_V1_5_BASE_MODEL_ID
    // Turbo profile migrates from legacy top-level music fields if no profile is stored yet.
    // Base profile falls back to docs defaults; legacy fields don't apply because they were turbo-shaped.
    const fallback =
      isBase
        ? defaults.runwareMusicModelProfiles[m.id]
        : (parsedMusicProfiles[m.id]
            ? defaults.runwareMusicModelProfiles[m.id]
            : legacyMusicProfile)
    const incoming = parsedMusicProfiles[m.id] ?? {}
    const incomingOutputFormatRaw =
      typeof incoming.outputFormat === 'string' ? incoming.outputFormat.trim().toUpperCase() : ''
    const incomingOutputFormat: 'MP3' | 'WAV' | 'FLAC' | 'OGG' =
      incomingOutputFormatRaw === 'WAV' ||
      incomingOutputFormatRaw === 'FLAC' ||
      incomingOutputFormatRaw === 'OGG' ||
      incomingOutputFormatRaw === 'MP3'
        ? incomingOutputFormatRaw
        : fallback.outputFormat
    const incomingDuration = Number(incoming.durationSec)
    const incomingSteps = Number(incoming.steps)
    const incomingCfg = Number(incoming.cfgScale)
    const incomingSeedRaw = Number(incoming.seed)
    const incomingSeed =
      incoming.seed == null
        ? fallback.seed
        : Number.isFinite(incomingSeedRaw)
          ? clamp(Math.round(incomingSeedRaw), 0, 2147483647)
          : null
    const stepsCap = maxStepsForMusicModelId(m.id)
    normalizedMusicProfiles[m.id] = {
      outputFormat: incomingOutputFormat,
      durationSec: Number.isFinite(incomingDuration)
        ? clamp(incomingDuration, 6, 300)
        : fallback.durationSec,
      steps: Number.isFinite(incomingSteps)
        ? clamp(Math.round(incomingSteps), 1, stepsCap)
        : clamp(Math.round(fallback.steps), 1, stepsCap),
      cfgScale: Number.isFinite(incomingCfg) ? clamp(incomingCfg, 1, 30) : fallback.cfgScale,
      seed: incomingSeed,
    }
  }
  const requestedMusicModelRaw =
    typeof s.runwareMusicModel === 'string' ? s.runwareMusicModel.trim() : ''
  const safeMusicModel = configuredMusicModelIdSet.has(requestedMusicModelRaw)
    ? requestedMusicModelRaw
    : defaults.runwareMusicModel
  const activeMusicProfile =
    normalizedMusicProfiles[safeMusicModel] ??
    defaults.runwareMusicModelProfiles[safeMusicModel] ??
    defaults.runwareMusicModelProfiles[defaults.runwareMusicModel]

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
    runwareMusicModel: safeMusicModel,
    runwareMusicModelProfiles: normalizedMusicProfiles,
    runwareMusicOutputFormat: activeMusicProfile.outputFormat,
    runwareMusicDurationSec: activeMusicProfile.durationSec,
    runwareMusicSteps: activeMusicProfile.steps,
    runwareMusicCfgScale: activeMusicProfile.cfgScale,
    runwareMusicGuidanceType: musicGuidanceType,
    runwareMusicVocalLanguage: musicVocalLanguage,
    runwareMusicSeed: activeMusicProfile.seed,
    runwareMusicOutputDir: musicOutputDir,
    runwareAutoSaveMusic:
      typeof s.runwareAutoSaveMusic === 'boolean'
        ? s.runwareAutoSaveMusic
        : defaults.runwareAutoSaveMusic,
  }
}

function normalizeNotificationSounds(s: AppSettings): AppSettings {
  const v = Number(s.notificationSoundVolume)
  return {
    ...s,
    notificationSoundsEnabled:
      typeof s.notificationSoundsEnabled === 'boolean'
        ? s.notificationSoundsEnabled
        : defaults.notificationSoundsEnabled,
    notificationSoundVolume: Number.isFinite(v)
      ? clamp(v, 0, 1)
      : defaults.notificationSoundVolume,
  }
}

function normalizeAll(s: AppSettings): AppSettings {
  return normalizeNotificationSounds(
    normalizeRunware(
      normalizeUiTheme(normalizePdfDir(normalizeTools(normalizeTts(normalizeSubAgent(normalizeLlm(s)))))),
    ),
  )
}

function stripCloudSecrets(s: AppSettings): AppSettings {
  return {
    ...s,
    openrouterApiKey: '',
    runwareApiKey: '',
    nvidiaApiKey: '',
  }
}

function applyWebRuntimeOverrides(s: AppSettings): AppSettings {
  if (typeof window !== 'undefined' && isLanWebClient()) {
    return stripCloudSecrets({
      ...s,
      ttsBaseUrl: defaultTtsBaseUrlForRuntime(),
      ollamaBaseUrl: ollamaUrlShouldUseDesktopProxy(s.ollamaBaseUrl)
        ? defaultOllamaBaseUrlForRuntime()
        : s.ollamaBaseUrl,
      openrouterBaseUrl: openRouterApiBaseForRuntime(),
      nvidiaBaseUrl: nvidiaApiBaseForRuntime(),
      voiceMode: 'design',
      sttProvider: 'none',
    })
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
  const toSave =
    typeof window !== 'undefined' && isLanWebClient() ? stripCloudSecrets(s) : s
  localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave))
}

export function getAgentVisibleSettings(settings: AppSettings): Partial<AppSettings> {
  const out: Partial<AppSettings> = { ...settings }
  for (const k of AGENT_HIDDEN_SETTINGS_FIELDS) {
    delete out[k]
  }
  return out
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

export function getRunwareMusicProfileForModel(
  s: Pick<AppSettings, 'runwareMusicModelProfiles'>,
  modelId: string,
): RunwareMusicModelProfile {
  const incoming = s.runwareMusicModelProfiles?.[modelId]
  if (incoming) return incoming
  const fallback = defaults.runwareMusicModelProfiles[modelId]
  if (fallback) return fallback
  return defaults.runwareMusicModelProfiles[defaults.runwareMusicModel]
}
