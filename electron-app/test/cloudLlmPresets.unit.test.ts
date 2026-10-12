import { describe, expect, it } from 'vitest'
import { isOpenCodeGoResponsesModel, openCodeGoApiStyle } from '../src/lib/cloudLlmPresets'

describe('openCodeGoApiStyle', () => {
  it('keeps Anthropic Messages models on /messages', () => {
    for (const id of ['claude-haiku-5-5', 'minimax-m3', 'qwen3.8-max', 'qwen3.7-plus']) {
      expect(openCodeGoApiStyle(id)).toBe('anthropic-messages')
    }
  })

  it('routes the Contributor tier to the Responses API', () => {
    for (const id of [
      'muse-spark-1.2-contributor',
      'muse-spark-1.3-contributor',
      'muse-spark-2.0-contributor-free',
    ]) {
      expect(openCodeGoApiStyle(id)).toBe('opencode-responses')
    }
  })

  it('defaults every other model to chat-completions', () => {
    for (const id of ['deepseek-v4-pro', 'kimi-k2.7-code', 'glm-5.3', 'longcat-2.5-preview-free']) {
      expect(openCodeGoApiStyle(id)).toBe('openai-chat')
    }
  })

  it('normalizes a provider-prefixed id before routing', () => {
    expect(openCodeGoApiStyle('opencode-go/claude-haiku-5-5')).toBe('anthropic-messages')
  })

  it('falls back to the first preset for a blank id', () => {
    expect(openCodeGoApiStyle('')).toBe('openai-chat')
  })

  it('prefers Anthropic Messages when a model matches both shapes', () => {
    // Guard: an explicit /messages membership must win over the Responses pattern.
    expect(openCodeGoApiStyle('claude-haiku-5-5')).toBe('anthropic-messages')
  })
})

describe('isOpenCodeGoResponsesModel', () => {
  it('matches on the contributor boundary, not a bare substring', () => {
    expect(isOpenCodeGoResponsesModel('muse-spark-1.2-contributor')).toBe(true)
    expect(isOpenCodeGoResponsesModel('contributor')).toBe(true)
    expect(isOpenCodeGoResponsesModel('notcontributor')).toBe(false)
    expect(isOpenCodeGoResponsesModel('muse-spark-1.2-contributors')).toBe(false)
  })
})
