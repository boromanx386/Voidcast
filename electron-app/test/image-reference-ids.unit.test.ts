import { describe, expect, test } from 'vitest'
import { imageCatalogId } from '../src/lib/imageVisionCache'
import {
  indexesFromReferenceIds,
  parseImageIds,
} from '../src/lib/toolHandlers/helpers'

describe('parseImageIds', () => {
  test('splits comma/space lists and dedupes', () => {
    expect(parseImageIds('img_a, img_b  img_a')).toEqual(['img_a', 'img_b'])
    expect(parseImageIds(['img_a,img_b'])).toEqual(['img_a', 'img_b'])
    expect(parseImageIds(undefined)).toEqual([])
  })
})

describe('indexesFromReferenceIds', () => {
  test('maps stable ids to 1-based catalog positions', () => {
    const images = ['aaa', 'bbb']
    const paths = ['/a.png', '/b.png']
    const idA = imageCatalogId({ path: '/a.png', base64: 'aaa' })
    const idB = imageCatalogId({ path: '/b.png', base64: 'bbb' })
    const res = indexesFromReferenceIds(images, paths, [idB, idA])
    expect(res.indexes).toEqual([2, 1])
    expect(res.missingIds).toEqual([])
  })

  test('reports unknown ids', () => {
    const res = indexesFromReferenceIds(['aaa'], undefined, ['img_deadbeef'])
    expect(res.indexes).toEqual([])
    expect(res.missingIds).toEqual(['img_deadbeef'])
  })
})

describe('imageCatalogId', () => {
  test('stable for identical content/path, different otherwise', () => {
    const a = imageCatalogId({ path: '/x.png', base64: 'zzz' })
    const b = imageCatalogId({ path: '/X.PNG', base64: 'zzz' })
    const c = imageCatalogId({ base64: 'zzz' })
    expect(a).toBe(b)
    expect(a).not.toBe(c)
    expect(a).toMatch(/^img_[0-9a-f]{8}$/)
  })
})
