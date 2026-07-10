import { describe, it, expect } from 'vitest'
import {
  cacheEntriesFromDescribeResults,
  imageCatalogKey,
  lookupVisionCacheDescription,
  mergeImageVisionCache,
  normalizeImageVisionCache,
  visionCacheKey,
} from '../src/lib/imageVisionCache'

describe('imageCatalogKey', () => {
  it('prefers path when present', () => {
    expect(imageCatalogKey({ path: 'C:\\img.png', base64: 'abc' })).toBe('path:c:\\img.png')
  })

  it('uses base64 prefix when no path', () => {
    const b64 = 'A'.repeat(120)
    expect(imageCatalogKey({ base64: b64 })).toBe(`b64:${'A'.repeat(96)}`)
  })
})

describe('lookupVisionCacheDescription', () => {
  it('returns cached description by path key', () => {
    const cache = { 'path:c:\\img.png': 'red circle' }
    expect(lookupVisionCacheDescription({ path: 'C:\\img.png', base64: 'x' }, cache)).toBe(
      'red circle',
    )
  })

  it('returns undefined on miss', () => {
    expect(lookupVisionCacheDescription({ path: 'a.png', base64: 'x' }, {})).toBeUndefined()
  })

  it('uses separate cache entries per focus', () => {
    const img = { path: 'a.png', base64: 'x' }
    const cache = {
      [visionCacheKey(img)]: 'generic',
      [visionCacheKey(img, 'error text')]: 'errors only',
    }
    expect(lookupVisionCacheDescription(img, cache)).toBe('generic')
    expect(lookupVisionCacheDescription(img, cache, 'error text')).toBe('errors only')
    expect(lookupVisionCacheDescription(img, cache, 'button color')).toBeUndefined()
  })
})

describe('normalizeImageVisionCache', () => {
  it('trims and drops empty values', () => {
    expect(normalizeImageVisionCache({ a: '  hi ', b: '', c: 1 })).toEqual({ a: 'hi' })
  })

  it('caps entry count', () => {
    const raw: Record<string, string> = {}
    for (let i = 0; i < 80; i++) raw[`k${i}`] = `v${i}`
    const out = normalizeImageVisionCache(raw)
    expect(Object.keys(out).length).toBe(64)
    expect(out.k79).toBe('v79')
    expect(out.k0).toBeUndefined()
  })
})

describe('cacheEntriesFromDescribeResults', () => {
  it('maps successful descriptions by catalog key', () => {
    const recalled = [{ index: 1, path: 'z.png', base64: 'xyz' }]
    const entries = cacheEntriesFromDescribeResults(recalled, [
      { index: 1, path: 'z.png', description: 'blue button' },
    ])
    expect(entries[imageCatalogKey(recalled[0]!)]).toBe('blue button')
  })

  it('skips errors', () => {
    const recalled = [{ index: 1, base64: 'xyz' }]
    expect(
      cacheEntriesFromDescribeResults(recalled, [
        { index: 1, description: '', error: 'fail' },
      ]),
    ).toEqual({})
  })

  it('stores focused descriptions under focus cache key', () => {
    const recalled = [{ index: 1, path: 'z.png', base64: 'xyz' }]
    const entries = cacheEntriesFromDescribeResults(
      recalled,
      [{ index: 1, path: 'z.png', description: 'status bar error' }],
      'error text',
    )
    expect(entries[visionCacheKey(recalled[0]!, 'error text')]).toBe('status bar error')
    expect(entries[imageCatalogKey(recalled[0]!)]).toBeUndefined()
  })
})

describe('mergeImageVisionCache', () => {
  it('merges and normalizes', () => {
    expect(mergeImageVisionCache({ a: '1' }, { b: ' 2 ' })).toEqual({ a: '1', b: '2' })
  })
})
