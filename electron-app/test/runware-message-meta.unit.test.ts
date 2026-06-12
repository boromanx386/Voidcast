import { describe, expect, test } from 'vitest'
import {
  extractMarkdownImageUrls,
  extractRunwareAudioUrls,
  extractRunwareImageUrls,
  extractSavedAudioPaths,
  extractSavedImagePaths,
  parseRunwareAudioToolMeta,
  parseRunwareImageToolMeta,
  stripGeneratedAudioLinkArtifacts,
  stripGeneratedImageLinkArtifacts,
} from '../src/lib/runwareMessageMeta'

describe('extractRunwareImageUrls', () => {
  test('extracts image_url lines and markdown images', () => {
    const text = [
      'image_url: https://cdn.example.com/a.jpg',
      '![alt](https://cdn.example.com/b.png)',
    ].join('\n')
    expect(extractRunwareImageUrls(text)).toEqual([
      'https://cdn.example.com/a.jpg',
      'https://cdn.example.com/b.png',
    ])
  })
})

describe('extractRunwareAudioUrls', () => {
  test('extracts audio_url lines', () => {
    expect(extractRunwareAudioUrls('audio_url: https://cdn.example.com/song.mp3')).toEqual([
      'https://cdn.example.com/song.mp3',
    ])
  })
})

describe('stripGeneratedImageLinkArtifacts', () => {
  test('removes markdown image and plain URL', () => {
    const url = 'https://cdn.example.com/x.png'
    const text = `Here is output\n![img](${url})\nimage_url: ${url}`
    const out = stripGeneratedImageLinkArtifacts(text, [url])
    expect(out).not.toContain(url)
    expect(out).toContain('Here is output')
  })
})

describe('stripGeneratedAudioLinkArtifacts', () => {
  test('removes audio_url and markdown link', () => {
    const url = 'https://cdn.example.com/a.mp3'
    const text = `[listen](${url})\naudio_url: ${url}`
    const out = stripGeneratedAudioLinkArtifacts(text, [url])
    expect(out).not.toContain(url)
    expect(out).toContain('listen')
  })
})

describe('extractSavedImagePaths', () => {
  test('parses Saved image lines', () => {
    expect(extractSavedImagePaths('Saved image: C:\\out\\pic.png')).toEqual(['C:\\out\\pic.png'])
  })
})

describe('extractSavedAudioPaths', () => {
  test('parses Saved audio lines', () => {
    expect(extractSavedAudioPaths('Saved audio: C:\\out\\song.wav')).toEqual(['C:\\out\\song.wav'])
  })
})

describe('extractMarkdownImageUrls', () => {
  test('strips trailing punctuation from URLs', () => {
    expect(extractMarkdownImageUrls('![x](https://example.com/a.png).')).toEqual([
      'https://example.com/a.png',
    ])
  })
})

describe('parseRunwareImageToolMeta', () => {
  test('parses key fields', () => {
    const meta = parseRunwareImageToolMeta(
      ['model: flux', 'size: 1024x1024', 'steps: 20', 'cost_usd: 0.01'].join('\n'),
    )
    expect(meta).toEqual({
      model: 'flux',
      size: '1024x1024',
      steps: 20,
      costUsd: 0.01,
    })
  })

  test('returns null for empty parse', () => {
    expect(parseRunwareImageToolMeta('no structured data')).toBeNull()
  })
})

describe('parseRunwareAudioToolMeta', () => {
  test('parses audio tool fields', () => {
    const meta = parseRunwareAudioToolMeta(
      ['model: ace-step', 'duration_sec: 30', 'output_format: mp3'].join('\n'),
    )
    expect(meta).toEqual({
      model: 'ace-step',
      durationSec: 30,
      outputFormat: 'mp3',
    })
  })
})
