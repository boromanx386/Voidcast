import { describe, expect, test } from 'vitest'
import { isCodingPreviewImage } from '@/lib/codingImagePreview'

describe('isCodingPreviewImage', () => {
  test('accepts common raster and vector extensions', () => {
    expect(isCodingPreviewImage('demos/logo.png')).toBe(true)
    expect(isCodingPreviewImage('assets\\photo.JPG')).toBe(true)
    expect(isCodingPreviewImage('icon.webp')).toBe(true)
    expect(isCodingPreviewImage('diagram.svg')).toBe(true)
  })

  test('rejects non-image files', () => {
    expect(isCodingPreviewImage('src/App.tsx')).toBe(false)
    expect(isCodingPreviewImage('README.md')).toBe(false)
    expect(isCodingPreviewImage('archive.zip')).toBe(false)
  })
})
