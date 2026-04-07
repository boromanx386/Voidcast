import { normalizeBaseUrl } from './settings'
import type { VoiceMode } from './settings'

/** Electron/Chromium often mishandles Blob in FormData; JSON+base64 is reliable. */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => {
      const s = r.result as string
      const i = s.indexOf(',')
      resolve(i >= 0 ? s.slice(i + 1) : s)
    }
    r.onerror = () => reject(r.error ?? new Error('FileReader failed'))
    r.readAsDataURL(blob)
  })
}

export async function synthesizeSpeech(options: {
  ttsBaseUrl: string
  text: string
  voiceMode: VoiceMode
  instruct?: string
  speed?: number
  numStep?: number
  durationSec?: number | null
  cloneRef?: { blob: Blob; fileName?: string } | null
  cloneRefText?: string | null
  signal?: AbortSignal
}): Promise<Blob> {
  const root = normalizeBaseUrl(options.ttsBaseUrl)
  const speed = options.speed ?? 1.0
  const numStep = options.numStep ?? 32

  if (
    options.voiceMode === 'clone' &&
    options.cloneRef?.blob &&
    options.cloneRef.blob.size > 0
  ) {
    const ref_audio_base64 = await blobToBase64(options.cloneRef.blob)
    const payload: Record<string, unknown> = {
      text: options.text,
      instruct: null,
      speed,
      num_step: numStep,
      ref_audio_base64,
      ref_text: options.cloneRefText?.trim() || null,
    }
    if (
      options.durationSec != null &&
      Number.isFinite(options.durationSec) &&
      options.durationSec > 0
    ) {
      payload.duration = options.durationSec
    }

    const res = await fetch(`${root}/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: options.signal,
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      throw new Error(`TTS clone ${res.status}: ${errText || res.statusText}`)
    }
    return await res.blob()
  }

  const payload: Record<string, unknown> = {
    text: options.text,
    instruct: null as string | null,
    speed,
    num_step: numStep,
  }
  if (options.voiceMode === 'design' && options.instruct?.trim()) {
    payload.instruct = options.instruct.trim()
  }
  if (
    options.durationSec != null &&
    Number.isFinite(options.durationSec) &&
    options.durationSec > 0
  ) {
    payload.duration = options.durationSec
  }

  const res = await fetch(`${root}/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: options.signal,
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`TTS ${res.status}: ${errText || res.statusText}`)
  }
  return await res.blob()
}

export async function checkTtsHealth(ttsBaseUrl: string): Promise<{
  ok: boolean
  detail?: string
}> {
  try {
    const root = normalizeBaseUrl(ttsBaseUrl)
    const res = await fetch(`${root}/health`)
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` }
    const data = (await res.json()) as { ok?: boolean; error?: string }
    return { ok: Boolean(data.ok), detail: data.error }
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) }
  }
}
