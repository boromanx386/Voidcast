import { describe, expect, it } from 'vitest'
import {
  collectAudioStream,
  lyriaPromptText,
  lyriaRequestBody,
  sniffAudioMime,
} from '@/lib/openrouterMusic'
import {
  defaults,
  OPENROUTER_MUSIC_MODEL_DEFAULT,
  normalizeOpenRouterMusicModel,
  normalizeSettingsCandidate,
} from '@/lib/settings'

const sse = (...chunks: unknown[]) =>
  chunks.map((c) => `data: ${typeof c === 'string' ? c : JSON.stringify(c)}`).join('\n\n') +
  '\n\ndata: [DONE]\n'

describe('collectAudioStream', () => {
  it('joins audio chunks, text and the final cost', () => {
    const out = collectAudioStream(
      sse(
        { choices: [{ delta: { content: 'Verse one' } }] },
        { choices: [{ delta: { audio: { data: 'SUQz', format: 'mp3' } } }] },
        { choices: [{ delta: { audio: { data: 'AAAA' } } }] },
        ': keep-alive',
        { choices: [{ delta: {} }], usage: { cost: 0.08 } },
      ),
    )
    expect(out.audioBase64).toBe('SUQzAAAA')
    expect(out.format).toBe('mp3')
    expect(out.text).toBe('Verse one')
    expect(out.costUsd).toBe(0.08)
    expect(out.error).toBeUndefined()
  })

  it('falls back to the audio transcript and reports a stream error', () => {
    const out = collectAudioStream(
      sse(
        { choices: [{ delta: { audio: { transcript: 'la la' } } }] },
        { error: { message: 'quota exceeded' } },
      ),
    )
    expect(out.audioBase64).toBe('')
    expect(out.text).toBe('la la')
    expect(out.error).toBe('quota exceeded')
  })
})

describe('sniffAudioMime', () => {
  const bytes = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0))
  it('reads the container from the first bytes', () => {
    expect(sniffAudioMime(bytes('RIFF\0\0\0\0WAVEfmt '))).toBe('audio/wav')
    expect(sniffAudioMime(bytes('ID3\x04'))).toBe('audio/mpeg')
    expect(sniffAudioMime(Uint8Array.from([0xff, 0xfb, 0x90, 0x00]))).toBe('audio/mpeg')
    expect(sniffAudioMime(bytes('OggS'))).toBe('audio/ogg')
    expect(sniffAudioMime(bytes('fLaC'))).toBe('audio/flac')
  })
  it('uses the format hint when the bytes say nothing', () => {
    expect(sniffAudioMime(bytes('\0\0\0\0'), 'wav')).toBe('audio/wav')
    expect(sniffAudioMime(bytes('\0\0\0\0'))).toBe('audio/mpeg')
  })
})

describe('lyriaPromptText', () => {
  it('adds the musical details and lyrics the agent passed', () => {
    expect(
      lyriaPromptText({
        prompt: 'Jazzy hip hop',
        bpm: 88.4,
        keyScale: 'F major',
        vocalLanguage: 'sr',
        lyrics: 'Grad ne spava',
      }),
    ).toBe('Jazzy hip hop\n\n88 BPM, key: F major, vocal language: sr\n\nLyrics:\nGrad ne spava')
    expect(lyriaPromptText({ prompt: 'Lo-fi loop', vocalLanguage: 'unknown' })).toBe('Lo-fi loop')
  })
})

describe('music provider settings', () => {
  it('defaults to Runware and Lyria 3 Pro', () => {
    expect(defaults.musicProvider).toBe('runware')
    expect(defaults.openrouterMusicModel).toBe(OPENROUTER_MUSIC_MODEL_DEFAULT)
    expect(normalizeOpenRouterMusicModel('  ')).toBe(OPENROUTER_MUSIC_MODEL_DEFAULT)
  })
  it('keeps a saved OpenRouter pick and drops an unknown provider', () => {
    const kept = normalizeSettingsCandidate({
      ...defaults,
      musicProvider: 'openrouter',
      openrouterMusicModel: 'google/lyria-3-clip-preview',
    })
    expect(kept.musicProvider).toBe('openrouter')
    expect(kept.openrouterMusicModel).toBe('google/lyria-3-clip-preview')
    expect(kept.openrouterMusicFormat).toBe('mp3')
    const odd = normalizeSettingsCandidate({
      ...defaults,
      musicProvider: 'suno' as never,
    })
    expect(odd.musicProvider).toBe('runware')
  })
})

describe('lyriaRequestBody', () => {
  const req = { prompt: 'Synth pop' }
  it('asks Lyria 3 Pro for WAV only when WAV is picked', () => {
    expect(lyriaRequestBody(req, 'google/lyria-3-pro-preview', 'wav').audio).toEqual({
      format: 'wav',
    })
    expect(lyriaRequestBody(req, 'google/lyria-3-pro-preview', 'mp3').audio).toBeUndefined()
  })
  it('never asks Clip for WAV', () => {
    expect(lyriaRequestBody(req, 'google/lyria-3-clip-preview', 'wav').audio).toBeUndefined()
  })
})
