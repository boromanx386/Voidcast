import { describe, expect, test } from 'vitest'
import { resolveOpenRouterImageRequest } from '../src/lib/openrouterImage'
import {
  OPENROUTER_GPT_IMAGE_2_MODEL_ID,
  usesOpenRouterDedicatedImageApi,
} from '../src/lib/settings'

describe('usesOpenRouterDedicatedImageApi', () => {
  test('matches GPT Image 2 slug', () => {
    expect(usesOpenRouterDedicatedImageApi(OPENROUTER_GPT_IMAGE_2_MODEL_ID)).toBe(true)
    expect(usesOpenRouterDedicatedImageApi(' openai/gpt-image-2 ')).toBe(true)
  })

  test('does not match Gemini image models', () => {
    expect(usesOpenRouterDedicatedImageApi('google/gemini-3.1-flash-lite-image')).toBe(false)
    expect(usesOpenRouterDedicatedImageApi('google/gemini-3.1-flash-image')).toBe(false)
  })
})

describe('resolveOpenRouterImageRequest', () => {
  test('maps 1920x1080 to 16:9 and 2K for Gemini models', () => {
    const dims = resolveOpenRouterImageRequest({
      width: 1920,
      height: 1080,
      model: 'google/gemini-3.1-flash-lite-image',
    })
    expect(dims.aspectRatio).toBe('16:9')
    expect(dims.imageSize).toBe('2K')
    expect(dims.pixelSize).toBe('1920x1080')
  })

  test('fits GPT Image 2 dimensions to model constraints', () => {
    const dims = resolveOpenRouterImageRequest({
      width: 1920,
      height: 1080,
      model: OPENROUTER_GPT_IMAGE_2_MODEL_ID,
    })
    expect(dims.aspectRatio).toBe('16:9')
    expect(dims.pixelSize).toMatch(/^\d+x\d+$/)
    expect(dims.width % 16).toBe(0)
    expect(dims.height % 16).toBe(0)
  })
})
