import { describe, expect, test } from 'vitest'
import { resolveOpenRouterImageRequest } from '../src/lib/openrouterImage'
import {
  getOpenRouterImageProfile,
  isGptImageQuality,
  isRunwareGptImageModel,
  OPENROUTER_GPT_IMAGE_2_5_FLARE_MODEL_ID,
  OPENROUTER_GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
  OPENROUTER_GPT_IMAGE_2_MODEL_ID,
  usesOpenRouterDedicatedImageApi,
} from '../src/lib/settings'

describe('usesOpenRouterDedicatedImageApi', () => {
  test('matches GPT Image 2 slug', () => {
    expect(usesOpenRouterDedicatedImageApi(OPENROUTER_GPT_IMAGE_2_MODEL_ID)).toBe(true)
    expect(usesOpenRouterDedicatedImageApi(' openai/gpt-image-2 ')).toBe(true)
  })

  test('matches both GPT Image 2.5 tiers', () => {
    expect(usesOpenRouterDedicatedImageApi(OPENROUTER_GPT_IMAGE_2_5_SUNBURST_MODEL_ID)).toBe(true)
    expect(usesOpenRouterDedicatedImageApi(OPENROUTER_GPT_IMAGE_2_5_FLARE_MODEL_ID)).toBe(true)
    expect(usesOpenRouterDedicatedImageApi(' openai/gpt-image-2.5-flare ')).toBe(true)
  })

  test('does not match Gemini image models', () => {
    expect(usesOpenRouterDedicatedImageApi('google/gemini-3.1-flash-lite-image')).toBe(false)
    expect(usesOpenRouterDedicatedImageApi('google/gemini-3.1-flash-image')).toBe(false)
  })
})

describe('isRunwareGptImageModel', () => {
  test('matches GPT Image 2 and both 2.5 tiers', () => {
    expect(isRunwareGptImageModel('openai:gpt-image@2')).toBe(true)
    expect(isRunwareGptImageModel('openai:gpt-image@2.5-sunburst')).toBe(true)
    expect(isRunwareGptImageModel('OPENAI:GPT-IMAGE@2.5-flare')).toBe(true)
  })

  test('does not match other Runware models', () => {
    expect(isRunwareGptImageModel('runware:z-image@turbo')).toBe(false)
    expect(isRunwareGptImageModel('')).toBe(false)
  })
})

describe('isGptImageQuality', () => {
  test('accepts the 2.5 quality enum (including xhigh and max)', () => {
    for (const q of ['auto', 'low', 'medium', 'high', 'xhigh', 'max']) {
      expect(isGptImageQuality(q)).toBe(true)
    }
    expect(isGptImageQuality('ultra')).toBe(false)
    expect(isGptImageQuality(undefined)).toBe(false)
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

  test('fits GPT Image 2.5 Sunburst dimensions and keeps 21:9', () => {
    const dims = resolveOpenRouterImageRequest({
      width: 2016,
      height: 864,
      model: OPENROUTER_GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
    })
    expect(dims.aspectRatio).toBe('21:9')
    expect(dims.width % 16).toBe(0)
    expect(dims.height % 16).toBe(0)
  })

  test('treats GPT Image 2.5 Flare as a dedicated-image model', () => {
    const dims = resolveOpenRouterImageRequest({
      width: 1024,
      height: 1024,
      model: OPENROUTER_GPT_IMAGE_2_5_FLARE_MODEL_ID,
    })
    expect(dims.aspectRatio).toBe('1:1')
    expect(dims.width % 16).toBe(0)
  })
})

describe('transparent background profile flag', () => {
  test('getOpenRouterImageProfile surfaces a stored transparentBackground', () => {
    const profile = getOpenRouterImageProfile({
      openrouterImageModel: OPENROUTER_GPT_IMAGE_2_5_SUNBURST_MODEL_ID,
      openrouterImageProfiles: {
        [OPENROUTER_GPT_IMAGE_2_5_SUNBURST_MODEL_ID]: {
          width: 1024,
          height: 1024,
          steps: 20,
          cfgScale: 7,
          transparentBackground: true,
        },
      },
      runwareWidth: 1024,
      runwareHeight: 1024,
    })
    expect(profile.transparentBackground).toBe(true)
  })

  test('default GPT profiles treat transparentBackground as off', () => {
    const profile = getOpenRouterImageProfile({
      openrouterImageModel: OPENROUTER_GPT_IMAGE_2_MODEL_ID,
      openrouterImageProfiles: {},
      runwareWidth: 1024,
      runwareHeight: 1024,
    })
    expect(profile.transparentBackground ?? false).toBe(false)
  })
})
