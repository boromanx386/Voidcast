import { afterEach, describe, expect, test, vi } from 'vitest'
import { invokeRunwareEditImage, invokeRunwareGenerateImage } from '../src/lib/runware'

const config = {
  apiKey: 'test',
  apiBaseUrl: 'https://rw.test/v1',
  model: 'openai:gpt-image@2.6-flare',
  width: 1024,
  height: 1024,
  steps: 30,
  cfgScale: 7,
  gptQuality: 'low',
} as Parameters<typeof invokeRunwareGenerateImage>[1]

function stubRunware() {
  const fetchMock = vi.fn(
    async (_url: string, _init: { body: string }) =>
      new Response(JSON.stringify({ data: [{ imageURL: 'https://rw.test/a.png' }] }), {
        status: 200,
      }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return () => JSON.parse(fetchMock.mock.calls[0][1].body)[0] as Record<string, unknown>
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Runware GPT Image quality field', () => {
  test.each(['openai:gpt-image@2.6-flare', 'openai:gpt-image@2.6-sunburst'])(
    '%s sends quality through settings',
    async (model) => {
      const sent = stubRunware()
      await invokeRunwareGenerateImage({ prompt: 'boat', model }, config)
      expect(sent().settings).toEqual({ quality: 'low' })
      expect(sent().providerSettings).toBeUndefined()
    },
  )

  test.each(['openai:gpt-image@2', 'openai:gpt-image@2.5-flare'])(
    '%s keeps providerSettings',
    async (model) => {
      const sent = stubRunware()
      await invokeRunwareGenerateImage({ prompt: 'boat', model }, config)
      expect(sent().providerSettings).toEqual({ openai: { quality: 'low' } })
      expect(sent().settings).toBeUndefined()
    },
  )

  test('2.6 transparent background goes through settings as a PNG', async () => {
    const sent = stubRunware()
    await invokeRunwareGenerateImage({ prompt: 'boat', transparentBackground: true }, config)
    expect(sent().settings).toEqual({ quality: 'low', background: 'transparent' })
    expect(sent().outputFormat).toBe('PNG')
  })

  test('2.6 edits use the edit quality through settings', async () => {
    const sent = stubRunware()
    await invokeRunwareEditImage(
      { prompt: 'make it blue', referenceImages: ['data:image/png;base64,QUJD'] },
      {
        ...config,
        editModel: 'openai:gpt-image@2.6-sunburst',
        editDefaults: { gptQuality: 'medium' },
      } as Parameters<typeof invokeRunwareEditImage>[1],
    )
    expect(sent().settings).toEqual({ quality: 'medium' })
    expect(sent().providerSettings).toBeUndefined()
  })
})
