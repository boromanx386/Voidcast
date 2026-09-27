import { describe, expect, test } from 'vitest'
import {
  buildToolImageCatalog,
  catalogItemId,
  catalogItemKey,
  dedupeCatalogChronological,
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

describe('catalogItemId', () => {
  test('is stable for the same image content/path', () => {
    const a = catalogItemId({ base64: 'abc', mime: 'image/png', path: '/Foo/Bar.png' })
    const b = catalogItemId({ base64: 'different', mime: 'image/png', path: '/foo/bar.png' })
    expect(a).toBe(b)
    expect(a).toMatch(/^img_[0-9a-f]{8}$/)
  })

  test('differs for different images', () => {
    const a = catalogItemId({ base64: 'abc', mime: 'image/png' })
    const b = catalogItemId({ base64: 'xyz', mime: 'image/png' })
    expect(a).not.toBe(b)
  })
})

describe('dedupeCatalogChronological', () => {
  test('keeps first occurrence (chronological order)', () => {
    const items: PendingChatImage[] = [
      { base64: 'same', mime: 'image/png', path: '/a.png' },
      { base64: 'same', mime: 'image/png', path: '/a.png' },
      { base64: 'other', mime: 'image/png' },
    ]
    const out = dedupeCatalogChronological(items)
    expect(out).toHaveLength(2)
    expect(out[0].path).toBe('/a.png')
  })
})

describe('buildToolImageCatalog', () => {
  test('history images first (oldest→newest), current attachments appended last', async () => {
    const history = [{ id: 'h1', role: 'user' as const, content: '', images: ['hist'] }]
    const queued: PendingChatImage[] = [
      { base64: 'q1', mime: 'image/png', path: '/q1.png' },
      { base64: 'q2', mime: 'image/png', path: '/q2.png' },
    ]
    const catalog = await buildToolImageCatalog(history, queued)
    expect(catalog.map((c) => c.base64)).toEqual(['hist', 'q1', 'q2'])
    expect(catalog[0].kind).toBe('attachment')
    expect(catalog[1].kind).toBe('pending')
    expect(catalog[2].kind).toBe('pending')
  })
})
