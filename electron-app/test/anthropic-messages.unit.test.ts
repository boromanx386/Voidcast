import { describe, expect, it } from 'vitest'
import {
  ANTHROPIC_DEFAULT_MAX_TOKENS,
  ANTHROPIC_MAX_TOKENS_FALLBACKS,
  anthropicMaxTokensFallback,
  applyAnthropicStreamEvent,
  buildAnthropicMessagesBody,
  createAnthropicStreamState,
} from '../src/lib/anthropicMessages'
import type { OpenRouterMessage } from '../src/lib/openrouter'

const messages: OpenRouterMessage[] = [
  { role: 'user', content: 'hi' },
  { role: 'assistant', content: 'hello', tool_calls: undefined },
]

describe('buildAnthropicMessagesBody', () => {
  it('always sends a positive max_tokens', () => {
    expect(buildAnthropicMessagesBody({ model: 'm', messages }).max_tokens).toBe(
      ANTHROPIC_DEFAULT_MAX_TOKENS,
    )
  })

  it('honors an explicit maxTokens', () => {
    expect(
      buildAnthropicMessagesBody({ model: 'm', messages, maxTokens: 4096 }).max_tokens,
    ).toBe(4096)
  })

  it('falls back to the default for a non-positive maxTokens', () => {
    for (const bad of [0, -1, undefined]) {
      expect(
        buildAnthropicMessagesBody({ model: 'm', messages, maxTokens: bad }).max_tokens,
      ).toBe(ANTHROPIC_DEFAULT_MAX_TOKENS)
    }
  })
})

describe('anthropicMaxTokensFallback', () => {
  it('uses the first rung of the ladder', () => {
    expect(
      anthropicMaxTokensFallback(400, 'max_tokens: 16384 > 8192', 16384, 0),
    ).toBe(ANTHROPIC_MAX_TOKENS_FALLBACKS[0])
  })

  it('walks one rung per rejection', () => {
    expect(anthropicMaxTokensFallback(400, 'max_tokens: 8192 > 4096', 8192, 1)).toBe(
      ANTHROPIC_MAX_TOKENS_FALLBACKS[1],
    )
  })

  it('is case-insensitive on the provider wording', () => {
    expect(anthropicMaxTokensFallback(400, 'MAX_TOKENS exceeds limit', 16384, 0)).toBe(
      ANTHROPIC_MAX_TOKENS_FALLBACKS[0],
    )
  })

  it('gives up once the ladder is exhausted', () => {
    expect(anthropicMaxTokensFallback(400, 'max_tokens: 4096 > 4096', 4096, 2)).toBeNull()
  })

  it('never steps up', () => {
    // A current cap already at/below the next rung is not a rejection we can fix.
    expect(anthropicMaxTokensFallback(400, 'max_tokens: 8192 > 8192', 8192, 0)).toBeNull()
  })

  it('ignores a negative step', () => {
    expect(
      anthropicMaxTokensFallback(400, 'max_tokens: 16384 > 8192', 16384, -1),
    ).toBeNull()
  })

  it('does not retry a non-400 status', () => {
    for (const status of [401, 429, 500, 503]) {
      expect(anthropicMaxTokensFallback(status, 'max_tokens too large', 16384, 0)).toBeNull()
    }
  })

  it('does not retry a 400 that is not about max_tokens', () => {
    expect(
      anthropicMaxTokensFallback(400, 'invalid_request_error: messages', 16384, 0),
    ).toBeNull()
  })
})

describe('applyAnthropicStreamEvent', () => {
  it('captures stop_reason from message_delta', () => {
    const state = createAnthropicStreamState()
    applyAnthropicStreamEvent(state, {
      type: 'message_delta',
      delta: { stop_reason: 'max_tokens' },
      usage: { output_tokens: 12 },
    })
    expect(state.stopReason).toBe('max_tokens')
  })

  it('captures stop_reason from message_stop', () => {
    const state = createAnthropicStreamState()
    applyAnthropicStreamEvent(state, { type: 'message_stop', message: { stop_reason: 'end_turn' } })
    expect(state.stopReason).toBe('end_turn')
  })

  it('keeps stop_reason from message_stop when message_delta has none', () => {
    const state = createAnthropicStreamState()
    applyAnthropicStreamEvent(state, {
      type: 'message_delta',
      delta: {},
      usage: { output_tokens: 1 },
    })
    applyAnthropicStreamEvent(state, { type: 'message_stop', message: { stop_reason: 'max_tokens' } })
    expect(state.stopReason).toBe('max_tokens')
  })

  it('accumulates tool_use input across deltas', () => {
    const state = createAnthropicStreamState()
    applyAnthropicStreamEvent(state, {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: 'toolu_1', name: 'read_file' },
    })
    applyAnthropicStreamEvent(state, {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: '{"path":' },
    })
    applyAnthropicStreamEvent(state, {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: '"a.ts"}' },
    })
    applyAnthropicStreamEvent(state, { type: 'message_stop', message: { stop_reason: 'tool_use' } })
    expect(state.toolCalls).toHaveLength(1)
    expect(state.toolCalls[0].id).toBe('toolu_1')
    expect(state.toolCalls[0].function.name).toBe('read_file')
    expect(state.toolCalls[0].function.arguments).toBe('{"path":"a.ts"}')
    expect(state.stopReason).toBe('tool_use')
  })
})
