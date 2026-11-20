/**
 * Music generation through OpenRouter audio-output models (Google Lyria 3).
 *
 * Lyria is not a speech endpoint: it runs on chat completions like an LLM and streams
 * the song as base64 chunks in `delta.audio.data`, next to optional text (lyrics or a
 * description) in `delta.content` / `delta.audio.transcript`. OpenRouter requires
 * `stream: true` for audio output.
 */

import { invokeSaveAudioBytes } from '@/lib/saveAudio'
import { normalizeOpenRouterMusicModel } from '@/lib/settings'

export type OpenRouterMusicConfig = {
  apiKey: string
  baseUrl: string
  model: string
  /** Folder for the song; empty = the app's generated-audio folder. */
  outputDir?: string
}

export type OpenRouterMusicRequest = {
  prompt: string
  lyrics?: string
  bpm?: number
  keyScale?: string
  vocalLanguage?: string
}

export type CollectedAudioStream = {
  audioBase64: string
  /** Format the stream named, when it named one. */
  format: string
  text: string
  costUsd?: number
  error?: string
}

/** Fold an SSE body from chat completions into the audio, text and cost it carried. */
export function collectAudioStream(sse: string): CollectedAudioStream {
  let audioBase64 = ''
  let format = ''
  let content = ''
  let transcript = ''
  let costUsd: number | undefined
  let error: string | undefined
  for (const line of sse.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue
    const data = line.slice(5).trim()
    if (!data || data === '[DONE]') continue
    let chunk: {
      choices?: Array<{
        delta?: {
          content?: unknown
          audio?: { data?: unknown; transcript?: unknown; format?: unknown }
        }
      }>
      usage?: { cost?: unknown }
      error?: { message?: unknown }
    }
    try {
      chunk = JSON.parse(data)
    } catch {
      continue
    }
    if (chunk.error) {
      error = typeof chunk.error.message === 'string' ? chunk.error.message : 'Stream error'
    }
    const delta = chunk.choices?.[0]?.delta
    const audio = delta?.audio
    if (typeof audio?.data === 'string') audioBase64 += audio.data
    if (typeof audio?.transcript === 'string') transcript += audio.transcript
    if (typeof audio?.format === 'string' && audio.format) format = audio.format
    if (typeof delta?.content === 'string') content += delta.content
    if (typeof chunk.usage?.cost === 'number' && Number.isFinite(chunk.usage.cost)) {
      costUsd = chunk.usage.cost
    }
  }
  return {
    audioBase64,
    format,
    text: (content || transcript).trim(),
    ...(costUsd !== undefined ? { costUsd } : {}),
    ...(error ? { error } : {}),
  }
}

/** Audio MIME from the file's first bytes; the stream does not always name a format. */
export function sniffAudioMime(bytes: Uint8Array, formatHint = ''): string {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to))
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return 'audio/wav'
  if (ascii(0, 4) === 'OggS') return 'audio/ogg'
  if (ascii(0, 4) === 'fLaC') return 'audio/flac'
  if (ascii(0, 3) === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) {
    return 'audio/mpeg'
  }
  const hint = formatHint.toLowerCase()
  if (hint === 'wav' || hint === 'pcm16') return 'audio/wav'
  if (hint === 'flac') return 'audio/flac'
  if (hint === 'opus' || hint === 'ogg') return 'audio/ogg'
  return 'audio/mpeg'
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\s+/g, ''))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function openRouterRoot(config: OpenRouterMusicConfig): string {
  const trim = (u: string) => u.trim().replace(/\/+$/, '')
  return trim(config.baseUrl || 'https://openrouter.ai/api/v1')
}

/** The single user message Lyria gets: the prompt plus any musical details asked for. */
export function lyriaPromptText(req: OpenRouterMusicRequest): string {
  const parts = [req.prompt.trim()]
  const details: string[] = []
  if (typeof req.bpm === 'number' && Number.isFinite(req.bpm)) {
    details.push(`${Math.round(req.bpm)} BPM`)
  }
  if (req.keyScale?.trim()) details.push(`key: ${req.keyScale.trim()}`)
  const lang = req.vocalLanguage?.trim()
  if (lang && lang !== 'unknown') details.push(`vocal language: ${lang}`)
  if (details.length) parts.push(details.join(', '))
  if (req.lyrics?.trim()) parts.push(`Lyrics:\n${req.lyrics.trim()}`)
  return parts.join('\n\n')
}

export async function invokeOpenRouterGenerateMusic(
  req: OpenRouterMusicRequest,
  config: OpenRouterMusicConfig,
  signal?: AbortSignal,
): Promise<string> {
  const prompt = req.prompt.trim()
  if (!prompt) throw new Error('generate_music_runware requires a non-empty prompt.')
  const apiKey = (config.apiKey || '').trim()
  if (!apiKey) {
    throw new Error('OpenRouter API key is missing. Set it in Options → General.')
  }
  const model = normalizeOpenRouterMusicModel(config.model)
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`

  const started = Date.now()
  const res = await fetch(`${openRouterRoot(config)}/chat/completions`, {
    method: 'POST',
    headers,
    signal,
    body: JSON.stringify({
      model,
      stream: true,
      modalities: ['text', 'audio'],
      messages: [{ role: 'user', content: lyriaPromptText(req) }],
    }),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
    throw new Error(
      `OpenRouter music ${res.status}: ${body.error?.message || res.statusText || 'request failed'}`,
    )
  }
  const stream = collectAudioStream(await res.text())
  if (!stream.audioBase64) {
    throw new Error(
      stream.error ||
        `OpenRouter returned no audio from ${model}.${stream.text ? ` Model said: ${stream.text.slice(0, 300)}` : ''}`,
    )
  }
  const bytes = base64ToBytes(stream.audioBase64)
  const mime = sniffAudioMime(bytes, stream.format)
  const saved = await invokeSaveAudioBytes({
    bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    mime,
    filename: `voidcast-music-${new Date().toISOString().replace(/[:.]/g, '-')}`,
    ...(config.outputDir?.trim() ? { outputDir: config.outputDir.trim() } : {}),
  })
  if (!saved.ok || !saved.path) {
    throw new Error(`Failed to save the generated music. ${saved.text || ''}`.trim())
  }

  const lines = [
    'Music generated successfully.',
    `audio_path: ${saved.path}`,
    'provider: openrouter',
    `model: ${model}`,
    `output_format: ${mime.split('/')[1].replace('mpeg', 'mp3').toUpperCase()}`,
    `prompt: ${prompt.replace(/\s+/g, ' ')}`,
  ]
  if (stream.text) {
    const t = stream.text.length > 1500 ? `${stream.text.slice(0, 1500)}…` : stream.text
    lines.push(`model_text: ${t}`)
  }
  if (stream.costUsd !== undefined) lines.push(`cost_usd: ${stream.costUsd.toFixed(6)}`)
  lines.push(`elapsed_ms: ${Date.now() - started}`)
  return lines.join('\n')
}
