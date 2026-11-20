import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  defaults,
  normalizeSettingsCandidate,
  OPENROUTER_MUSIC_MODELS,
  RUNWARE_CONFIGURED_MODELS,
  RUNWARE_CONFIGURED_MUSIC_MODELS,
  type AppSettings,
} from '../src/lib/settings'
import {
  applyMediaProvider,
  currentMediaModels,
  mediaModelOptions,
  availableMediaProviders,
  availableSttProviders,
  availableTtsProviders,
  detectMainVision,
  disableMediaTools,
  finishSetupStep,
  pendingSetupSteps,
} from '../src/lib/setupGuide'

const fresh: AppSettings = { ...defaults, openrouterApiKey: 'sk-or-v1-x' }

describe('setup guide steps', () => {
  it('lists every step on a fresh install, in order', () => {
    expect(pendingSetupSteps(fresh)).toEqual(['vision', 'media', 'voice'])
  })

  it('drops finished steps and shows nothing once dismissed', () => {
    const s = finishSetupStep(fresh, 'vision')
    expect(pendingSetupSteps(s)).toEqual(['media', 'voice'])
    expect(finishSetupStep(s, 'vision')).toBe(s)
    expect(pendingSetupSteps({ ...s, setupGuide: { ...s.setupGuide, dismissed: true } })).toEqual(
      [],
    )
  })

  it('normalizes stored state and ignores unknown steps', () => {
    const s = normalizeSettingsCandidate({
      setupGuide: { dismissed: 'yes', done: ['voice', 'bogus', 'vision'] } as never,
    })
    expect(s.setupGuide).toEqual({ dismissed: false, done: ['vision', 'voice'] })
  })
})

describe('setup guide choices follow the keys', () => {
  it('offers media providers by key', () => {
    expect(availableMediaProviders({ ...defaults })).toEqual([])
    expect(availableMediaProviders(fresh)).toEqual(['openrouter'])
    expect(availableMediaProviders({ ...fresh, runwareApiKey: 'rw' })).toEqual([
      'runware',
      'openrouter',
    ])
  })

  it('points both media tools at one provider, or turns them off', () => {
    const s = applyMediaProvider(disableMediaTools(fresh), 'openrouter')
    expect(s.imageProvider).toBe('openrouter')
    expect(s.musicProvider).toBe('openrouter')
    expect(s.toolsEnabled.runwareImage).toBe(true)
    expect(disableMediaTools(s).toolsEnabled.runwareMusic).toBe(false)
  })

  it('sets the chosen image and music models for that provider only', () => {
    const music = OPENROUTER_MUSIC_MODELS[1].id
    const or = applyMediaProvider(fresh, 'openrouter', { image: 'x/img', music })
    expect(currentMediaModels(or, 'openrouter')).toEqual({ image: 'x/img', music })
    expect(currentMediaModels(or, 'runware')).toEqual(currentMediaModels(fresh, 'runware'))

    const rwMusic = RUNWARE_CONFIGURED_MUSIC_MODELS[RUNWARE_CONFIGURED_MUSIC_MODELS.length - 1].id
    const rw = applyMediaProvider(fresh, 'runware', {
      image: RUNWARE_CONFIGURED_MODELS[1].id,
      music: rwMusic,
    })
    expect(rw.runwareImageModel).toBe(RUNWARE_CONFIGURED_MODELS[1].id)
    expect(rw.runwareMusicModel).toBe(rwMusic)
    expect(mediaModelOptions('runware').music).toBe(RUNWARE_CONFIGURED_MUSIC_MODELS)
  })

  it('offers cloud voices only with a key, offline dictation always', () => {
    expect(availableTtsProviders({ ...defaults })).toEqual([])
    expect(availableTtsProviders({ ...fresh, runwareApiKey: 'rw' })).toEqual([
      'openrouter-tts',
      'runware-xai',
    ])
    expect(availableSttProviders({ ...defaults })).toEqual(['whistle'])
    expect(availableSttProviders(fresh)).toEqual(['whistle', 'openrouter'])
  })
})

describe('detectMainVision', () => {
  afterEach(() => vi.unstubAllGlobals())

  const respond = (body: unknown) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })),
    )

  it('reads OpenRouter input modalities', async () => {
    respond({ data: { architecture: { input_modalities: ['text', 'image'] }, endpoints: [] } })
    expect(await detectMainVision({ ...fresh, openrouterModel: 'openai/gpt-4o-mini' })).toBe('yes')
    respond({ data: { architecture: { input_modalities: ['text'] }, endpoints: [] } })
    expect(await detectMainVision({ ...fresh, openrouterModel: 'deepseek/deepseek-chat' })).toBe(
      'no',
    )
  })

  it('reads Ollama capabilities', async () => {
    respond({ capabilities: ['completion', 'vision'] })
    const ollama = { ...defaults, llmProvider: 'ollama' as const, ollamaModel: 'gemma3' }
    expect(await detectMainVision(ollama)).toBe('yes')
    respond({ capabilities: ['completion'] })
    expect(await detectMainVision(ollama)).toBe('no')
    respond({})
    expect(await detectMainVision(ollama)).toBe('unknown')
  })

  it('asks the user for other providers or when the lookup fails', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('offline')
    })
    vi.stubGlobal('fetch', fetchMock)
    expect(await detectMainVision(fresh)).toBe('unknown')
    expect(
      await detectMainVision({ ...defaults, llmProvider: 'deepseek', deepseekApiKey: 'x' }),
    ).toBe('unknown')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('setup guide on upgrade', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('hides the guide for settings saved by an older version, shows it on a fresh install', async () => {
    const ls = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => ls.get(k) ?? null,
      setItem: (k: string, v: string) => void ls.set(k, v),
      removeItem: (k: string) => void ls.delete(k),
    })
    vi.resetModules()
    const { loadSettings } = await import('../src/lib/settings')
    expect(loadSettings().setupGuide.dismissed).toBe(false)
    ls.set('voidcast-settings-v1', JSON.stringify({ llmProvider: 'ollama' }))
    expect(loadSettings().setupGuide.dismissed).toBe(true)
  })
})
