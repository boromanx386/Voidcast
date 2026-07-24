import { describe, expect, test } from 'vitest'
import {
  applyModelSwitcherSelection,
  currentPinnedModelId,
  fromOllamaPinnedId,
  parsePinnedId,
  toOllamaPinnedId,
  toScopedPinnedId,
  unwrapPinnedModelId,
} from '../src/lib/pinnedModels'
import { defaults } from '../src/lib/settings'

describe('pinnedModels helpers', () => {
  test('ollama pin id round-trip', () => {
    expect(toOllamaPinnedId('llama3.2')).toBe('ollama/llama3.2')
    expect(toOllamaPinnedId('ollama/llama3.2')).toBe('ollama/llama3.2')
    expect(fromOllamaPinnedId('ollama/llama3.2')).toBe('llama3.2')
  })

  test('deepseek and opencode-go can pin the same model name', () => {
    expect(toScopedPinnedId('deepseek', 'deepseek-v4-pro')).toBe('deepseek:deepseek-v4-pro')
    expect(toScopedPinnedId('opencode-go', 'deepseek-v4-pro')).toBe(
      'opencode-go:deepseek-v4-pro',
    )
    expect(parsePinnedId('deepseek:deepseek-v4-pro')).toEqual({
      provider: 'deepseek',
      modelId: 'deepseek-v4-pro',
    })
    expect(parsePinnedId('opencode-go:deepseek-v4-pro')).toEqual({
      provider: 'opencode-go',
      modelId: 'deepseek-v4-pro',
    })
  })

  test('currentPinnedModelId uses scoped ids for deepseek/opencode', () => {
    expect(
      currentPinnedModelId({
        ...defaults,
        llmProvider: 'deepseek',
        deepseekModel: 'deepseek-v4-pro',
      }),
    ).toBe('deepseek:deepseek-v4-pro')
    expect(
      currentPinnedModelId({
        ...defaults,
        llmProvider: 'opencode-go',
        opencodeGoModel: 'deepseek-v4-pro',
      }),
    ).toBe('opencode-go:deepseek-v4-pro')
  })

  test('applyModelSwitcherSelection switches provider and model', () => {
    const base = { ...defaults, llmProvider: 'ollama' as const, ollamaModel: 'llama3.2' }
    const next = applyModelSwitcherSelection(base, 'openrouter', 'anthropic/claude-sonnet-5')
    expect(next.llmProvider).toBe('openrouter')
    expect(next.openrouterModel).toBe('anthropic/claude-sonnet-5')
    expect(next.ollamaModel).toBe('llama3.2')
  })

  test('applyModelSwitcherSelection unwraps scoped deepseek/opencode ids', () => {
    const base = { ...defaults, llmProvider: 'openrouter' as const }
    const ds = applyModelSwitcherSelection(base, 'deepseek', 'deepseek:deepseek-v4-flash')
    expect(ds.llmProvider).toBe('deepseek')
    expect(ds.deepseekModel).toBe('deepseek-v4-flash')

    const og = applyModelSwitcherSelection(base, 'opencode-go', 'opencode-go:deepseek-v4-pro')
    expect(og.llmProvider).toBe('opencode-go')
    expect(og.opencodeGoModel).toBe('deepseek-v4-pro')
  })

  test('applyModelSwitcherSelection strips ollama prefix', () => {
    const base = { ...defaults, llmProvider: 'openrouter' as const }
    const next = applyModelSwitcherSelection(base, 'ollama', 'ollama/mistral')
    expect(next.llmProvider).toBe('ollama')
    expect(next.ollamaModel).toBe('mistral')
  })

  test('unwrapPinnedModelId', () => {
    expect(unwrapPinnedModelId('deepseek', 'deepseek:x')).toBe('x')
    expect(unwrapPinnedModelId('opencode-go', 'opencode-go:y')).toBe('y')
  })
})
