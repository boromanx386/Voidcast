export type VoiceMode = 'auto' | 'design' | 'clone'

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
}

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
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
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

export function loadSettings(): AppSettings {
  try {
    const rawNew = localStorage.getItem(STORAGE_KEY)
    const rawLegacy = localStorage.getItem(LEGACY_STORAGE_KEY)
    const raw = rawNew ?? rawLegacy
    if (!raw) return { ...defaults }
    const parsed = JSON.parse(raw) as Partial<AppSettings>
    const merged = normalizeLlm({ ...defaults, ...parsed })
    if (!rawNew && rawLegacy) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(merged))
    }
    return merged
  } catch {
    return { ...defaults }
  }
}

export function saveSettings(s: AppSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
}

export function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '')
}
