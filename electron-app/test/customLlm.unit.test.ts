import { afterEach, describe, expect, it, vi } from 'vitest'
import { streamOpenRouterChat } from '../src/lib/openrouter'
import { resolveCloudLlmChatConfig } from '../src/lib/cloudLlm'
import { defaults, type CustomLlmApiStyle } from '../src/lib/settings'

const PROXY = 'http://127.0.0.1:8765/api/custom-llm'

function sse(events: unknown[]): Response {
  const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n'
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

/** One minimal streamed reply per wire format, all saying "hi". */
const REPLY: Record<CustomLlmApiStyle, unknown[]> = {
  'chat-completions': [{ choices: [{ delta: { content: 'hi' } }] }],
  responses: [
    { type: 'response.output_text.delta', delta: 'hi' },
    { type: 'response.completed', response: { status: 'completed' } },
  ],
  messages: [
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hi' } },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
  ],
}

function customConfig(apiStyle: CustomLlmApiStyle, customApiKey = 'sk-test') {
  const cfg = resolveCloudLlmChatConfig({
    ...defaults,
    llmProvider: 'custom',
    customBaseUrl: 'https://api.example.com/v1/',
    customApiKey,
    customModel: 'some-model',
    customApiStyle: apiStyle,
  })
  if (!cfg) throw new Error('no config')
  return cfg
}

describe('Custom provider routing', () => {
  afterEach(() => vi.unstubAllGlobals())

  it.each([
    ['chat-completions', '/chat/completions', 'authorization', 'Bearer sk-test'],
    ['responses', '/responses', 'authorization', 'Bearer sk-test'],
    ['messages', '/messages', 'x-api-key', 'sk-test'],
  ] as const)('%s goes to the proxy at %s', async (style, path, authHeader, authValue) => {
    const fetchMock = vi.fn(async () => sse(REPLY[style]))
    vi.stubGlobal('fetch', fetchMock)
    const cfg = customConfig(style)

    const out = await streamOpenRouterChat({
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      model: cfg.model,
      custom: cfg.custom,
      messages: [{ role: 'user', content: 'hello' }],
      onDelta: () => undefined,
    })

    expect(out.content).toBe('hi')
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`${PROXY}${path}`)
    const headers = init.headers as Record<string, string>
    // The trailing slash the user typed is dropped before it reaches the proxy.
    expect(headers['x-voidcast-upstream']).toBe('https://api.example.com/v1')
    expect(headers[authHeader === 'authorization' ? 'Authorization' : authHeader]).toBe(authValue)
    expect(headers['x-opencode-session']).toBeUndefined()
  })

  it('works without a key, as local servers need none', async () => {
    const fetchMock = vi.fn(async () => sse(REPLY['chat-completions']))
    vi.stubGlobal('fetch', fetchMock)
    const cfg = customConfig('chat-completions', '')
    await streamOpenRouterChat({
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      model: cfg.model,
      custom: cfg.custom,
      messages: [{ role: 'user', content: 'hello' }],
      onDelta: () => undefined,
    })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined()
  })

  it('fails with a clear message before any request when no base URL is set', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const cfg = resolveCloudLlmChatConfig({ ...defaults, llmProvider: 'custom', customModel: 'm' })
    await expect(
      streamOpenRouterChat({
        baseUrl: cfg!.baseUrl,
        apiKey: '',
        model: 'm',
        custom: cfg!.custom,
        messages: [{ role: 'user', content: 'hello' }],
        onDelta: () => undefined,
      }),
    ).rejects.toThrow(/Custom provider has no base URL/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('Custom model list', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('says to add /v1 when the server has no /models at the root', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"error":"File Not Found"}', { status: 404 })),
    )
    const { fetchCustomLlmModels } = await import('../src/lib/cloudLlm')
    await expect(
      fetchCustomLlmModels({
        route: { upstream: 'http://localhost:18200', apiStyle: 'chat-completions' },
        apiKey: '',
        ttsBaseUrl: 'http://127.0.0.1:8765',
      }),
    ).rejects.toThrow(/end in \/v1/)
    await expect(
      fetchCustomLlmModels({
        route: { upstream: 'http://localhost:18200/v1', apiStyle: 'chat-completions' },
        apiKey: '',
        ttsBaseUrl: 'http://127.0.0.1:8765',
      }),
    ).rejects.not.toThrow(/end in \/v1/)
  })
})
