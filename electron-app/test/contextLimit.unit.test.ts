import { describe, expect, test } from 'vitest'
import { activeLlmModelId, resolveContextLimit } from '@/lib/contextLimit'
import { estimateContextUsage } from '@/lib/contextUsage'

function baseSettings(overrides: Record<string, unknown> = {}) {
  return {
    llmProvider: 'ollama' as const,
    llmNumCtx: 100_000,
    ollamaModel: 'qwen3:8b',
    openrouterModel: 'openrouter/free',
    deepseekModel: 'deepseek-v4-pro',
    nvidiaModel: 'nvidia/nemotron-3-super-120b-a12b',
    ...overrides,
  }
}

describe('resolveContextLimit', () => {
  test('ollama uses llmNumCtx', () => {
    const limit = resolveContextLimit(baseSettings({ llmNumCtx: 64_000 }))
    expect(limit).toMatchObject({
      maxTokens: 64_000,
      source: 'ollama_num_ctx',
      provider: 'ollama',
    })
  })

  test('openrouter claude uses 1M preset', () => {
    const limit = resolveContextLimit(
      baseSettings({
        llmProvider: 'openrouter',
        openrouterModel: 'anthropic/claude-sonnet-5',
      }),
    )
    expect(limit.maxTokens).toBe(1_000_000)
    expect(limit.source).toBe('preset')
  })

  test('openrouter gemini flash uses 1M override', () => {
    const limit = resolveContextLimit(
      baseSettings({
        llmProvider: 'openrouter',
        openrouterModel: 'google/gemini-3.6-flash',
      }),
    )
    expect(limit.maxTokens).toBe(1_048_576)
  })

  test('openrouter laguna free route uses 256k window', () => {
    const limit = resolveContextLimit(
      baseSettings({
        llmProvider: 'openrouter',
        openrouterModel: 'poolside/laguna-s-2.1:free',
      }),
    )
    expect(limit.maxTokens).toBe(262_144)
  })

  test('deepseek flash and pro use 1M', () => {
    const flash = resolveContextLimit(
      baseSettings({
        llmProvider: 'deepseek',
        deepseekModel: 'deepseek-v4-flash',
      }),
    )
    const pro = resolveContextLimit(
      baseSettings({
        llmProvider: 'deepseek',
        deepseekModel: 'deepseek-v4-pro',
      }),
    )
    expect(flash.maxTokens).toBe(1_000_000)
    expect(pro.maxTokens).toBe(1_000_000)
  })

  test('unknown cloud model falls back to provider default', () => {
    const limit = resolveContextLimit(
      baseSettings({
        llmProvider: 'openrouter',
        openrouterModel: 'vendor/unknown-model-9000',
      }),
    )
    expect(limit.maxTokens).toBe(128_000)
    expect(limit.source).toBe('provider_default')
  })
})

describe('estimateContextUsage with resolved limit', () => {
  test('computes ratio from resolved cloud limit', () => {
    const limit = resolveContextLimit(
      baseSettings({
        llmProvider: 'openrouter',
        openrouterModel: 'anthropic/claude-sonnet-5',
      }),
    )
    const usage = estimateContextUsage({ prompt_eval_count: 500_000, eval_count: 500 }, limit)
    expect(usage?.maxTokens).toBe(1_000_000)
    expect(usage?.ratio).toBe(0.5)
    expect(usage?.modelId).toBe(activeLlmModelId(baseSettings({ llmProvider: 'openrouter', openrouterModel: 'anthropic/claude-sonnet-5' })))
  })
})
