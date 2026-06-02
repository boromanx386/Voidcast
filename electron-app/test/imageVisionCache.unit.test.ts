import { describe, it, expect } from 'vitest'
import {
  cacheEntriesFromDescribeResults,
  imageCatalogKey,
  mergeImageVisionCache,
  normalizeImageVisionCache,
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
})

describe('mergeImageVisionCache', () => {
  it('merges and normalizes', () => {
    expect(mergeImageVisionCache({ a: '1' }, { b: ' 2 ' })).toEqual({ a: '1', b: '2' })
  })
})
