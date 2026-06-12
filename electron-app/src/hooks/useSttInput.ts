import { useCallback, useRef, useState } from 'react'
import { blobToBase64, startRecording, transcribeWithOpenRouter } from '@/lib/stt'
import type { AppSettings } from '@/lib/settings'

export type UseSttInputParams = {
  settings: AppSettings
  busy: boolean
  setInput: React.Dispatch<React.SetStateAction<string>>
  setError: (error: string | null) => void
}

export type UseSttInputResult = {
  isRecording: boolean
  sttPending: boolean
  recordingDuration: number
  recorderRef: React.RefObject<{ stop: () => Promise<Blob> } | null>
  recordingTimerRef: React.RefObject<number | null>
  toggleSttRecording: () => Promise<void>
}

export function useSttInput({
  settings,
  busy,
  setInput,
  setError,
}: UseSttInputParams): UseSttInputResult {
  const [isRecording, setIsRecording] = useState(false)
  const [sttPending, setSttPending] = useState(false)
  const [recordingDuration, setRecordingDuration] = useState(0)
  const recorderRef = useRef<{ stop: () => Promise<Blob> } | null>(null)
  const recordingTimerRef = useRef<number | null>(null)

  const toggleSttRecording = useCallback(async () => {
    if (busy || sttPending) return
    if (isRecording) {
      setIsRecording(false)
      if (recordingTimerRef.current) {
        window.clearInterval(recordingTimerRef.current)
        recordingTimerRef.current = null
      }
      const blob = await recorderRef.current?.stop()
      recorderRef.current = null
      if (!blob || blob.size === 0) return
      setSttPending(true)
      try {
        const base64 = await blobToBase64(blob)
        const text = await transcribeWithOpenRouter({
          apiKey: settings.openrouterApiKey,
          model: settings.openrouterSttModel,
          audioBase64: base64,
          format: 'webm',
          ttsBaseUrl: settings.ttsBaseUrl,
        })
        if (text.trim()) {
          setInput((prev) => (prev ? prev + ' ' : '') + text.trim())
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setSttPending(false)
        setRecordingDuration(0)
      }
    } else {
      try {
        const recorder = await startRecording()
        recorderRef.current = recorder
        setIsRecording(true)
        setRecordingDuration(0)
        recordingTimerRef.current = window.setInterval(() => {
          setRecordingDuration((d) => d + 1)
        }, 1000)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    }
  }, [busy, isRecording, setError, setInput, settings, sttPending])

  return {
    isRecording,
    sttPending,
    recordingDuration,
    recorderRef,
    recordingTimerRef,
    toggleSttRecording,
  }
}
