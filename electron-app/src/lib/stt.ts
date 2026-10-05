import { usesServerCloudProxy } from '@/lib/platform'
import { normalizeBaseUrl } from '@/lib/settings'

export type SttProvider = 'none' | 'openrouter' | 'whistle'

export async function startRecording(): Promise<{
  stop: () => Promise<Blob>
}> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })
  const chunks: Blob[] = []

  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data)
  }

  recorder.start(100)

  return {
    stop: () =>
      new Promise((resolve) => {
        recorder.onstop = () => {
          stream.getTracks().forEach((t) => t.stop())
          resolve(new Blob(chunks, { type: 'audio/webm' }))
        }
        if (recorder.state !== 'inactive') recorder.stop()
      }),
  }
}

export async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const result = reader.result as string
      const commaIdx = result.indexOf(',')
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result)
    }
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

export async function transcribeWithOpenRouter(options: {
  apiKey: string
  model: string
  audioBase64: string
  format?: string
  signal?: AbortSignal
  ttsBaseUrl?: string
}): Promise<string> {
  const viaProxy = usesServerCloudProxy()
  const root = viaProxy
    ? `${normalizeBaseUrl(options.ttsBaseUrl || window.location.origin)}/api/openrouter/api/v1`
    : 'https://openrouter.ai/api/v1'
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (!viaProxy && options.apiKey.trim()) {
    headers.Authorization = `Bearer ${options.apiKey.trim()}`
  }
  const res = await fetch(`${root}/audio/transcriptions`, {
    method: 'POST',
    headers,
    signal: options.signal,
    body: JSON.stringify({
      model: options.model,
      input_audio: {
        data: options.audioBase64,
        format: options.format || 'webm',
      },
    }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`OpenRouter STT ${res.status}: ${text || res.statusText}`)
  }

  const data = (await res.json()) as { text?: string }
  return data.text || ''
}

/**
 * Decode a recorded audio blob (WebM/Opus) and resample it to a 16 kHz mono
 * PCM16 WAV, returned as base64. Whistle (cactus-needle) reads 16 kHz WAV
 * directly, so no server-side ffmpeg is needed.
 */
export async function encodeWav16k(blob: Blob): Promise<string> {
  const arrayBuf = await blob.arrayBuffer()
  const decodeCtx = new AudioContext()
  let decoded: AudioBuffer
  try {
    decoded = await decodeCtx.decodeAudioData(arrayBuf.slice(0))
  } finally {
    void decodeCtx.close()
  }

  const targetRate = 16000
  const frames = Math.max(1, Math.ceil(decoded.duration * targetRate))
  const offline = new OfflineAudioContext(1, frames, targetRate)
  const source = offline.createBufferSource()
  source.buffer = decoded
  source.connect(offline.destination)
  source.start(0)
  const rendered = await offline.startRendering()
  const samples = rendered.getChannelData(0)

  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i += 1) view.setUint8(offset + i, str.charCodeAt(i))
  }
  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, targetRate, true)
  view.setUint32(28, targetRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeStr(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  let offset = 44
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
    offset += 2
  }

  return blobToBase64(new Blob([view], { type: 'audio/wav' }))
}

/** Transcribe a 16 kHz mono WAV (base64) with the local Whistle STT backend. */
export async function transcribeWithWhistle(options: {
  audioBase64: string
  signal?: AbortSignal
  ttsBaseUrl?: string
}): Promise<string> {
  const root = normalizeBaseUrl(options.ttsBaseUrl || window.location.origin)
  const res = await fetch(`${root}/stt/transcribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: options.signal,
    body: JSON.stringify({ audio_base64: options.audioBase64, format: 'wav' }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Whistle STT ${res.status}: ${text || res.statusText}`)
  }

  const data = (await res.json()) as { text?: string }
  return data.text || ''
}
