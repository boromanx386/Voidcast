import { describe, expect, test } from 'vitest'
import {
  applyModelSwitcherSelection,
  currentPinnedModelId,
  fromOllamaPinnedId,
  normalizePinnedModels,
  parsePinnedId,
  toOllamaPinnedId,
  toScopedPinnedId,
  unwrapPinnedModelId,
} from '../src/lib/pinnedModels'
import { defaults } from '../src/lib/settings'

describe('pinnedModels helpers', () => {
  test('ollama pin id uses provider:model scope', () => {
    expect(toOllamaPinnedId('llama3.2')).toBe('ollama:llama3.2')
    expect(toOllamaPinnedId('ollama:llama3.2')).toBe('ollama:llama3.2')
    expect(toOllamaPinnedId('ollama/llama3.2')).toBe('ollama:llama3.2')
    expect(fromOllamaPinnedId('ollama:llama3.2')).toBe('llama3.2')
    expect(fromOllamaPinnedId('ollama/llama3.2')).toBe('llama3.2')
  })

  test('deepseek and opencode-go can pin the same model name', () => {
    expect(toScopedPinnedId('deepseek', 'deepseek-v4-pro')).toBe('deepseek:deepseek-v4-pro')
    expect(toScopedPinnedId('opencode-go', 'deepseek-v4-pro')).toBe(
      'opencode-go:deepseek-v4-pro',
    )
    expect(toScopedPinnedId('crofai', 'deepseek-v4-pro')).toBe('crofai:deepseek-v4-pro')
    expect(parsePinnedId('deepseek:deepseek-v4-pro')).toEqual({
      provider: 'deepseek',
      modelId: 'deepseek-v4-pro',
    })
    expect(parsePinnedId('opencode-go:deepseek-v4-pro')).toEqual({
      provider: 'opencode-go',
      modelId: 'deepseek-v4-pro',
    })
    expect(parsePinnedId('crofai:deepseek-v4-pro')).toEqual({
      provider: 'crofai',
      modelId: 'deepseek-v4-pro',
    })
  })

  test('openai pins use bare model ids', () => {
    expect(toScopedPinnedId('openai', 'gpt-5.6-sol')).toBe('openai:gpt-5.6-sol')
    expect(parsePinnedId('openai:gpt-5.6-sol')).toEqual({
      provider: 'openai',
      modelId: 'gpt-5.6-sol',
    })
  })

  test('openrouter and nvidia can pin the same model id', () => {
    expect(toScopedPinnedId('openrouter', 'z-ai/glm-5.2')).toBe('openrouter:z-ai/glm-5.2')
    expect(toScopedPinnedId('nvidia', 'z-ai/glm-5.2')).toBe('nvidia:z-ai/glm-5.2')
    expect(parsePinnedId('openrouter:z-ai/glm-5.2')).toEqual({
      provider: 'openrouter',
      modelId: 'z-ai/glm-5.2',
    })
    expect(parsePinnedId('nvidia:z-ai/glm-5.2')).toEqual({
      provider: 'nvidia',
      modelId: 'z-ai/glm-5.2',
    })
  })

  test('currentPinnedModelId uses scoped ids for all providers', () => {
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
        llmProvider: 'openai',
        openaiModel: 'gpt-5.6-sol',
      }),
    ).toBe('openai:gpt-5.6-sol')
    expect(
      currentPinnedModelId({
        ...defaults,
        llmProvider: 'opencode-go',
        opencodeGoModel: 'deepseek-v4-pro',
      }),
    ).toBe('opencode-go:deepseek-v4-pro')
    expect(
      currentPinnedModelId({
        ...defaults,
        llmProvider: 'nvidia',
        nvidiaModel: 'z-ai/glm-5.2',
      }),
    ).toBe('nvidia:z-ai/glm-5.2')
    expect(
      currentPinnedModelId({
        ...defaults,
        llmProvider: 'openrouter',
        openrouterModel: 'z-ai/glm-5.2',
      }),
    ).toBe('openrouter:z-ai/glm-5.2')
  })

  test('normalizePinnedModels migrates legacy bare and ollama/ pins', () => {
    expect(
      normalizePinnedModels([
        'anthropic/claude-sonnet-5',
        'ollama/llama3.2',
        'deepseek-v4-pro',
        'z-ai/glm-5.2',
        'openrouter:z-ai/glm-5.2',
        'nvidia:z-ai/glm-5.2',
      ]),
    ).toEqual([
      'openrouter:anthropic/claude-sonnet-5',
      'ollama:llama3.2',
      'deepseek:deepseek-v4-pro',
      'openrouter:z-ai/glm-5.2',
      'nvidia:z-ai/glm-5.2',
    ])
  })

  test('applyModelSwitcherSelection switches provider and model', () => {
    const base = { ...defaults, llmProvider: 'ollama' as const, ollamaModel: 'llama3.2' }
    const next = applyModelSwitcherSelection(base, 'openrouter', 'anthropic/claude-sonnet-5')
    expect(next.llmProvider).toBe('openrouter')
    expect(next.openrouterModel).toBe('anthropic/claude-sonnet-5')
    expect(next.ollamaModel).toBe('llama3.2')
  })

  test('applyModelSwitcherSelection unwraps scoped deepseek/opencode/nvidia ids', () => {
    const base = { ...defaults, llmProvider: 'openrouter' as const }
    const ds = applyModelSwitcherSelection(base, 'deepseek', 'deepseek:deepseek-v4-flash')
    expect(ds.llmProvider).toBe('deepseek')
    expect(ds.deepseekModel).toBe('deepseek-v4-flash')

    const oa = applyModelSwitcherSelection(base, 'openai', 'openai:gpt-5.6-terra')
    expect(oa.llmProvider).toBe('openai')
    expect(oa.openaiModel).toBe('gpt-5.6-terra')

    const og = applyModelSwitcherSelection(base, 'opencode-go', 'opencode-go:deepseek-v4-pro')
    expect(og.llmProvider).toBe('opencode-go')
    expect(og.opencodeGoModel).toBe('deepseek-v4-pro')

    const crof = applyModelSwitcherSelection(base, 'crofai', 'crofai:kimi-k2.6')
    expect(crof.llmProvider).toBe('crofai')
    expect(crof.crofaiModel).toBe('kimi-k2.6')

    const nv = applyModelSwitcherSelection(base, 'nvidia', 'nvidia:z-ai/glm-5.2')
    expect(nv.llmProvider).toBe('nvidia')
    expect(nv.nvidiaModel).toBe('z-ai/glm-5.2')

    const or = applyModelSwitcherSelection(base, 'openrouter', 'openrouter:z-ai/glm-5.2')
    expect(or.llmProvider).toBe('openrouter')
    expect(or.openrouterModel).toBe('z-ai/glm-5.2')
  })

  test('applyModelSwitcherSelection strips ollama prefix', () => {
    const base = { ...defaults, llmProvider: 'openrouter' as const }
    const next = applyModelSwitcherSelection(base, 'ollama', 'ollama/mistral')
    expect(next.llmProvider).toBe('ollama')
    expect(next.ollamaModel).toBe('mistral')

    const next2 = applyModelSwitcherSelection(base, 'ollama', 'ollama:mistral')
    expect(next2.ollamaModel).toBe('mistral')
  })

  test('unwrapPinnedModelId', () => {
    expect(unwrapPinnedModelId('deepseek', 'deepseek:x')).toBe('x')
    expect(unwrapPinnedModelId('opencode-go', 'opencode-go:y')).toBe('y')
    expect(unwrapPinnedModelId('nvidia', 'nvidia:z-ai/glm-5.2')).toBe('z-ai/glm-5.2')
  })
})
