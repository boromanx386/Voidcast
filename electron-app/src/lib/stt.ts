import { usesServerCloudProxy } from '@/lib/platform'
import { normalizeBaseUrl } from '@/lib/settings'

export type SttProvider = 'none' | 'openrouter'

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
