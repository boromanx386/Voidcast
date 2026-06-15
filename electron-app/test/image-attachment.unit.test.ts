import { describe, expect, test } from 'vitest'
import { looksLikeImageFile, probeFileAsImage } from '../src/lib/imageAttachment'

function file(name: string, type = '', size = 128): File {
  const blob = new Blob([new Uint8Array(size)], { type: type || undefined })
  return new File([blob], name, { type })
}

describe('looksLikeImageFile', () => {
  test('recognizes image mime and extensions', () => {
    expect(looksLikeImageFile(file('photo.png', 'image/png'))).toBe(true)
    expect(looksLikeImageFile(file('x.jpg', ''))).toBe(true)
  })

  test('does not treat supported documents as images by extension alone', () => {
    expect(looksLikeImageFile(file('readme.md', ''))).toBe(false)
    expect(looksLikeImageFile(file('app.tsx', ''))).toBe(false)
  })
})

describe('probeFileAsImage', () => {
  test('never classifies supported chat documents as images', async () => {
    const docs = ['notes.txt', 'readme.md', 'data.json', 'report.pdf', 'doc.docx', 'main.ts']
    for (const name of docs) {
      await expect(probeFileAsImage(file(name, 'application/octet-stream'))).resolves.toBe(false)
    }
  })

  test('still accepts obvious images', async () => {
    await expect(probeFileAsImage(file('shot.png', 'image/png'))).resolves.toBe(true)
  })
})
