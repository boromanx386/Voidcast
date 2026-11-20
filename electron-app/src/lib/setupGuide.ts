import { llmModelLabel } from '@/lib/llmProviderDisplay'
import { fetchOllamaCapabilities } from '@/lib/ollama'
import { fetchOpenRouterModelEndpoints } from '@/lib/openrouter'
import {
  getRunwareMusicProfileForModel,
  OPENROUTER_IMAGE_MODEL_PRESETS,
  OPENROUTER_MUSIC_MODELS,
  RUNWARE_CONFIGURED_MODELS,
  RUNWARE_CONFIGURED_MUSIC_MODELS,
  SETUP_GUIDE_STEPS,
  type AppSettings,
  type SetupGuideStep,
  type SttProvider,
  type TtsProvider,
} from '@/lib/settings'

/** Whether the main model reads images itself; 'unknown' means the user has to say. */
export type MainVision = 'yes' | 'no' | 'unknown'

export type MediaProvider = 'runware' | 'openrouter'

export function pendingSetupSteps(settings: Pick<AppSettings, 'setupGuide'>): SetupGuideStep[] {
  if (settings.setupGuide.dismissed) return []
  return SETUP_GUIDE_STEPS.filter((step) => !settings.setupGuide.done.includes(step))
}

export function finishSetupStep(settings: AppSettings, step: SetupGuideStep): AppSettings {
  if (settings.setupGuide.done.includes(step)) return settings
  return {
    ...settings,
    setupGuide: { ...settings.setupGuide, done: [...settings.setupGuide.done, step] },
  }
}

/** Only OpenRouter and Ollama report input modalities; every other provider asks the user. */
export async function detectMainVision(settings: AppSettings): Promise<MainVision> {
  const model = llmModelLabel(settings).trim()
  if (!model) return 'unknown'
  try {
    if (settings.llmProvider === 'openrouter') {
      const { inputModalities } = await fetchOpenRouterModelEndpoints({
        model,
        baseUrl: settings.openrouterBaseUrl,
        apiKey: settings.openrouterApiKey,
      })
      if (!inputModalities) return 'unknown'
      return inputModalities.includes('image') ? 'yes' : 'no'
    }
    if (settings.llmProvider === 'ollama') {
      const caps = await fetchOllamaCapabilities(settings.ollamaBaseUrl, model)
      if (!caps) return 'unknown'
      return caps.includes('vision') ? 'yes' : 'no'
    }
  } catch {
    return 'unknown'
  }
  return 'unknown'
}

/** Image and music providers the user already holds a key for, preferred one first. */
export function availableMediaProviders(
  settings: Pick<AppSettings, 'runwareApiKey' | 'openrouterApiKey'>,
): MediaProvider[] {
  const out: MediaProvider[] = []
  if (settings.runwareApiKey.trim()) out.push('runware')
  if (settings.openrouterApiKey.trim()) out.push('openrouter')
  return out
}

export type MediaModelOption = { id: string; label: string }

/** The same curated lists the Media tab offers, per provider. */
export function mediaModelOptions(provider: MediaProvider): {
  image: MediaModelOption[]
  music: MediaModelOption[]
} {
  return provider === 'openrouter'
    ? { image: OPENROUTER_IMAGE_MODEL_PRESETS, music: [...OPENROUTER_MUSIC_MODELS] }
    : { image: RUNWARE_CONFIGURED_MODELS, music: RUNWARE_CONFIGURED_MUSIC_MODELS }
}

/** The models currently set for a provider, so the pickers open on what is saved. */
export function currentMediaModels(
  settings: AppSettings,
  provider: MediaProvider,
): { image: string; music: string } {
  return provider === 'openrouter'
    ? { image: settings.openrouterImageModel, music: settings.openrouterMusicModel }
    : { image: settings.runwareImageModel, music: settings.runwareMusicModel }
}

export function applyMediaProvider(
  settings: AppSettings,
  provider: MediaProvider,
  models?: { image?: string; music?: string },
): AppSettings {
  let next: AppSettings = {
    ...settings,
    imageProvider: provider,
    musicProvider: provider,
    toolsEnabled: { ...settings.toolsEnabled, runwareImage: true, runwareMusic: true },
  }
  const image = models?.image?.trim()
  const music = models?.music?.trim()
  if (provider === 'openrouter') {
    if (image) next = { ...next, openrouterImageModel: image }
    if (music) next = { ...next, openrouterMusicModel: music }
    return next
  }
  if (image) next = { ...next, runwareImageModel: image }
  if (music) {
    // Each ACE-Step variant keeps its own steps, CFG, duration and format, as in the Media tab.
    const profile = getRunwareMusicProfileForModel(next, music)
    next = {
      ...next,
      runwareMusicModel: music,
      runwareMusicOutputFormat: profile.outputFormat,
      runwareMusicDurationSec: profile.durationSec,
      runwareMusicSteps: profile.steps,
      runwareMusicCfgScale: profile.cfgScale,
      runwareMusicSeed: profile.seed,
    }
  }
  return next
}

export function disableMediaTools(settings: AppSettings): AppSettings {
  return {
    ...settings,
    toolsEnabled: { ...settings.toolsEnabled, runwareImage: false, runwareMusic: false },
  }
}

/** Read-aloud providers that work with the keys at hand; local OmniVoice stays in Options. */
export function availableTtsProviders(
  settings: Pick<AppSettings, 'runwareApiKey' | 'openrouterApiKey'>,
): TtsProvider[] {
  const out: TtsProvider[] = []
  if (settings.openrouterApiKey.trim()) out.push('openrouter-tts')
  if (settings.runwareApiKey.trim()) out.push('runware-xai')
  return out
}

/** Whistle is bundled and offline, so dictation is always possible. */
export function availableSttProviders(
  settings: Pick<AppSettings, 'openrouterApiKey'>,
): SttProvider[] {
  return settings.openrouterApiKey.trim() ? ['whistle', 'openrouter'] : ['whistle']
}
