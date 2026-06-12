import { describe, expect, test } from 'vitest'
import {
  catalogItemKey,
  dedupeCatalogNewestFirst,
  type PendingChatImage,
} from '../src/lib/chatImageCatalog'

describe('catalogItemKey', () => {
  test('prefers path key when path is set', () => {
    expect(catalogItemKey({ base64: 'abc', mime: 'image/png', path: '/Foo/Bar.png' })).toBe(
      'path:/foo/bar.png',
    )
  })

  test('uses base64 prefix when no path', () => {
    const key = catalogItemKey({ base64: 'abcdefghij', mime: 'image/png' })
    expect(key.startsWith('b64:')).toBe(true)
  })
})

describe('dedupeCatalogNewestFirst', () => {
  test('keeps first occurrence (newest-first order)', () => {
    const items: PendingChatImage[] = [
      { base64: 'same', mime: 'image/png', path: '/a.png' },
      { base64: 'same', mime: 'image/png', path: '/a.png' },
      { base64: 'other', mime: 'image/png' },
    ]
    const out = dedupeCatalogNewestFirst(items)
    expect(out).toHaveLength(2)
    expect(out[0].path).toBe('/a.png')
  })
})
