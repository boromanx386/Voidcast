import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const STORAGE_KEY = 'voidcast-settings-v1'

// A desktop renderer: window.voidcast with the secrets bridge, plus a Map-backed localStorage.
function setupDesktop(opts: { stored: Record<string, string> | null; setAllOk?: boolean }) {
  const ls = new Map<string, string>()
  const vault = { current: opts.stored }
  const setAll = vi.fn((secrets: Record<string, string>) => {
    if (opts.setAllOk === false || vault.current === null) return false
    vault.current = { ...secrets }
    return true
  })
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => ls.get(k) ?? null,
    setItem: (k: string, v: string) => void ls.set(k, v),
    removeItem: (k: string) => void ls.delete(k),
  })
  vi.stubGlobal('window', {
    voidcast: { secrets: { getAll: () => vault.current, setAll } },
    location: { hostname: 'localhost', port: '', protocol: 'file:' },
  })
  vi.stubGlobal('navigator', { userAgent: 'Electron' })
  const saved = () => JSON.parse(ls.get(STORAGE_KEY) ?? '{}')
  return { ls, vault, setAll, saved }
}

async function freshSettings() {
  vi.resetModules()
  return import('../src/lib/settings')
}

describe('API keys in the OS-encrypted store', () => {
  beforeEach(() => vi.unstubAllGlobals())
  afterEach(() => vi.unstubAllGlobals())

  test('moves plaintext keys from localStorage into the store on load', async () => {
    const env = setupDesktop({ stored: {} })
    env.ls.set(STORAGE_KEY, JSON.stringify({ openrouterApiKey: 'sk-old', llmModel: 'x' }))
    const { loadSettings } = await freshSettings()

    expect(loadSettings().openrouterApiKey).toBe('sk-old')
    expect(env.vault.current).toEqual({ openrouterApiKey: 'sk-old' })
    expect(env.saved().openrouterApiKey).toBeUndefined()
    expect(env.saved().llmModel).toBe('x')
  })

  test('loads keys from the store and saves without them in localStorage', async () => {
    const env = setupDesktop({ stored: { deepseekApiKey: 'sk-ds' } })
    const { loadSettings, saveSettings } = await freshSettings()
    const s = loadSettings()
    expect(s.deepseekApiKey).toBe('sk-ds')

    saveSettings({ ...s, openaiApiKey: 'sk-oa' })
    expect(env.vault.current).toEqual({ deepseekApiKey: 'sk-ds', openaiApiKey: 'sk-oa' })
    expect(env.saved().openaiApiKey).toBeUndefined()
    expect(env.saved().deepseekApiKey).toBeUndefined()
  })

  test('does not rewrite the store when keys did not change', async () => {
    const env = setupDesktop({ stored: { deepseekApiKey: 'sk-ds' } })
    const { loadSettings, saveSettings } = await freshSettings()
    saveSettings({ ...loadSettings(), llmModel: 'other' })
    expect(env.setAll).not.toHaveBeenCalled()
  })

  test('keeps keys in localStorage when the store refuses a write', async () => {
    const env = setupDesktop({ stored: {}, setAllOk: false })
    const { loadSettings, saveSettings } = await freshSettings()
    saveSettings({ ...loadSettings(), openaiApiKey: 'sk-oa' })
    expect(env.saved().openaiApiKey).toBe('sk-oa')
  })

  test('without a real OS key store keys stay in localStorage as before', async () => {
    const env = setupDesktop({ stored: null })
    env.ls.set(STORAGE_KEY, JSON.stringify({ openrouterApiKey: 'sk-old' }))
    const { loadSettings, saveSettings } = await freshSettings()
    const s = loadSettings()
    expect(s.openrouterApiKey).toBe('sk-old')
    saveSettings(s)
    expect(env.setAll).not.toHaveBeenCalled()
    expect(env.saved().openrouterApiKey).toBe('sk-old')
  })
})
