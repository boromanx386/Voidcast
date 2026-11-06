import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  invokeOpenRouterEditImage,
  invokeOpenRouterGenerateImage,
  openRouterImageCost,
} from '../src/lib/openrouterImage'
import { parseRunwareImageToolMeta } from '../src/lib/runwareMessageMeta'

const config = { apiKey: 'test', baseUrl: 'https://or.test/api/v1', width: 1024, height: 1024 }
const GEMINI = 'google/gemini-3.1-flash-image'
const GPT = 'openai/gpt-image-2'
const IMAGE = 'data:image/png;base64,QUJD'

function stubResponse(body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })),
  )
}
const chatBody = (usage?: unknown) => ({
  choices: [{ message: { images: [{ image_url: { url: IMAGE } }] } }],
  usage,
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('openRouterImageCost', () => {
  test('reads usage.cost', () => {
    expect(openRouterImageCost({ cost: 0.04 })).toBe(0.04)
    expect(openRouterImageCost({ cost: 0 })).toBe(0)
  })

  test('adds the provider price only for a bring-your-own-key request', () => {
    const details = { upstream_inference_cost: 0.03 }
    expect(openRouterImageCost({ cost: 0.01, is_byok: true, cost_details: details })).toBeCloseTo(
      0.04,
    )
    expect(openRouterImageCost({ cost: 0.01, is_byok: false, cost_details: details })).toBe(0.01)
    expect(openRouterImageCost({ cost: 0.01, is_byok: true })).toBe(0.01)
  })

  test('reports nothing when there is no usable cost', () => {
    expect(openRouterImageCost(undefined)).toBeUndefined()
    expect(openRouterImageCost({})).toBeUndefined()
    expect(openRouterImageCost({ cost: '0.04' })).toBeUndefined()
    expect(openRouterImageCost({ cost: -1 })).toBeUndefined()
  })
})

describe('OpenRouter image results carry the cost', () => {
  test('chat-completions models, in the form the chat reads', async () => {
    stubResponse(chatBody({ cost: 0.039 }))
    const out = await invokeOpenRouterGenerateImage(
      { prompt: 'boat' },
      { ...config, model: GEMINI },
    )
    expect(out).toContain('cost_usd: 0.039000')
    expect(parseRunwareImageToolMeta(out)?.costUsd).toBe(0.039)
  })

  test('dedicated Images API models', async () => {
    stubResponse({ data: [{ b64_json: 'QUJD' }], usage: { cost: 0.0123 } })
    const out = await invokeOpenRouterGenerateImage({ prompt: 'boat' }, { ...config, model: GPT })
    expect(out).toContain('cost_usd: 0.012300')
  })

  test('edits', async () => {
    stubResponse(chatBody({ cost: 0.05 }))
    const out = await invokeOpenRouterEditImage(
      { prompt: 'make it blue', referenceImages: [IMAGE] },
      { ...config, model: GEMINI },
    )
    expect(out).toContain('cost_usd: 0.050000')
  })

  test('no cost line when the response has none', async () => {
    stubResponse(chatBody())
    const out = await invokeOpenRouterGenerateImage(
      { prompt: 'boat' },
      { ...config, model: GEMINI },
    )
    expect(out).not.toContain('cost_usd')
  })
})
