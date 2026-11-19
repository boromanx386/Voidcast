import { describe, expect, test } from 'vitest'
import { endpointQuant, endpointVariant, formatPricePerMillion } from '@/lib/openrouter'

describe('LIST ALL formatting', () => {
  test('prices per million keep cache-hit fractions of a cent', () => {
    expect(formatPricePerMillion('0.0000003')).toBe('0.30')
    expect(formatPricePerMillion('0.0000012')).toBe('1.20')
    expect(formatPricePerMillion('0.0000001')).toBe('0.10')
    expect(formatPricePerMillion('0.0000000507')).toBe('0.051')
    expect(formatPricePerMillion('0.000000001014')).toBe('0.001')
    expect(formatPricePerMillion('0.00000000336')).toBe('0.0034')
    expect(formatPricePerMillion('0')).toBe('0')
    expect(formatPricePerMillion(undefined)).toBe('—')
    expect(formatPricePerMillion('n/a')).toBe('—')
  })

  test('variant is the tag after the provider slug', () => {
    expect(endpointVariant('deepinfra/fp8/flex')).toBe('fp8/flex')
    expect(endpointVariant('together')).toBe('')
  })

  test('unknown or missing quantization shows a dash', () => {
    expect(endpointQuant('fp8')).toBe('fp8')
    expect(endpointQuant('unknown')).toBe('—')
    expect(endpointQuant(undefined)).toBe('—')
  })
})
