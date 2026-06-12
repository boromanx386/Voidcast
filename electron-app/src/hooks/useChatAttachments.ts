import {
  useCallback,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent as ReactDragEvent,
  type RefObject,
} from 'react'
import {
  MAX_CHAT_IMAGES,
  MAX_IMAGE_BYTES,
  readImageFileAsBase64,
  splitChatAttachmentFiles,
} from '@/lib/imageAttachment'
import {
  extFromName,
  isSupportedChatFileName,
} from '@/lib/fileAttachment'
import { isWebStandalone } from '@/lib/platform'
import type { PendingChatImage } from '@/lib/chatImageCatalog'
import type { FileAttachmentSnapshot } from '@/types/chat'

type PendingChatFile = FileAttachmentSnapshot

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export type UseChatAttachmentsParams = {
  busy: boolean
  editingMessageId: string | null
  setError: (error: string | null) => void
}

export type UseChatAttachmentsResult = {
  pendingImages: PendingChatImage[]
  setPendingImages: React.Dispatch<React.SetStateAction<PendingChatImage[]>>
  pendingFiles: PendingChatFile[]
  setPendingFiles: React.Dispatch<React.SetStateAction<PendingChatFile[]>>
  isDragOver: boolean
  chatAttachmentInputRef: RefObject<HTMLInputElement | null>
  onChatDragEnter: (e: ReactDragEvent<HTMLDivElement>) => void
  onChatDragOver: (e: ReactDragEvent<HTMLDivElement>) => void
  onChatDragLeave: (e: ReactDragEvent<HTMLDivElement>) => void
  onChatDrop: (e: ReactDragEvent<HTMLDivElement>) => void
  processChatAttachmentFiles: (rawList: File[]) => Promise<void>
  onPickChatAttachments: (e: ChangeEvent<HTMLInputElement>) => Promise<void>
  openChatAttachmentPicker: () => Promise<void>
  removePendingImage: (index: number) => void
  removePendingFile: (index: number) => void
}

export function useChatAttachments({
  busy,
  editingMessageId,
  setError,
}: UseChatAttachmentsParams): UseChatAttachmentsResult {
  const [pendingImages, setPendingImages] = useState<PendingChatImage[]>([])
  const [pendingFiles, setPendingFiles] = useState<PendingChatFile[]>([])
  const [isDragOver, setIsDragOver] = useState(false)
  const dragCounterRef = useRef(0)
  const chatAttachmentInputRef = useRef<HTMLInputElement | null>(null)

  const removePendingImage = (index: number) => {
    setPendingImages((prev) => prev.filter((_, i) => i !== index))
  }

  const processChatAttachmentFiles = useCallback(async (rawList: File[]) => {
    if (rawList.length === 0) return
    const { imageFiles, nonImageFiles } = await splitChatAttachmentFiles(rawList)
    const newImages: PendingChatImage[] = []
    const newFiles: PendingChatFile[] = []

    for (const file of imageFiles) {
      if (file.size > MAX_IMAGE_BYTES) {
        setError(`Image too large (max ${Math.round(MAX_IMAGE_BYTES / (1024 * 1024))} MB): ${file.name || 'image'}`)
        continue
      }
      try {
        const { base64, mime } = await readImageFileAsBase64(file)
        if (!base64.trim()) {
          setError(`Could not read image: ${file.name || 'attachment'}`)
          continue
        }
        newImages.push({ base64, mime, name: file.name || 'image' })
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    }
    for (const file of nonImageFiles) {
      if (!isSupportedChatFileName(file.name)) {
        setError(`Unsupported file type: ${file.name}`)
        continue
      }
      const ext = extFromName(file.name)
      const isText =
        ext === 'txt' || ext === 'md' || ext === 'csv' || ext === 'json' ||
        ext === 'js' || ext === 'ts' || ext === 'py' || ext === 'java' ||
        ext === 'cs' || ext === 'html' || ext === 'css'
      let content: string | undefined
      let truncated = false
      if (isText) {
        const raw = await file.text()
        if (raw.length > 400 * 1024) {
          content = raw.slice(0, 400 * 1024)
          truncated = true
        } else {
          content = raw
        }
      }
      newFiles.push({
        id: uid(),
        name: file.name,
        path: file.name,
        mime: file.type || 'application/octet-stream',
        size: file.size,
        ext,
        content,
        truncated,
      })
    }

    if (newImages.length === 0 && newFiles.length === 0) {
      if (rawList.length > 0) {
        setError('Could not load attachment. On phone use Gallery and JPEG/PNG screenshots.')
      }
      return
    }
    setError(null)
    if (newImages.length > 0) {
      setPendingImages((prev) => {
        const merged = [...prev]
        for (const item of newImages) {
          if (merged.length >= MAX_CHAT_IMAGES) break
          merged.push(item)
        }
        return merged
      })
    }
    if (newFiles.length > 0) {
      setPendingFiles((prev) => [...prev, ...newFiles].slice(0, 8))
    }
  }, [setError])

  const onPickChatAttachments = async (e: ChangeEvent<HTMLInputElement>) => {
    const input = e.target
    const picked = input.files
    if (!picked || picked.length === 0) return
    const files: File[] = []
    for (let i = 0; i < picked.length; i++) {
      const f = picked[i]!
      const name = f.name?.trim() || `image-${Date.now()}.jpg`
      const type = f.type?.trim() || 'image/jpeg'
      try {
        const buf = await f.arrayBuffer()
        files.push(new File([buf], name, { type, lastModified: f.lastModified }))
      } catch {
        files.push(f)
      }
    }
    input.value = ''
    await processChatAttachmentFiles(files)
  }

  const dragContainsFiles = useCallback((e: ReactDragEvent<HTMLDivElement>) => {
    const types = e.dataTransfer?.types
    if (!types) return false
    for (let i = 0; i < types.length; i++) {
      if (types[i] === 'Files') return true
    }
    return false
  }, [])

  const onChatDragEnter = useCallback(
    (e: ReactDragEvent<HTMLDivElement>) => {
      if (busy || editingMessageId) return
      if (!dragContainsFiles(e)) return
      e.preventDefault()
      dragCounterRef.current += 1
      setIsDragOver(true)
    },
    [busy, editingMessageId, dragContainsFiles],
  )

  const onChatDragOver = useCallback(
    (e: ReactDragEvent<HTMLDivElement>) => {
      if (busy || editingMessageId) return
      if (!dragContainsFiles(e)) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    },
    [busy, editingMessageId, dragContainsFiles],
  )

  const onChatDragLeave = useCallback(
    (e: ReactDragEvent<HTMLDivElement>) => {
      if (!dragContainsFiles(e)) return
      e.preventDefault()
      dragCounterRef.current = Math.max(0, dragCounterRef.current - 1)
      if (dragCounterRef.current === 0) setIsDragOver(false)
    },
    [dragContainsFiles],
  )

  const onChatDrop = useCallback(
    async (e: ReactDragEvent<HTMLDivElement>) => {
      if (!dragContainsFiles(e)) return
      e.preventDefault()
      dragCounterRef.current = 0
      setIsDragOver(false)
      if (busy || editingMessageId) return
      const files = e.dataTransfer?.files
      if (!files?.length) return
      await processChatAttachmentFiles(Array.from(files))
    },
    [busy, editingMessageId, dragContainsFiles, processChatAttachmentFiles],
  )

  const removePendingFile = (index: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index))
  }

  const openChatAttachmentPicker = useCallback(async () => {
    if (busy) return
    const native = window.voidcast?.pickChatAttachments
    if (native) {
      try {
        const res = await native()
        if (!res.ok) {
          if ('error' in res && res.error) setError(res.error)
          return
        }
        if (res.images?.length) {
          const addedImages: PendingChatImage[] = res.images.map((f) => ({
            base64: f.base64.replace(/\s+/g, ''),
            mime: f.mime,
            name: f.name,
            path: f.path,
          }))
          setPendingImages((prev) => [...prev, ...addedImages].slice(0, MAX_CHAT_IMAGES))
        }
        if (res.files?.length) {
          const addedFiles: PendingChatFile[] = res.files.map((f) => ({
            id: uid(),
            name: f.name,
            path: f.path,
            mime: f.mime,
            size: f.size,
            ext: f.ext,
            content: f.content,
            truncated: f.truncated,
          }))
          setPendingFiles((prev) => [...prev, ...addedFiles].slice(0, 8))
        }
        setError(null)
        return
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    }
    if (!isWebStandalone()) {
      chatAttachmentInputRef.current?.click()
    }
  }, [busy, setError])

  return {
    pendingImages,
    setPendingImages,
    pendingFiles,
    setPendingFiles,
    isDragOver,
    chatAttachmentInputRef,
    onChatDragEnter,
    onChatDragOver,
    onChatDragLeave,
    onChatDrop,
    processChatAttachmentFiles,
    onPickChatAttachments,
    openChatAttachmentPicker,
    removePendingImage,
    removePendingFile,
  }
}
