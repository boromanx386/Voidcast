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
    openaiModel: 'gpt-5.6-sol',
    nvidiaModel: 'nvidia/nemotron-3-super-120b-a12b',
    opencodeGoModel: 'deepseek-v4-pro',
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

  test('openai gpt-5.6-sol uses 1.05M override', () => {
    const limit = resolveContextLimit(
      baseSettings({
        llmProvider: 'openai',
        openaiModel: 'gpt-5.6-sol',
      }),
    )
    expect(limit.maxTokens).toBe(1_050_000)
    expect(limit.source).toBe('preset')
    expect(activeLlmModelId(baseSettings({ llmProvider: 'openai', openaiModel: 'openai/gpt-5.6-sol' }))).toBe(
      'gpt-5.6-sol',
    )
  })

  test('unknown cloud model falls back to provider default', () => {
    const limit = resolveContextLimit(
      baseSettings({
        llmProvider: 'openrouter',
        openrouterModel: 'vendor/unknown-model-9000',
      }),
    )
    expect(limit.maxTokens).toBe(256_000)
    expect(limit.source).toBe('provider_default')
  })

  test('manual (typed) cloud models default to 256k, never 128k', () => {
    const manualIds = [
      'gpt-5.9-unknown',
      'gpt-4-unknown',
      'gpt-oss-unknown',
      'qwen3-30b-unknown',
      'kimi-x-unknown',
      'glm-x-unknown',
      'nemotron-x-unknown',
      'minimax-x-unknown',
      'mistral-x-unknown',
      'gemma-x-unknown',
      'grok-x-unknown',
      'claude-opus-unknown',
      'step-x-unknown',
      'some-model-9000:free',
    ]
    for (const id of manualIds) {
      const limit = resolveContextLimit(
        baseSettings({ llmProvider: 'openrouter', openrouterModel: id }),
      )
      expect(limit.maxTokens, id).toBe(256_000)
      expect(limit.source, id).toBe('provider_default')
    }
  })

  test('manual models on other providers also default to 256k', () => {
    const cases = [
      baseSettings({ llmProvider: 'openai', openaiModel: 'gpt-5.9-unknown' }),
      baseSettings({ llmProvider: 'nvidia', nvidiaModel: 'some-nemotron-9000' }),
      baseSettings({ llmProvider: 'opencode-go', opencodeGoModel: 'qwen3-unknown' }),
    ]
    for (const settings of cases) {
      const limit = resolveContextLimit(settings)
      expect(limit.maxTokens).toBe(256_000)
      expect(limit.source).toBe('provider_default')
    }
  })

  test('manual models keep their known larger windows', () => {
    const deepseek = resolveContextLimit(
      baseSettings({ llmProvider: 'deepseek', deepseekModel: 'deepseek-unknown-9000' }),
    )
    expect(deepseek.maxTokens).toBe(1_000_000)
    const gemini = resolveContextLimit(
      baseSettings({ llmProvider: 'openrouter', openrouterModel: 'gemini-9-pro-unknown' }),
    )
    expect(gemini.maxTokens).toBe(1_048_576)
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
