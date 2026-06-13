import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type UIEvent as ReactUIEvent,
} from 'react'
import { dedupeNonEmpty } from '@/lib/chatHints'
import { isElectron } from '@/lib/platform'
import {
  extractMarkdownImageUrls,
  stripGeneratedAudioLinkArtifacts,
  stripGeneratedImageLinkArtifacts,
  stripRunwareAudioUrlLines,
} from '@/lib/runwareMessageMeta'
import type { VoidcastApp } from '@/hooks/useVoidcastApp'

type LocalImagePreview = {
  base64: string
  mime: string
}

type Props = Pick<
  VoidcastApp,
  | 'messages'
  | 'busy'
  | 'setError'
  | 'assistantGeneratedImages'
  | 'assistantSavedImagePaths'
  | 'assistantGeneratedAudios'
>

export function useChatMessageRender(app: Props) {
  const {
    messages,
    busy,
    setError,
    assistantGeneratedImages,
    assistantSavedImagePaths,
    assistantGeneratedAudios,
  } = app
  const listEndRef = useRef<HTMLDivElement | null>(null)
  const chatMessagesRef = useRef<HTMLElement | null>(null)
  const savedChatScrollRef = useRef(0)
  const thinkingScrollRef = useRef<HTMLDivElement | null>(null)
  const [thinkingPinned, setThinkingPinned] = useState(true)
  const [localImagePreviews, setLocalImagePreviews] = useState<Record<string, LocalImagePreview>>({})
  const localPreviewLoadingRef = useRef<Set<string>>(new Set())

  const desktopRuntime = isElectron()

  const downloadImage = useCallback(async (url: string) => {
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`Image download failed: HTTP ${res.status}`)
      const blob = await res.blob()
      const objUrl = URL.createObjectURL(blob)
      const fileFromUrl = (() => {
        try {
          const p = new URL(url).pathname.split('/').pop() || ''
          return p.trim()
        } catch {
          return ''
        }
      })()
      const safeName = fileFromUrl || `runware-${Date.now()}.jpg`
      const a = document.createElement('a')
      a.href = objUrl
      a.download = safeName
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(objUrl)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [setError])

  const openLocalImage = useCallback(async (filePath: string) => {
    try {
      const vc = window.voidcast?.openPath
      if (!vc) throw new Error('Open image is available only in Electron app.')
      const r: unknown = await vc(filePath)
      if (typeof r === 'string') return
      const obj = r as { ok?: boolean; text?: string }
      if (obj.ok === false) throw new Error(obj.text || 'Failed to open image.')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [setError])

  const onChatScroll = useCallback((e: ReactUIEvent<HTMLElement>) => {
    savedChatScrollRef.current = e.currentTarget.scrollTop
  }, [])

  const assistantRenderCache = useMemo(() => {
    const out: Record<
      string,
      {
        markdownContent: string
        inlineImageUrls: string[]
        localImagePaths: string[]
      }
    > = {}
    for (const m of messages) {
      if (m.role !== 'assistant') continue
      const trustedImageUrls = dedupeNonEmpty([
        ...(m.generatedImageUrls || []),
        ...(assistantGeneratedImages[m.id] || []),
      ])
      const trustedAudioUrls = dedupeNonEmpty([...(assistantGeneratedAudios[m.id] || [])])
      const markdownContent = desktopRuntime
        ? stripGeneratedAudioLinkArtifacts(
            stripGeneratedImageLinkArtifacts(m.content, trustedImageUrls),
            trustedAudioUrls,
          )
        : stripGeneratedAudioLinkArtifacts(
            stripGeneratedImageLinkArtifacts(
              stripRunwareAudioUrlLines(m.content),
              trustedImageUrls,
            ),
            trustedAudioUrls,
          )
      const markdownImageUrls = new Set(extractMarkdownImageUrls(m.content))
      const inlineImageUrls = trustedImageUrls.filter((u) => !markdownImageUrls.has(u))
      const localImagePaths = desktopRuntime
        ? dedupeNonEmpty([
            ...(m.generatedImagePaths || []),
            ...(assistantSavedImagePaths[m.id] || []),
          ])
        : []
      out[m.id] = { markdownContent, inlineImageUrls, localImagePaths }
    }
    return out
  }, [
    messages,
    assistantGeneratedImages,
    assistantGeneratedAudios,
    assistantSavedImagePaths,
    desktopRuntime,
  ])

  useEffect(() => {
    const readImageFile = window.voidcast?.readImageFile
    if (!desktopRuntime || !readImageFile) return
    const candidates = new Set<string>()
    for (const msg of messages) {
      if (msg.role !== 'assistant' || !msg.generatedImagePaths?.length) continue
      for (const p of msg.generatedImagePaths) {
        const path = (p || '').trim()
        if (path) candidates.add(path)
      }
    }
    for (const p of candidates) {
      if (localImagePreviews[p] || localPreviewLoadingRef.current.has(p)) continue
      localPreviewLoadingRef.current.add(p)
      void readImageFile({ path: p })
        .then((res) => {
          if (!res.ok || !res.file?.base64?.trim()) return
          setLocalImagePreviews((prev) => ({
            ...prev,
            [p]: {
              base64: res.file.base64.replace(/\s+/g, ''),
              mime: (res.file.mime || 'image/png').trim() || 'image/png',
            },
          }))
        })
        .finally(() => {
          localPreviewLoadingRef.current.delete(p)
        })
    }
  }, [desktopRuntime, localImagePreviews, messages])

  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  useEffect(() => {
    if (!busy) {
      listEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [busy])

  useEffect(() => {
    if (thinkingPinned && thinkingScrollRef.current) {
      thinkingScrollRef.current.scrollTop = thinkingScrollRef.current.scrollHeight
    }
  }, [messages, thinkingPinned])

  return {
    listEndRef,
    chatMessagesRef,
    onChatScroll,
    thinkingScrollRef,
    thinkingPinned,
    setThinkingPinned,
    assistantRenderCache,
    localImagePreviews,
    downloadImage,
    openLocalImage,
    desktopRuntime,
  }
}

export type ChatMessageRenderContext = ReturnType<typeof useChatMessageRender>
