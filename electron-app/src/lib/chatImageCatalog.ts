import type { UiMessage } from '@/types/chat'
import { imageCatalogId, imageCatalogKey } from '@/lib/imageVisionCache'
import { isElectron } from '@/lib/platform'

export type PendingChatImage = {
  base64: string
  mime: string
  name?: string
  path?: string
  /** Catalog source — used in index hints for image_recall / edit_image_runware. */
  kind?: 'attachment' | 'generated' | 'pending'
}

export function catalogItemKey(item: PendingChatImage): string {
  return imageCatalogKey(item)
}

/** Stable content/path-derived id (e.g. `img_1a2b3c4d`) for a catalog image. */
export function catalogItemId(item: PendingChatImage): string {
  return imageCatalogId(item)
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export async function fetchCatalogImageFromUrl(
  url: string,
  name?: string,
): Promise<PendingChatImage | null> {
  const u = url.trim()
  if (!u.startsWith('http://') && !u.startsWith('https://')) return null
  try {
    const res = await fetch(u, { signal: AbortSignal.timeout(20_000) })
    if (!res.ok) return null
    const mimeRaw = (res.headers.get('content-type') || 'image/png').split(';')[0].trim().toLowerCase()
    const mime = mimeRaw.startsWith('image/') ? mimeRaw : 'image/png'
    const buf = await res.arrayBuffer()
    if (buf.byteLength < 16) return null
    return {
      base64: arrayBufferToBase64(buf),
      mime,
      name: name?.trim() || u,
      kind: 'generated',
    }
  } catch {
    return null
  }
}

export async function pushAssistantGeneratedImages(
  chronological: PendingChatImage[],
  msg: UiMessage,
): Promise<void> {
  const readImageFile = window.voidcast?.readImageFile
  const paths = msg.generatedImagePaths || []
  const urls = msg.generatedImageUrls || []
  const urlKeysAdded = new Set<string>()

  if (isElectron() && readImageFile) {
    for (let j = 0; j < paths.length; j++) {
      const p = (paths[j] || '').trim()
      if (!p) continue
      try {
        const res = await readImageFile({ path: p })
        if (!res.ok || !res.file?.base64?.trim()) continue
        chronological.push({
          base64: res.file.base64.replace(/\s+/g, ''),
          mime: res.file.mime || 'image/png',
          name: res.file.name || urls[j],
          path: res.file.path || p,
          kind: 'generated',
        })
        const pairedUrl = (urls[j] || '').trim()
        if (pairedUrl) urlKeysAdded.add(pairedUrl)
      } catch {
        // Ignore unreadable files; keep catalog build best-effort.
      }
    }
  }

  for (let j = 0; j < urls.length; j++) {
    const url = (urls[j] || '').trim()
    if (!url || urlKeysAdded.has(url)) continue
    urlKeysAdded.add(url)
    const fetched = await fetchCatalogImageFromUrl(url, paths[j] || url)
    if (fetched) chronological.push(fetched)
  }
}

/** Keep the first occurrence of each image, preserving incoming (chronological) order. */
export function dedupeCatalogChronological(items: PendingChatImage[]): PendingChatImage[] {
  const seen = new Set<string>()
  const out: PendingChatImage[] = []
  for (const item of items) {
    const key = catalogItemKey(item)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

/**
 * History only (no current-message queue): stable chronological order, oldest→newest.
 * Index 1 is always the OLDEST image of the conversation and never renumbers —
 * newer images are appended at the end.
 */
export async function buildSessionImageCatalog(history: UiMessage[]): Promise<PendingChatImage[]> {
  const chronological: PendingChatImage[] = []

  for (const msg of history) {
    if (msg.role === 'user' && msg.images?.length) {
      for (let j = 0; j < msg.images.length; j++) {
        const base64 = (msg.images[j] || '').trim()
        if (!base64) continue
        chronological.push({
          base64,
          mime: (msg.imageMimes?.[j] || 'image/png').trim() || 'image/png',
          name: msg.imageNames?.[j],
          path: msg.imagePaths?.[j],
          kind: 'attachment',
        })
      }
    }
    if (msg.role === 'assistant') {
      await pushAssistantGeneratedImages(chronological, msg)
    }
  }

  return dedupeCatalogChronological(chronological)
}

/**
 * Tool catalog: stable chronological order (oldest→newest). History images keep
 * their index across turns; current-message attachments are the newest and are
 * appended at the END (highest indexes).
 */
export async function buildToolImageCatalog(
  history: UiMessage[],
  queued: PendingChatImage[],
): Promise<PendingChatImage[]> {
  const pendingInOrder = queued.map((q) => ({
    ...q,
    kind: 'pending' as const,
  }))
  const pendingKeys = new Set(pendingInOrder.map(catalogItemKey))
  const session = (await buildSessionImageCatalog(history)).filter(
    (item) => !pendingKeys.has(catalogItemKey(item)),
  )
  return [...session, ...pendingInOrder]
}
