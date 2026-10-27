import { describe, expect, it } from 'vitest'
import { extractNativeRoundUsage } from '../src/lib/subAgentToolLoop'
import {
  applyCodingEvent,
  applyCodingStart,
  emptySubAgentPanelState,
  formatWorkerMetrics,
  normalizeSubAgentActivity,
  type SubAgentWorkerMetrics,
} from '../src/lib/subAgentPanelState'

const METRICS: SubAgentWorkerMetrics = {
  durationMs: 24_300,
  modelMs: 18_000,
  rounds: 6,
  toolCalls: 9,
  promptTokens: 18_200,
  completionTokens: 1_100,
  cachedPromptTokens: 12_000,
  unreportedRounds: 0,
}

describe('extractNativeRoundUsage', () => {
  it('reads OpenAI-style usage with a cache hit', () => {
    expect(
      extractNativeRoundUsage({
        usage: {
          prompt_tokens: 1000,
          completion_tokens: 50,
          prompt_tokens_details: { cached_tokens: 800 },
        },
      }),
    ).toEqual({ promptTokens: 1000, completionTokens: 50, cachedPromptTokens: 800 })
  })

  it('reads DeepSeek cache hits', () => {
    expect(
      extractNativeRoundUsage({
        usage: { prompt_tokens: 500, completion_tokens: 20, prompt_cache_hit_tokens: 400 },
      })?.cachedPromptTokens,
    ).toBe(400)
  })

  it('reads Anthropic / Responses input_tokens and output_tokens', () => {
    expect(
      extractNativeRoundUsage({
        usage: { input_tokens: 300, output_tokens: 40, cache_read_input_tokens: 100 },
      }),
    ).toEqual({ promptTokens: 300, completionTokens: 40, cachedPromptTokens: 100 })
  })

  it('reads Ollama counts from the response root', () => {
    expect(extractNativeRoundUsage({ prompt_eval_count: 70, eval_count: 9 })).toEqual({
      promptTokens: 70,
      completionTokens: 9,
      cachedPromptTokens: 0,
    })
  })

  it('returns undefined when nothing is reported', () => {
    expect(extractNativeRoundUsage({ choices: [] })).toBeUndefined()
    expect(extractNativeRoundUsage({ usage: {} })).toBeUndefined()
    expect(extractNativeRoundUsage(null)).toBeUndefined()
  })
})

describe('formatWorkerMetrics', () => {
  it('summarises time, rounds, tools and tokens', () => {
    expect(formatWorkerMetrics(METRICS)).toBe(
      '24s · 6 rounds · 9 tools · 18k in (12k cached) / 1.1k out',
    )
  })

  it('marks token totals as a lower bound when a round reported no usage', () => {
    expect(
      formatWorkerMetrics({
        ...METRICS,
        durationMs: 3_400,
        rounds: 1,
        toolCalls: 1,
        cachedPromptTokens: 0,
        promptTokens: 900,
        completionTokens: 80,
        unreportedRounds: 1,
      }),
    ).toBe('3.4s · 1 round · 1 tool · ≥900 in / ≥80 out')
  })
})

describe('worker metrics in the panel state', () => {
  it('stores metrics on the worker slot from its done event and survives persistence', () => {
    let s = applyCodingStart(emptySubAgentPanelState(), 'WORKER 1 · 0/50')
    s = applyCodingEvent(s, {
      workerId: 'worker-1',
      text: 'WORKER 1 done',
      status: 'done',
      metrics: METRICS,
    })
    expect(s.workers[0]?.metrics).toEqual(METRICS)

    const restored = normalizeSubAgentActivity(JSON.parse(JSON.stringify(s)))
    expect(restored?.workers[0]?.metrics).toEqual(METRICS)
  })
})
