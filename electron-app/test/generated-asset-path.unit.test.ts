import { describe, expect, test } from 'vitest'
import {
  extensionFromAudioMime,
  isAbsoluteFilesystemPath,
  isPathInsideRoot,
  sanitizeAudioBaseName,
  validateProjectRelativeAudioPath,
} from '../src/lib/generatedAssetPath'

describe('validateProjectRelativeAudioPath', () => {
  test('accepts nested relative paths and normalizes extension', () => {
    const r = validateProjectRelativeAudioPath('public/audio/intro.mp3')
    expect(r).toEqual({
      ok: true,
      relativePath: 'public/audio/intro.mp3',
      ext: '.mp3',
    })
  })

  test('adds extension from mime when missing', () => {
    const r = validateProjectRelativeAudioPath('assets/vo', { mime: 'audio/wav' })
    expect(r).toEqual({
      ok: true,
      relativePath: 'assets/vo.wav',
      ext: '.wav',
    })
  })

  test('rejects absolute, unc, and traversal paths', () => {
    expect(validateProjectRelativeAudioPath('C:\\temp\\a.mp3').ok).toBe(false)
    expect(validateProjectRelativeAudioPath('/tmp/a.mp3').ok).toBe(false)
    expect(validateProjectRelativeAudioPath('\\\\server\\share\\a.mp3').ok).toBe(false)
    expect(validateProjectRelativeAudioPath('../secret.mp3').ok).toBe(false)
    expect(validateProjectRelativeAudioPath('a/../../b.mp3').ok).toBe(false)
  })

  test('rejects unsupported extensions and empty paths', () => {
    expect(validateProjectRelativeAudioPath('').ok).toBe(false)
    expect(validateProjectRelativeAudioPath('clip.exe').ok).toBe(false)
    expect(validateProjectRelativeAudioPath('clip\0.mp3').ok).toBe(false)
  })
})

describe('path helpers', () => {
  test('isAbsoluteFilesystemPath', () => {
    expect(isAbsoluteFilesystemPath('C:/x')).toBe(true)
    expect(isAbsoluteFilesystemPath('/usr/bin')).toBe(true)
    expect(isAbsoluteFilesystemPath('public/a.mp3')).toBe(false)
  })

  test('isPathInsideRoot', () => {
    expect(isPathInsideRoot('Q:/proj', 'Q:/proj/public/a.mp3')).toBe(true)
    expect(isPathInsideRoot('Q:/proj', 'Q:/proj')).toBe(false)
    expect(isPathInsideRoot('Q:/proj', 'Q:/other/a.mp3')).toBe(false)
  })

  test('sanitizeAudioBaseName and mime extension', () => {
    expect(sanitizeAudioBaseName('My Voice.mp3')).toBe('My Voice')
    expect(extensionFromAudioMime('audio/wav')).toBe('.wav')
    expect(extensionFromAudioMime('audio/mpeg')).toBe('.mp3')
  })
})
