import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  callNativeSubAgentToolRound,
  type NativeSubAgentMessage,
} from '../src/lib/subAgentToolLoop'
import type { SubAgentConfig } from '../src/lib/settings'
import type { SubAgentKeys } from '../src/lib/subAgent'

const keys: SubAgentKeys = {
  ollamaBaseUrl: 'http://localhost:11434',
  openrouterBaseUrl: 'https://openrouter.ai/api/v1',
  openrouterApiKey: 'test-openrouter-key',
  deepseekBaseUrl: 'https://api.deepseek.com',
  deepseekApiKey: '',
  openaiBaseUrl: 'https://api.openai.com/v1',
  openaiApiKey: '',
  nvidiaBaseUrl: 'https://integrate.api.nvidia.com/v1',
  nvidiaApiKey: '',
  opencodeGoApiKey: '',
  ttsBaseUrl: 'http://127.0.0.1:8765',
}

const tool = {
  type: 'function' as const,
  function: {
    name: 'read_file',
    description: 'Read one file.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
}

function config(model: string, provider: NonNullable<SubAgentConfig['provider']>): SubAgentConfig {
  return {
    enabled: true,
    codingEnabled: true,
    model,
    provider,
    codingModel: model,
    codingProvider: provider,
    contextTokens: 16_384,
    outputTokens: 2_048,
  }
}

const messages: NativeSubAgentMessage[] = [
  { role: 'system', content: 'You are a coding worker.' },
  { role: 'user', content: 'Read src/example.ts.' },
]

describe('native sub-agent tool loop adapter', () => {
  afterEach(() => vi.restoreAllMocks())

  it('sends Ollama tools natively and normalizes the returned call', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          message: {
            content: '',
            tool_calls: [
              {
                id: 'call-1',
                type: 'function',
                function: { name: 'read_file', arguments: { path: 'src/example.ts' } },
              },
            ],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    const result = await callNativeSubAgentToolRound({
      messages,
      tools: [tool],
      config: config('qwen3:14b', 'ollama'),
      keys,
      maxTokens: 2_048,
    })

    const request = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body)) as {
      tools: unknown[]
      messages: Array<{ role: string; content: string }>
    }
    expect(request.tools).toEqual([tool])
    expect(request.messages).toEqual(messages)
    expect(result.toolCalls[0]?.function.name).toBe('read_file')
    expect(result.toolCalls[0]?.function.arguments).toEqual({ path: 'src/example.ts' })
  })

  it('sends OpenAI-compatible workers with native tools', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: 'I will inspect the file.',
                tool_calls: [
                  {
                    id: 'call-2',
                    type: 'function',
                    function: { name: 'read_file', arguments: '{"path":"src/example.ts"}' },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    const result = await callNativeSubAgentToolRound({
      messages,
      tools: [tool],
      config: config('anthropic/claude-sonnet', 'openrouter'),
      keys,
      maxTokens: 2_048,
    })

    const request = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body)) as {
      tools: unknown[]
      messages: Array<{ role: string; content: string }>
    }
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(request.tools).toEqual([tool])
    expect(request.messages).toEqual(messages)
    expect(result.content).toBe('I will inspect the file.')
    expect(result.toolCalls[0]?.id).toBe('call-2')
    expect(result.toolCalls[0]?.function.arguments).toBe('{"path":"src/example.ts"}')
  })
})
