import { describe, expect, test } from 'vitest'
import {
  applyModelSwitcherSelection,
  currentPinnedModelId,
  fromOllamaPinnedId,
  toOllamaPinnedId,
} from '../src/lib/pinnedModels'
import { defaults } from '../src/lib/settings'

describe('pinnedModels helpers', () => {
  test('ollama pin id round-trip', () => {
    expect(toOllamaPinnedId('llama3.2')).toBe('ollama/llama3.2')
    expect(toOllamaPinnedId('ollama/llama3.2')).toBe('ollama/llama3.2')
    expect(fromOllamaPinnedId('ollama/llama3.2')).toBe('llama3.2')
  })

  test('currentPinnedModelId for ollama uses prefix', () => {
    const s = { ...defaults, llmProvider: 'ollama' as const, ollamaModel: 'qwen2.5' }
    expect(currentPinnedModelId(s)).toBe('ollama/qwen2.5')
  })

  test('applyModelSwitcherSelection switches provider and model', () => {
    const base = { ...defaults, llmProvider: 'ollama' as const, ollamaModel: 'llama3.2' }
    const next = applyModelSwitcherSelection(base, 'openrouter', 'anthropic/claude-sonnet-5')
    expect(next.llmProvider).toBe('openrouter')
    expect(next.openrouterModel).toBe('anthropic/claude-sonnet-5')
    expect(next.ollamaModel).toBe('llama3.2')
  })

  test('applyModelSwitcherSelection strips ollama prefix', () => {
    const base = { ...defaults, llmProvider: 'openrouter' as const }
    const next = applyModelSwitcherSelection(base, 'ollama', 'ollama/mistral')
    expect(next.llmProvider).toBe('ollama')
    expect(next.ollamaModel).toBe('mistral')
  })
})
