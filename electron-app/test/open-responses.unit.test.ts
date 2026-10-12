import { describe, expect, it } from 'vitest'
import {
  RESPONSES_DEFAULT_MAX_OUTPUT_TOKENS,
  RESPONSES_MAX_OUTPUT_TOKENS_FALLBACKS,
  applyResponsesStreamEvent,
  buildResponsesBody,
  createResponsesStreamState,
  openAiToolsToResponses,
  openRouterMessagesToResponses,
  parseResponsesOutput,
  responsesMaxTokensFallback,
} from '../src/lib/openResponses'
import type { OpenRouterMessage } from '../src/lib/openrouter'

const messages: OpenRouterMessage[] = [
  { role: 'user', content: 'hi' },
  { role: 'assistant', content: 'hello' },
]

describe('buildResponsesBody', () => {
  it('always sends a positive max_output_tokens', () => {
    expect(buildResponsesBody({ model: 'm', messages }).max_output_tokens).toBe(
      RESPONSES_DEFAULT_MAX_OUTPUT_TOKENS,
    )
  })

  it('honors an explicit maxTokens', () => {
    expect(buildResponsesBody({ model: 'm', messages, maxTokens: 4096 }).max_output_tokens).toBe(
      4096,
    )
  })

  it('falls back to the default for a non-positive maxTokens', () => {
    for (const bad of [0, -1, undefined]) {
      expect(buildResponsesBody({ model: 'm', messages, maxTokens: bad }).max_output_tokens).toBe(
        RESPONSES_DEFAULT_MAX_OUTPUT_TOKENS,
      )
    }
  })

  it('never sends store, which the gateway rejects as an unknown field', () => {
    expect(buildResponsesBody({ model: 'm', messages })).not.toHaveProperty('store')
  })

  it('routes the system prompt to instructions instead of input', () => {
    const body = buildResponsesBody({
      model: 'm',
      messages: [{ role: 'system', content: 'be brief' }, ...messages],
    })
    expect(body.instructions).toBe('be brief')
    expect(JSON.stringify(body.input)).not.toContain('be brief')
  })

  it('sends reasoning effort only when thinking is on', () => {
    expect(buildResponsesBody({ model: 'm', messages, thinkLevel: 'off' })).not.toHaveProperty(
      'reasoning',
    )
    expect(buildResponsesBody({ model: 'm', messages, thinkLevel: 'high' }).reasoning).toEqual({
      effort: 'high',
      summary: 'auto',
    })
  })

  it('flattens nested chat-completions tools', () => {
    const body = buildResponsesBody({
      model: 'm',
      messages,
      tools: [
        {
          type: 'function',
          function: { name: 'read_file', description: 'read', parameters: { type: 'object' } },
        },
      ],
    })
    expect(body.tools).toEqual([
      { type: 'function', name: 'read_file', description: 'read', parameters: { type: 'object' } },
    ])
  })
})

describe('openRouterMessagesToResponses', () => {
  it('turns an assistant tool call into a function_call item', () => {
    const { input } = openRouterMessagesToResponses([
      { role: 'user', content: 'go' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '{"p":"a"}' } },
        ],
      },
    ])
    expect(input).toEqual([
      { type: 'message', role: 'user', content: 'go' },
      { type: 'function_call', call_id: 'call_1', name: 'read_file', arguments: '{"p":"a"}' },
    ])
  })

  it('links a tool result back by call_id', () => {
    const { input } = openRouterMessagesToResponses([
      { role: 'tool', content: 'done', tool_call_id: 'call_1' },
    ])
    expect(input).toEqual([{ type: 'function_call_output', call_id: 'call_1', output: 'done' }])
  })

  it('emits output_text parts for assistant history', () => {
    const { input } = openRouterMessagesToResponses([{ role: 'assistant', content: 'hi there' }])
    expect(input).toEqual([
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'hi there' }] },
    ])
  })

  it('does not merge consecutive same-role messages', () => {
    const { input } = openRouterMessagesToResponses([
      { role: 'user', content: 'a' },
      { role: 'user', content: 'b' },
    ])
    expect(input).toHaveLength(2)
  })

  it('defaults missing tool arguments to an empty object', () => {
    const { input } = openRouterMessagesToResponses([
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'c', type: 'function', function: { name: 'x', arguments: '' } }],
      },
    ])
    expect(input[0]).toMatchObject({ arguments: '{}' })
  })
})

describe('openAiToolsToResponses', () => {
  it('returns undefined for a non-array', () => {
    expect(openAiToolsToResponses(undefined)).toBeUndefined()
    expect(openAiToolsToResponses({})).toBeUndefined()
  })

  it('skips an entry without a name and defaults missing parameters', () => {
    expect(openAiToolsToResponses([{ type: 'function' }])).toBeUndefined()
    expect(openAiToolsToResponses([{ type: 'function', function: { name: 'x' } }])).toEqual([
      { type: 'function', name: 'x', parameters: { type: 'object', properties: {} } },
    ])
  })
})

describe('responsesMaxTokensFallback', () => {
  it('uses the first rung of the ladder', () => {
    expect(responsesMaxTokensFallback(400, 'max_output_tokens: 16384 > 8192', 16384, 0)).toBe(
      RESPONSES_MAX_OUTPUT_TOKENS_FALLBACKS[0],
    )
  })

  it('walks one rung per rejection', () => {
    expect(responsesMaxTokensFallback(400, 'max_output_tokens exceeds 8192', 8192, 1)).toBe(4096)
  })

  it('gives up once the ladder is exhausted', () => {
    expect(responsesMaxTokensFallback(400, 'max_output_tokens: 4096 > 4096', 4096, 2)).toBeNull()
  })

  it('never steps up', () => {
    expect(responsesMaxTokensFallback(400, 'max_output_tokens too large', 8192, 0)).toBeNull()
  })

  it('does not retry a non-400 status or an unrelated 400', () => {
    expect(responsesMaxTokensFallback(429, 'max_output_tokens', 16384, 0)).toBeNull()
    expect(responsesMaxTokensFallback(400, 'unsupported parameter: tools', 16384, 0)).toBeNull()
  })

  it('ignores a negative step', () => {
    expect(responsesMaxTokensFallback(400, 'max_output_tokens too large', 16384, -1)).toBeNull()
  })
})

describe('applyResponsesStreamEvent', () => {
  it('accumulates output text and reports the change', () => {
    const state = createResponsesStreamState()
    const first = applyResponsesStreamEvent(state, { type: 'response.output_text.delta', delta: 'he' })
    applyResponsesStreamEvent(state, { type: 'response.output_text.delta', delta: 'llo' })
    expect(state.text).toBe('hello')
    expect(first.textChanged).toBe(true)
  })

  it('accumulates reasoning summaries', () => {
    const state = createResponsesStreamState()
    const r = applyResponsesStreamEvent(state, {
      type: 'response.reasoning_summary_text.delta',
      delta: 'thinking',
    })
    expect(state.reasoning).toBe('thinking')
    expect(r.reasoningChanged).toBe(true)
  })

  it('streams function call arguments into the matching slot', () => {
    const state = createResponsesStreamState()
    applyResponsesStreamEvent(state, {
      type: 'response.output_item.added',
      output_index: 0,
      item: { type: 'function_call', call_id: 'call_9', name: 'read_file' },
    })
    applyResponsesStreamEvent(state, {
      type: 'response.function_call_arguments.delta',
      output_index: 0,
      delta: '{"path":',
    })
    applyResponsesStreamEvent(state, {
      type: 'response.function_call_arguments.delta',
      output_index: 0,
      delta: '"a.ts"}',
    })
    expect(state.toolCalls).toHaveLength(1)
    expect(state.toolCalls[0].id).toBe('call_9')
    expect(state.toolCalls[0].function.name).toBe('read_file')
    expect(state.toolCalls[0].function.arguments).toBe('{"path":"a.ts"}')
  })

  it('recovers a function call from output_item.done when no deltas arrived', () => {
    const state = createResponsesStreamState()
    applyResponsesStreamEvent(state, {
      type: 'response.output_item.done',
      output_index: 1,
      item: { type: 'function_call', call_id: 'call_x', name: 'grep', arguments: '{"q":"x"}' },
    })
    expect(state.toolCalls).toHaveLength(1)
    expect(state.toolCalls[0]).toMatchObject({
      id: 'call_x',
      function: { name: 'grep', arguments: '{"q":"x"}' },
    })
  })

  it('lets arguments.done override streamed deltas', () => {
    const state = createResponsesStreamState()
    applyResponsesStreamEvent(state, {
      type: 'response.output_item.added',
      output_index: 0,
      item: { type: 'function_call', call_id: 'c', name: 'f' },
    })
    applyResponsesStreamEvent(state, {
      type: 'response.function_call_arguments.delta',
      output_index: 0,
      delta: '{"a":1}',
    })
    applyResponsesStreamEvent(state, {
      type: 'response.function_call_arguments.done',
      output_index: 0,
      arguments: '{"a":2}',
    })
    expect(state.toolCalls[0].function.arguments).toBe('{"a":2}')
  })

  it('maps usage without double-counting cached tokens', () => {
    const state = createResponsesStreamState()
    applyResponsesStreamEvent(state, {
      type: 'response.completed',
      response: {
        status: 'completed',
        usage: {
          input_tokens: 100,
          output_tokens: 20,
          total_tokens: 120,
          input_tokens_details: { cached_tokens: 40 },
        },
      },
    })
    expect(state.usage).toEqual({
      prompt_tokens: 100,
      completion_tokens: 20,
      total_tokens: 120,
      prompt_tokens_details: { cached_tokens: 40, cache_write_tokens: 0 },
    })
  })

  it('records an incomplete reason for the empty-turn guard', () => {
    const state = createResponsesStreamState()
    applyResponsesStreamEvent(state, {
      type: 'response.incomplete',
      response: { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } },
    })
    expect(state.incompleteReason).toBe('max_output_tokens')
    expect(state.status).toBe('incomplete')
  })

  it('throws on error and failed events', () => {
    expect(() =>
      applyResponsesStreamEvent(createResponsesStreamState(), {
        type: 'error',
        error: { message: 'boom' },
      }),
    ).toThrow('boom')
    expect(() =>
      applyResponsesStreamEvent(createResponsesStreamState(), {
        type: 'response.failed',
        response: { error: { message: 'nope' } },
      }),
    ).toThrow('nope')
  })

  it('ignores unrelated events', () => {
    const state = createResponsesStreamState()
    expect(applyResponsesStreamEvent(state, { type: 'response.created' })).toEqual({
      textChanged: false,
      reasoningChanged: false,
    })
    expect(state.text).toBe('')
  })
})

describe('parseResponsesOutput', () => {
  it('collects text, reasoning and function calls from a non-streaming payload', () => {
    const parsed = parseResponsesOutput({
      output: [
        { type: 'reasoning', summary: [{ type: 'summary_text', text: 'why' }] },
        { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'answer' }] },
        { type: 'function_call', call_id: 'call_1', name: 'read_file', arguments: '{"p":1}' },
      ],
    })
    expect(parsed.content).toBe('answer')
    expect(parsed.reasoning).toBe('why')
    expect(parsed.toolCalls).toHaveLength(1)
    expect(parsed.toolCalls[0]).toMatchObject({
      id: 'call_1',
      function: { name: 'read_file', arguments: '{"p":1}' },
    })
  })

  it('defaults empty arguments and skips an unnamed call', () => {
    const parsed = parseResponsesOutput({
      output: [
        { type: 'function_call', call_id: 'c', name: 'f', arguments: '' },
        { type: 'function_call', call_id: 'd' },
      ],
    })
    expect(parsed.toolCalls).toHaveLength(1)
    expect(parsed.toolCalls[0].function.arguments).toBe('{}')
  })

  it('tolerates a missing or malformed output array', () => {
    expect(parseResponsesOutput(undefined)).toEqual({ content: '', reasoning: '', toolCalls: [] })
    expect(parseResponsesOutput({ output: 'nope' })).toEqual({
      content: '',
      reasoning: '',
      toolCalls: [],
    })
  })
})
