import { afterEach, describe, expect, it, vi } from 'vitest'
import { chatSetupNeed } from '../src/lib/chatSetup'
import { assertOllamaModel, fetchOllamaWithRetry } from '../src/lib/ollama'
import { defaults } from '../src/lib/settings'

const probe = { models: [] as string[], loading: false, error: null as string | null }

describe('chatSetupNeed', () => {
  it('asks a fresh install for an OpenRouter key', () => {
    expect(chatSetupNeed(defaults, probe)).toEqual({ kind: 'cloud-key', provider: 'openrouter' })
  })

  it('is ready once the selected cloud provider has a key', () => {
    expect(chatSetupNeed({ ...defaults, openrouterApiKey: 'sk-or-v1-x' }, probe)).toEqual({
      kind: 'ready',
    })
    expect(
      chatSetupNeed({ ...defaults, llmProvider: 'deepseek', openrouterApiKey: 'x' }, probe),
    ).toEqual({ kind: 'cloud-key', provider: 'deepseek' })
  })

  it('never picks an Ollama model for the user', () => {
    const s = { ...defaults, llmProvider: 'ollama' as const }
    expect(chatSetupNeed(s, { ...probe, error: 'refused' })).toEqual({
      kind: 'ollama-unreachable',
    })
    expect(chatSetupNeed(s, probe)).toEqual({ kind: 'ollama-no-models' })
    expect(chatSetupNeed(s, { ...probe, models: ['qwen3:8b'] })).toEqual({ kind: 'ollama-model' })
    expect(chatSetupNeed({ ...s, ollamaModel: 'qwen3:8b' }, { ...probe, error: 'x' })).toEqual({
      kind: 'ready',
    })
  })
})

describe('Ollama first-run errors', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('fails at once with a readable message when local Ollama refuses', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    vi.stubGlobal('fetch', fetchMock)
    await expect(fetchOllamaWithRetry('http://localhost:11434/api/tags', {})).rejects.toThrow(
      /Can't reach Ollama at http:\/\/localhost:11434/,
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects an empty model before calling Ollama', () => {
    expect(() => assertOllamaModel('  ')).toThrow(/No Ollama model selected/)
    expect(() => assertOllamaModel('qwen3:8b')).not.toThrow()
  })
})
