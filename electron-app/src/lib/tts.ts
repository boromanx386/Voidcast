import { normalizeBaseUrl } from './settings'
import type { VoiceMode } from './settings'
import type { RunwareXaiVoice, TtsProvider } from './settings'
import type { StoredVoiceAnchor, VoiceAnchorSourceMode } from './voiceAnchorStorage'
import { isElectron } from './platform'

/** Electron/Chromium often mishandles Blob in FormData; JSON+base64 is reliable. */
function errorMessage(e: unknown): string {
  if (e instanceof Error && e.message.trim()) return e.message.trim()
  return String(e)
}

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

/** One-shot sample for auto/design (no ref_audio); result is stored as voice anchor. */
export async function bakeVoiceSample(options: {
  ttsBaseUrl: string
  sourceMode: VoiceAnchorSourceMode
  text: string
  instruct?: string
  speed?: number
  numStep?: number
  durationSec?: number | null
  signal?: AbortSignal
}): Promise<Blob> {
  const root = normalizeBaseUrl(options.ttsBaseUrl)
  const speed = options.speed ?? 1.0
  const numStep = options.numStep ?? 32
  const t = options.text.trim()
  if (!t) throw new Error('Bake phrase is empty')

  const payload: Record<string, unknown> = {
    text: t,
    instruct: null as string | null,
    speed,
    num_step: numStep,
  }
  if (options.sourceMode === 'design' && options.instruct?.trim()) {
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
    throw new Error(`TTS bake ${res.status}: ${errText || res.statusText}`)
  }
  return await res.blob()
}

export async function synthesizeSpeech(options: {
  ttsBaseUrl: string
  ttsProvider?: TtsProvider
  openrouterApiKey?: string
  openrouterTtsModel?: string
  openrouterTtsVoice?: string
  runwareApiBaseUrl?: string
  runwareApiKey?: string
  runwareXaiVoice?: RunwareXaiVoice
  runwareXaiLanguage?: string
  text: string
  voiceMode: VoiceMode
  instruct?: string
  speed?: number
  numStep?: number
  durationSec?: number | null
  cloneRef?: { blob: Blob; fileName?: string } | null
  cloneRefText?: string | null
  /** When set with auto/design, all chunks use clone path for timbre lock */
  voiceAnchor?: StoredVoiceAnchor | null
  signal?: AbortSignal
}): Promise<Blob> {
  if (options.ttsProvider === 'openrouter-tts') {
    const apiKey = (options.openrouterApiKey || '').trim()
    if (!apiKey) {
      throw new Error('OpenRouter API key is missing. Set it in Options -> General.')
    }
    const model =
      options.openrouterTtsModel?.trim() ||
      'openai/gpt-4o-mini-tts-2025-12-15'
    const root = 'https://openrouter.ai/api/v1'
    const payload: Record<string, unknown> = {
      model,
      input: options.text,
      response_format: 'mp3',
    }
    const voice = options.openrouterTtsVoice?.trim() || 'alloy'
    payload.voice = voice
    try {
      const res = await fetch(`${root}/audio/speech`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: options.signal,
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const errText = await res.text().catch(() => '')
        throw new Error(
          `OpenRouter TTS ${res.status}: ${errText || res.statusText}`,
        )
      }
      const blob = await res.blob()
      if (!blob || blob.size === 0) {
        throw new Error('OpenRouter TTS returned empty audio payload.')
      }
      const arr = await blob.arrayBuffer()
      return new Blob([arr], { type: 'audio/mpeg' })
    } catch (e) {
      throw new Error(errorMessage(e))
    }
  }

  if (options.ttsProvider === 'runware-xai') {
    const apiKey = (options.runwareApiKey || '').trim()
    if (!apiKey) {
      throw new Error('Runware API key is missing. Set it in Options -> General.')
    }
    const root = normalizeBaseUrl(options.runwareApiBaseUrl || 'https://api.runware.ai/v1')
    const taskUUID =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`
    const language = (options.runwareXaiLanguage || '').trim()
    const payload: Record<string, unknown> = {
      taskType: 'audioInference',
      taskUUID,
      model: 'xai:tts@0',
      outputType: 'base64Data',
      outputFormat: 'MP3',
      speech: {
        text: options.text,
        voice: options.runwareXaiVoice || 'auto',
        ...(language ? { language } : {}),
      },
    }
    const decodeRunwareAudioBody = (body: {
      data?: Array<{ audioBase64Data?: string; audioDataURI?: string }>
    }): Blob => {
      const first = Array.isArray(body.data) ? body.data[0] : undefined
      const base64Data = (first?.audioBase64Data || '').trim()
      if (base64Data) {
        const bytes = Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0))
        return new Blob([bytes], { type: 'audio/mpeg' })
      }
      const dataUri = (first?.audioDataURI || '').trim()
      if (dataUri.startsWith('data:')) {
        const commaIdx = dataUri.indexOf(',')
        const encoded = commaIdx >= 0 ? dataUri.slice(commaIdx + 1) : ''
        if (!encoded) throw new Error('Runware TTS returned empty audio payload.')
        const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))
        return new Blob([bytes], { type: 'audio/mpeg' })
      }
      throw new Error('Runware TTS returned no audio data.')
    }

    const parseErrorDetail = (
      body: { errors?: Array<{ message?: string }>; error?: string },
      status?: number,
    ) =>
      body.error ||
      body.errors?.[0]?.message ||
      (typeof status === 'number' ? `Runware TTS HTTP ${status}` : 'Runware TTS request failed')

    const postDirect = async (): Promise<Blob> => {
      const res = await fetch(root, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        signal: options.signal,
        body: JSON.stringify([payload]),
      })
      const body = (await res.json().catch(() => ({}))) as {
        data?: Array<{ audioBase64Data?: string; audioDataURI?: string }>
        errors?: Array<{ message?: string }>
        error?: string
      }
      if (!res.ok) throw new Error(parseErrorDetail(body, res.status))
      return decodeRunwareAudioBody(body)
    }

    const proxyRootRaw = (options.ttsBaseUrl || '').trim()
    const proxyRoot = proxyRootRaw ? normalizeBaseUrl(proxyRootRaw) : ''
    let proxyFailureMessage = ''
    const postViaProxy = async (): Promise<Blob> => {
      if (!proxyRoot) {
        throw new Error(
          'Runware proxy URL is missing. Open app from desktop TTS server address so requests can be forwarded server-side.',
        )
      }
      const proxyRes = await fetch(`${proxyRoot}/tools/runware_proxy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: options.signal,
        body: JSON.stringify({
          api_base_url: root,
          api_key: apiKey,
          tasks: [payload],
        }),
      })
      const proxyBody = (await proxyRes.json().catch(() => ({}))) as {
        ok?: boolean
        data?: {
          data?: Array<{ audioBase64Data?: string; audioDataURI?: string }>
          errors?: Array<{ message?: string }>
          error?: string
        }
        detail?: string
      }
      if (!proxyRes.ok || !proxyBody.ok || !proxyBody.data) {
        throw new Error(proxyBody.detail || `Runware proxy HTTP ${proxyRes.status}`)
      }
      return decodeRunwareAudioBody(proxyBody.data)
    }

    const postViaElectronProxy = async (): Promise<Blob> => {
      if (!isElectron() || !window.voidcast?.runwareProxy) {
        throw new Error('Electron Runware proxy is unavailable.')
      }
      const res = await window.voidcast.runwareProxy({
        api_base_url: root,
        api_key: apiKey,
        tasks: [payload],
      })
      if (!res.ok) throw new Error(res.detail || 'Electron Runware proxy failed')
      return decodeRunwareAudioBody((res.data || {}) as {
        data?: Array<{ audioBase64Data?: string; audioDataURI?: string }>
      })
    }

    if (isElectron() && window.voidcast?.runwareProxy) {
      try {
        return await postViaElectronProxy()
      } catch (e) {
        proxyFailureMessage = errorMessage(e)
      }
    }

    // Prefer local proxy whenever available (desktop and web). It avoids renderer-side
    // network/CORS/WAF edge-cases seen on some machines.
    if (proxyRoot) {
      try {
        return await postViaProxy()
      } catch (e) {
        proxyFailureMessage = errorMessage(e)
        // If proxy is unavailable, continue with direct request as fallback.
      }
    }
    try {
      return await postDirect()
    } catch (e) {
      const directMsg = errorMessage(e)
      if (proxyFailureMessage) {
        throw new Error(
          `Runware proxy failed: ${proxyFailureMessage}\nDirect Runware request failed: ${directMsg}`,
        )
      }
      const msg = e instanceof Error ? e.message.toLowerCase() : ''
      const looksNetwork = msg.includes('failed to fetch') || msg.includes('networkerror')
      if (!proxyRoot || !looksNetwork) throw e
      return postViaProxy()
    }
  }

  const root = normalizeBaseUrl(options.ttsBaseUrl)
  const speed = options.speed ?? 1.0
  const numStep = options.numStep ?? 32

  const useAnchor =
    (options.voiceMode === 'design') &&
    options.voiceAnchor?.blob &&
    options.voiceAnchor.blob.size > 0

  if (useAnchor && options.voiceAnchor) {
    const ref_audio_base64 = await blobToBase64(options.voiceAnchor.blob)
    const refText = options.voiceAnchor.refText.trim()
    const payload: Record<string, unknown> = {
      text: options.text,
      instruct: null,
      speed,
      num_step: numStep,
      ref_audio_base64,
      ref_text: refText || null,
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

export async function checkTtsHealth(options: {
  ttsBaseUrl: string
  ttsProvider?: TtsProvider
  openrouterApiKey?: string
  runwareApiKey?: string
}): Promise<{
  ok: boolean
  detail?: string
}> {
  if (options.ttsProvider === 'runware-xai') {
    const hasKey = Boolean((options.runwareApiKey || '').trim())
    return hasKey
      ? { ok: true }
      : { ok: false, detail: 'Runware API key missing' }
  }
  if (options.ttsProvider === 'openrouter-tts') {
    // For OpenRouter TTS we rely on API key presence; detailed network errors surface at call time.
    const hasKey = Boolean((options.openrouterApiKey || '').trim())
    return hasKey
      ? { ok: true }
      : { ok: false, detail: 'OpenRouter API key missing' }
  }
  try {
    const root = normalizeBaseUrl(options.ttsBaseUrl)
    const url = `${root}/health`
    console.log('[TTS] Health check URL:', url)
    const res = await fetch(url)
    console.log('[TTS] Health check response status:', res.status)
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` }
    const data = (await res.json()) as { ok?: boolean; error?: string }
    console.log('[TTS] Health check data:', data)
    return { ok: Boolean(data.ok), detail: data.error }
  } catch (e) {
    console.error('[TTS] Health check error:', e)
    return { ok: false, detail: e instanceof Error ? e.message : String(e) }
  }
}
