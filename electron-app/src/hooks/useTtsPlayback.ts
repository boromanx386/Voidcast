import { useCallback, useEffect, useRef, useState, type ChangeEvent, type RefObject } from 'react'
import { bakeVoiceSample, checkTtsHealth, synthesizeSpeech } from '@/lib/tts'
import { splitIntoTtsChunks } from '@/lib/textChunks'
import type { AppSettings } from '@/lib/settings'
import { clearCloneRef, loadCloneRef, saveCloneRef } from '@/lib/cloneRefStorage'
import {
  clearVoiceAnchor,
  loadVoiceAnchor,
  saveVoiceAnchor,
  type StoredVoiceAnchor,
} from '@/lib/voiceAnchorStorage'
import { sanitizeForTts } from '@/lib/chatHints'
import { generateSpokenBrief, needsSpokenBrief } from '@/lib/spokenBrief'
import { subAgentConfigForRole } from '@/lib/settings'
import { subAgentKeysFromSettings } from '@/lib/subAgentKeys'
import type { UiMessage } from '@/types/chat'

export type UseTtsPlaybackParams = {
  settings: AppSettings
  /** Session id for the sub-agent keys (OpenCode Go session affinity) used by BRIEF. */
  runtimeKey: string
  setError: (error: string | null) => void
}

export type TtsReadOptions = {
  /** Read a short spoken brief from the coding sub-agent instead of the whole reply. */
  brief?: boolean
}

export type UseTtsPlaybackResult = {
  ttsOk: boolean | null
  playingId: string | null
  /** True while the current playback (or its brief generation) is a BRIEF read. */
  playingBrief: boolean
  audioUrl: string | null
  audioRef: RefObject<HTMLAudioElement | null>
  onRead: (msg: UiMessage, opts?: TtsReadOptions) => Promise<void>
  playBlobUrl: (url: string, signal: AbortSignal) => Promise<void>
  refreshTts: () => Promise<void>
  cloneRef: { blob: Blob; fileName: string } | null
  voiceAnchor: StoredVoiceAnchor | null
  onPickCloneFile: (e: ChangeEvent<HTMLInputElement>) => Promise<void>
  onClearClone: () => Promise<void>
  onBakeVoiceAnchor: () => Promise<void>
  onClearVoiceAnchor: () => Promise<void>
  abortTts: () => void
}

export function useTtsPlayback({
  settings,
  runtimeKey,
  setError,
}: UseTtsPlaybackParams): UseTtsPlaybackResult {
  const [ttsOk, setTtsOk] = useState<boolean | null>(null)
  const [playingId, setPlayingId] = useState<string | null>(null)
  const [playingBrief, setPlayingBrief] = useState(false)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [cloneRef, setCloneRef] = useState<{ blob: Blob; fileName: string } | null>(null)
  const [voiceAnchor, setVoiceAnchor] = useState<StoredVoiceAnchor | null>(null)

  const ttsAbortRef = useRef<AbortController | null>(null)
  const ttsRunIdRef = useRef(0)
  const ttsAudioCacheRef = useRef<Map<string, Blob>>(new Map())
  const ttsAudioCacheOrderRef = useRef<string[]>([])
  // Keyed by reply text: replaying a BRIEF must not cost another model call.
  const briefCacheRef = useRef<Map<string, string>>(new Map())
  const onReadRef = useRef<(msg: UiMessage, opts?: TtsReadOptions) => Promise<void>>(async () => {})
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const refreshTts = useCallback(async () => {
    if (settings.ttsProvider === 'none') {
      setTtsOk(false)
      return
    }
    console.log('[VOIDCAST] Checking TTS at:', settings.ttsBaseUrl)
    try {
      const h = await checkTtsHealth({
        ttsBaseUrl: settings.ttsBaseUrl,
        ttsProvider: settings.ttsProvider,
        openrouterApiKey: settings.openrouterApiKey,
        runwareApiKey: settings.runwareApiKey,
      })
      console.log('[VOIDCAST] TTS health result:', h)
      setTtsOk(h.ok)
    } catch (e) {
      console.error('[VOIDCAST] TTS health check failed:', e)
      setTtsOk(false)
    }
  }, [settings.ttsBaseUrl, settings.ttsProvider, settings.openrouterApiKey, settings.runwareApiKey])

  useEffect(() => {
    void refreshTts()
    // No health polling while TTS is disabled.
    if (settings.ttsProvider === 'none') return
    const t = window.setInterval(() => void refreshTts(), 15000)
    return () => window.clearInterval(t)
  }, [refreshTts, settings.ttsProvider])

  // Disabling TTS mid-playback must stop the audio element and invalidate the run.
  useEffect(() => {
    if (settings.ttsProvider !== 'none') return
    ttsAbortRef.current?.abort()
    ttsAbortRef.current = null
    ttsRunIdRef.current += 1
    audioRef.current?.pause()
    setPlayingId(null)
    setPlayingBrief(false)
  }, [settings.ttsProvider])

  useEffect(() => {
    void loadCloneRef().then((r) => {
      if (r) setCloneRef(r)
    })
  }, [])

  useEffect(() => {
    void loadVoiceAnchor().then((r) => {
      if (r) setVoiceAnchor(r)
    })
  }, [])

  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl)
    }
  }, [audioUrl])

  const playBlobUrl = (url: string, signal: AbortSignal): Promise<void> => {
    return new Promise((resolve, reject) => {
      const el = audioRef.current
      if (!el) {
        reject(new Error('Audio element is not ready'))
        return
      }
      const cleanup = () => signal.removeEventListener('abort', onAbort)
      const onAbort = () => {
        el.pause()
        el.removeAttribute('src')
        cleanup()
        resolve()
      }
      if (signal.aborted) {
        resolve()
        return
      }
      signal.addEventListener('abort', onAbort)
      el.onended = () => {
        cleanup()
        resolve()
      }
      el.onerror = () => {
        cleanup()
        reject(new Error('Audio playback failed'))
      }
      el.src = url
      void el.play().catch((e) => {
        cleanup()
        reject(e)
      })
    })
  }

  const resolveBrief = async (content: string, signal: AbortSignal): Promise<string | null> => {
    const english = settings.ttsBriefEnglish === true
    // The language is part of the key: toggling English must not replay the old brief.
    const cacheKey = `${english ? 'en' : 'same'}|${content}`
    const cached = briefCacheRef.current.get(cacheKey)
    if (cached) return cached
    try {
      const brief = await generateSpokenBrief({
        content,
        config: subAgentConfigForRole(settings.subAgent, 'coding'),
        keys: subAgentKeysFromSettings(settings, runtimeKey),
        signal,
        english,
      })
      if (!brief) return null
      briefCacheRef.current.set(cacheKey, brief)
      while (briefCacheRef.current.size > 64) {
        const oldest = briefCacheRef.current.keys().next().value
        if (oldest === undefined) break
        briefCacheRef.current.delete(oldest)
      }
      return brief
    } catch (e) {
      if (signal.aborted) return null
      // A failing text provider must not silence speech: fall back to the full reply.
      console.warn('[VOIDCAST] spoken brief failed, reading full reply:', e)
      return null
    }
  }

  const onRead = async (msg: UiMessage, opts?: TtsReadOptions) => {
    if (settings.ttsProvider === 'none') return
    if (msg.role !== 'assistant' || !msg.content.trim()) return
    let spoken = sanitizeForTts(msg.content)
    if (!spoken) return
    const ttsVoiceMode = settings.ttsProvider === 'local' ? settings.voiceMode : 'design'
    if (ttsVoiceMode === 'clone' && (!cloneRef?.blob || cloneRef.blob.size === 0)) {
      setError('VOICE_CLONE: Load reference audio in Settings → TTS/STT')
      return
    }
    ttsAbortRef.current?.abort()
    const ac = new AbortController()
    ttsRunIdRef.current += 1
    const runId = ttsRunIdRef.current
    ttsAbortRef.current = ac
    const signal = ac.signal

    setError(null)
    setPlayingId(msg.id)
    setPlayingBrief(opts?.brief === true)
    try {
      if (opts?.brief && needsSpokenBrief(msg.content)) {
        const brief = await resolveBrief(msg.content, signal)
        if (signal.aborted) return
        if (brief) spoken = brief
      }
      if (audioUrl) URL.revokeObjectURL(audioUrl)

      const maxC = Math.min(2000, Math.max(80, Math.round(settings.ttsChunkMaxChars) || 300))
      const chunks = splitIntoTtsChunks(spoken, maxC)
      const multi = chunks.length > 1
      const durationForChunk = multi ? null : settings.ttsDurationSec

      const cloneRefKey = cloneRef
        ? `${cloneRef.fileName || ''}:${cloneRef.blob.size}:${cloneRef.blob.type}`
        : 'none'
      const voiceAnchorKey = voiceAnchor
        ? `${voiceAnchor.refText}:${voiceAnchor.sourceMode}:${voiceAnchor.instructSnapshot || ''}:${voiceAnchor.blob.size}`
        : 'none'
      const baseCacheKey = [
        `provider=${settings.ttsProvider}`,
        `ttsBaseUrl=${settings.ttsBaseUrl}`,
        `runwareBase=${settings.runwareApiBaseUrl}`,
        `runwareModel=${settings.runwareTtsModel}`,
        `runwareVoice=${settings.runwareXaiVoice}`,
        `runwareLang=${settings.runwareXaiLanguage}`,
        `runwarePrompt=${settings.runwareXaiPositivePrompt}`,
        `runwareSpeed=${settings.runwareTtsSpeed}`,
        `voiceMode=${ttsVoiceMode}`,
        `instruct=${settings.voiceInstruct}`,
        `speed=${settings.ttsSpeed}`,
        `numStep=${settings.ttsNumStep}`,
        `duration=${durationForChunk == null ? 'null' : String(durationForChunk)}`,
        `cloneRef=${cloneRefKey}`,
        `cloneRefText=${settings.cloneRefText || ''}`,
        `voiceAnchor=${voiceAnchorKey}`,
      ].join('|')

      const synth = (text: string) => {
        const cacheKey = `${baseCacheKey}|text=${text}`
        const cached = ttsAudioCacheRef.current.get(cacheKey)
        if (cached) return Promise.resolve(cached)
        return synthesizeSpeech({
          ttsBaseUrl: settings.ttsBaseUrl,
          ttsProvider: settings.ttsProvider,
          openrouterApiKey: settings.openrouterApiKey,
          openrouterTtsModel: settings.openrouterTtsModel,
          openrouterTtsVoice: settings.openrouterTtsVoice,
          runwareApiBaseUrl: settings.runwareApiBaseUrl,
          runwareApiKey: settings.runwareApiKey,
          runwareTtsModel: settings.runwareTtsModel,
          runwareXaiVoice: settings.runwareXaiVoice,
          runwareXaiLanguage: settings.runwareXaiLanguage,
          runwarePositivePrompt: settings.runwareXaiPositivePrompt || undefined,
          runwareTtsSpeed: settings.runwareTtsSpeed,
          text,
          voiceMode: ttsVoiceMode,
          instruct: settings.voiceInstruct || undefined,
          speed: settings.ttsSpeed,
          numStep: settings.ttsNumStep,
          durationSec: durationForChunk,
          cloneRef: cloneRef ?? null,
          cloneRefText: settings.cloneRefText || null,
          voiceAnchor: voiceAnchor ?? null,
          signal,
        }).then((blob) => {
          ttsAudioCacheRef.current.set(cacheKey, blob)
          ttsAudioCacheOrderRef.current.push(cacheKey)
          const maxEntries = 64
          while (ttsAudioCacheOrderRef.current.length > maxEntries) {
            const oldest = ttsAudioCacheOrderRef.current.shift()
            if (!oldest) break
            ttsAudioCacheRef.current.delete(oldest)
          }
          return blob
        })
      }

      let pending = synth(chunks[0])
      for (let i = 0; i < chunks.length; i++) {
        let blob: Blob
        try {
          blob = await pending
        } catch (e) {
          if ((e as Error).name === 'AbortError' || signal.aborted) break
          throw e
        }
        if (signal.aborted) break
        if (i + 1 < chunks.length) pending = synth(chunks[i + 1])
        const url = URL.createObjectURL(blob)
        setAudioUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev)
          return url
        })
        try {
          await playBlobUrl(url, signal)
        } catch (e) {
          if (signal.aborted) break
          throw e
        }
        if (signal.aborted) break
      }
    } catch (e) {
      if (!signal.aborted) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (ttsAbortRef.current === ac) ttsAbortRef.current = null
      if (ttsRunIdRef.current === runId) {
        setPlayingId(null)
        setPlayingBrief(false)
      }
    }
  }

  onReadRef.current = onRead

  useEffect(() => {
    const bridge = window.voidcast
    if (!bridge) return
    return bridge.onClipboardTts((text) => {
      const t = String(text ?? '').trim()
      if (!t) return
      void onReadRef.current({ id: '_clipboard-tts', role: 'assistant', content: t })
    })
  }, [])

  const onPickCloneFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    const data = { blob: f, fileName: f.name }
    setCloneRef(data)
    try {
      await saveCloneRef(data)
    } catch {
      setError('Failed to save reference sample (IndexedDB)')
    }
  }

  const onClearClone = async () => {
    setCloneRef(null)
    try {
      await clearCloneRef()
    } catch {
      /* ignore */
    }
  }

  const onBakeVoiceAnchor = async () => {
    if (settings.ttsProvider !== 'local') {
      setError('VOICE_ANCHOR is available only with local OmniVoice TTS.')
      return
    }
    const mode = settings.voiceMode
    if (mode !== 'design') return
    const phrase = settings.voiceBakePhrase.trim()
    if (!phrase) {
      setError('VOICE_ANCHOR: Enter a short bake phrase first')
      return
    }
    setError(null)
    try {
      const blob = await bakeVoiceSample({
        ttsBaseUrl: settings.ttsBaseUrl,
        sourceMode: mode,
        text: phrase,
        instruct: settings.voiceInstruct || undefined,
        speed: settings.ttsSpeed,
        numStep: settings.ttsNumStep,
        durationSec: null,
      })
      const data: StoredVoiceAnchor = {
        blob,
        refText: phrase,
        sourceMode: mode,
        instructSnapshot: mode === 'design' ? settings.voiceInstruct.trim() : undefined,
      }
      await saveVoiceAnchor(data)
      setVoiceAnchor(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const onClearVoiceAnchor = async () => {
    setVoiceAnchor(null)
    try {
      await clearVoiceAnchor()
    } catch {
      /* ignore */
    }
  }

  const abortTts = useCallback(() => {
    ttsAbortRef.current?.abort()
  }, [])

  return {
    ttsOk,
    playingId,
    playingBrief,
    audioUrl,
    audioRef,
    onRead,
    playBlobUrl,
    refreshTts,
    cloneRef,
    voiceAnchor,
    onPickCloneFile,
    onClearClone,
    onBakeVoiceAnchor,
    onClearVoiceAnchor,
    abortTts,
  }
}
