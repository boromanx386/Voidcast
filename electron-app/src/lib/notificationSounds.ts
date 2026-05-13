import {
  loadNotificationSound,
  type NotificationSoundKind,
} from '@/lib/notificationSoundStorage'

/** Hard upper limit per sound file. Notification sounds should be short. */
export const MAX_NOTIFICATION_SOUND_BYTES = 2 * 1024 * 1024

const NOTIFICATION_SOUND_EXT_RE = /\.(mp3|wav|ogg|m4a|aac|flac|webm)$/i

/** Cache of blob URLs by kind so we don't recreate them on every play. */
const blobUrlCache: Partial<Record<NotificationSoundKind, string>> = {}

export function looksLikeAudioFile(file: File): boolean {
  const t = file.type?.trim() ?? ''
  if (t.startsWith('audio/')) return true
  if (!t && file.name && NOTIFICATION_SOUND_EXT_RE.test(file.name)) return true
  return false
}

export function notificationSoundAcceptList(): string {
  return 'audio/*,.mp3,.wav,.ogg,.m4a,.aac,.flac,.webm'
}

/**
 * Drop the cached blob URL for `kind` (call after the user picks a new file or
 * clears the slot, so the next `playNotificationSound` re-reads from IDB).
 */
export function invalidateNotificationSoundCache(kind: NotificationSoundKind): void {
  const prev = blobUrlCache[kind]
  if (prev) {
    try {
      URL.revokeObjectURL(prev)
    } catch {
      // ignore
    }
    delete blobUrlCache[kind]
  }
}

async function getOrCreateBlobUrl(
  kind: NotificationSoundKind,
): Promise<string | null> {
  const cached = blobUrlCache[kind]
  if (cached) return cached
  const stored = await loadNotificationSound(kind)
  if (!stored?.blob) return null
  const url = URL.createObjectURL(stored.blob)
  blobUrlCache[kind] = url
  return url
}

/**
 * Play the selected notification sound. Silently no-ops if no file is configured
 * for the given `kind`, autoplay is blocked, or playback fails.
 */
export async function playNotificationSound(
  kind: NotificationSoundKind,
  opts?: { volume?: number },
): Promise<void> {
  if (typeof window === 'undefined' || typeof Audio === 'undefined') return
  let url: string | null
  try {
    url = await getOrCreateBlobUrl(kind)
  } catch {
    return
  }
  if (!url) return
  try {
    const audio = new Audio(url)
    const v = opts?.volume
    audio.volume = typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1
    const playRes = audio.play()
    if (playRes && typeof playRes.catch === 'function') {
      playRes.catch(() => {
        /* autoplay blocked or audio device error — ignore */
      })
    }
  } catch {
    /* ignore */
  }
}

/**
 * Read a File to a Blob ready for IndexedDB. We re-wrap it so the stored MIME
 * is always set even when Windows returns an empty `file.type`.
 */
export async function notificationSoundFromFile(file: File): Promise<{
  blob: Blob
  fileName: string
  mime: string
}> {
  const buf = await file.arrayBuffer()
  const mime = (file.type || '').trim() || 'audio/mpeg'
  return {
    blob: new Blob([buf], { type: mime }),
    fileName: file.name,
    mime,
  }
}
