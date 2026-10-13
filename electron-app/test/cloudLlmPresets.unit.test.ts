import { describe, expect, it } from 'vitest'
import { isOpenCodeGoResponsesModel, openCodeGoApiStyle } from '../src/lib/cloudLlmPresets'

describe('openCodeGoApiStyle', () => {
  it('keeps Anthropic Messages models on /messages', () => {
    for (const id of ['claude-haiku-5-5', 'minimax-m3', 'qwen3.8-max', 'qwen3.7-plus']) {
      expect(openCodeGoApiStyle(id)).toBe('anthropic-messages')
    }
  })

  it('routes the Responses-only families to /v1/responses', () => {
    // Exactly the six the live catalog puts on that endpoint.
    for (const id of [
      'grok-4.6',
      'grok-4.7',
      'muse-spark-1.2-contributor',
      'muse-spark-1.3-contributor',
      'gpt-5.6-luna',
      'gpt-6-luna',
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

  it('lets an explicit /messages membership win over the family rules', () => {
    expect(openCodeGoApiStyle('claude-haiku-5-5')).toBe('anthropic-messages')
  })
})

describe('isOpenCodeGoResponsesModel', () => {
  it('matches the Grok, Muse Spark and *-luna families', () => {
    expect(isOpenCodeGoResponsesModel('grok-4.7')).toBe(true)
    expect(isOpenCodeGoResponsesModel('muse-spark-1.2-contributor')).toBe(true)
    expect(isOpenCodeGoResponsesModel('gpt-5.6-luna')).toBe(true)
    expect(isOpenCodeGoResponsesModel('gpt-6-luna')).toBe(true)
  })

  it('does not over-reach into neighbouring families', () => {
    // Patterns are anchored: a containing substring or a sibling gpt model is not enough.
    expect(isOpenCodeGoResponsesModel('notgrok')).toBe(false)
    expect(isOpenCodeGoResponsesModel('gpt-5.6-sol')).toBe(false)
    expect(isOpenCodeGoResponsesModel('deepseek-v4-pro')).toBe(false)
    expect(isOpenCodeGoResponsesModel('qwen3.8-max')).toBe(false)
  })
})
