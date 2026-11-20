import { afterEach, describe, expect, it, vi } from 'vitest'
import { streamOpenRouterChat } from '../src/lib/openrouter'

describe('NVIDIA Electron proxy fallback', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('retries without stream_options, which NVIDIA rejects on a non-streaming request', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )
    const llmChatProxy = vi.fn(async () => ({
      ok: true,
      data: { choices: [{ message: { content: 'hi' } }] },
    }))
    vi.stubGlobal('window', { voidcast: { llmChatProxy } })

    const out = await streamOpenRouterChat({
      baseUrl: 'https://integrate.api.nvidia.com/v1',
      apiKey: 'nvapi-test',
      model: 'nvidia/nemotron-3-ultra-550b-a55b',
      messages: [{ role: 'user', content: 'hello' }],
      onDelta: () => undefined,
    })

    expect(out.content).toBe('hi')
    const [payload] = llmChatProxy.mock.calls[0] as unknown as [{ body: Record<string, unknown> }]
    expect(payload.body.stream).toBe(false)
    expect(payload.body).not.toHaveProperty('stream_options')
  })
})
