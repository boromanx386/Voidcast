import { describe, expect, it } from 'vitest'
import { pickCompressionKeepFrom } from '../src/lib/chatMessages'
import { estimateContextUsage } from '../src/lib/contextUsage'

const msg = (role: 'user' | 'assistant', chars = 40) => ({ role, content: 'x'.repeat(chars) })
const chat = (pairs: number, chars = 40) =>
  Array.from({ length: pairs }, () => [msg('user', chars), msg('assistant', chars)]).flat()

describe('pickCompressionKeepFrom', () => {
  it('keeps the last 10 messages verbatim, starting on a user message', () => {
    const messages = chat(12)
    expect(pickCompressionKeepFrom(messages, 0, 10_000)).toBe(14)
  })

  it('aligns the tail to a user message', () => {
    const messages = [...chat(8), msg('assistant')]
    // len 17, the last 10 start at index 7 (assistant) → moves to 8 (user)
    expect(pickCompressionKeepFrom(messages, 0, 10_000)).toBe(8)
  })

  it('shrinks the tail to the token budget', () => {
    const messages = chat(12, 400) // 100 tokens per message
    // budget 450 tokens → at most 4 messages
    expect(pickCompressionKeepFrom(messages, 0, 450)).toBe(20)
  })

  it('only looks past the previous compression point', () => {
    const messages = chat(12)
    expect(pickCompressionKeepFrom(messages, 20, 10_000)).toBe(24)
  })

  it('summarizes everything when nothing older than the tail is left', () => {
    expect(pickCompressionKeepFrom(chat(3), 0, 10_000)).toBe(6)
  })
})

describe('estimateContextUsage history ratio', () => {
  it('decides compression on the first round, not on tool results', () => {
    const usage = estimateContextUsage(
      {
        prompt_eval_count: 950,
        eval_count: 10,
        turnTotals: {
          rounds: 5,
          promptTokens: 3000,
          completionTokens: 50,
          cachedPromptTokens: 0,
          unreportedRounds: 0,
          firstRoundPromptTokens: 200,
        },
      },
      1_000,
    )
    expect(usage?.ratio).toBe(0.95)
    expect(usage?.historyRatio).toBe(0.2)
    expect(usage?.shouldCompress).toBe(false)
    expect(usage?.shouldWarn).toBe(false)
  })

  it('falls back to the prompt for single-round turns', () => {
    const usage = estimateContextUsage({ prompt_eval_count: 950, eval_count: 10 }, 1_000)
    expect(usage?.historyRatio).toBe(0.95)
    expect(usage?.shouldCompress).toBe(true)
  })
})
