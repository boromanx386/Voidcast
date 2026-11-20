import { describe, expect, it } from 'vitest'
import { resolveCloudLlmChatConfigForProvider } from '../src/lib/cloudLlm'
import { nvidiaApiBaseUrl } from '../src/lib/platform'

describe('NVIDIA goes through the local tools proxy', () => {
  it('routes hosted NIM through the tools server, which sidesteps the missing CORS headers', () => {
    expect(nvidiaApiBaseUrl('https://integrate.api.nvidia.com/v1', 'http://127.0.0.1:8765/')).toBe(
      'http://127.0.0.1:8765/api/nvidia/v1',
    )
    expect(nvidiaApiBaseUrl('', undefined)).toBe('http://127.0.0.1:8765/api/nvidia/v1')
    expect(nvidiaApiBaseUrl('https://INTEGRATE.api.nvidia.com/v1/', 'http://127.0.0.1:9000')).toBe(
      'http://127.0.0.1:9000/api/nvidia/v1',
    )
  })

  it('leaves a self-hosted NIM address alone', () => {
    expect(nvidiaApiBaseUrl('http://192.168.1.20:8000/v1/', 'http://127.0.0.1:8765')).toBe(
      'http://192.168.1.20:8000/v1',
    )
  })

  it('resolves the chat config to the proxy', () => {
    const cfg = resolveCloudLlmChatConfigForProvider('nvidia', {
      nvidiaBaseUrl: 'https://integrate.api.nvidia.com/v1',
      nvidiaApiKey: 'nvapi-test',
      nvidiaModel: 'nvidia/nemotron-3-ultra-550b-a55b',
      ttsBaseUrl: 'http://127.0.0.1:8765',
    })
    expect(cfg?.baseUrl).toBe('http://127.0.0.1:8765/api/nvidia/v1')
    expect(cfg?.apiKey).toBe('nvapi-test')
  })
})
