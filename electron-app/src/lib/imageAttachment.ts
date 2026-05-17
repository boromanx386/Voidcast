/** Max images per message (Ollama payload / UX). */
export const MAX_CHAT_IMAGES = 4

/** Per-file size limit before base64. */
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024

/**
 * Ollama vision prihvaća PNG, JPEG, WebP; ostalo (GIF, BMP, TIFF, …) često radi,
 * ali HEIC/RAW može ne proći na serveru — pokušaj export u JPEG/PNG ako ne radi.
 */
const IMAGE_EXT =
  /\.(png|jpe?g|gif|webp|bmp|avif|tiff?|ico|heic|heif|svg)$/i

/** Android gallery / screenshots often ship with empty `type` or odd names — use in accept + probe. */
export const CHAT_IMAGE_ACCEPT = 'image/*,.png,.jpg,.jpeg,.webp,.gif,.bmp,.heic,.heif'

/**
 * Windows često ostavi `file.type` prazan nakon "Save as" ili nekih alata — bez ovoga
 * picker učuti odbaci sve fajlove i korisnik ne vidi niti thumbnail.
 */
export function looksLikeImageFile(file: File): boolean {
  const t = file.type?.trim().toLowerCase() ?? ''
  if (t.startsWith('image/')) return true
  const name = file.name?.trim() ?? ''
  if (name && IMAGE_EXT.test(name)) return true
  // Screenshot_* without extension on some Android builds
  if (!t && /^screenshot/i.test(name)) return true
  return false
}

/** Try decode as image (Android gallery files with empty MIME/name). */
export async function probeFileAsImage(file: File): Promise<boolean> {
  if (looksLikeImageFile(file)) return true
  if (file.size === 0 || file.size > MAX_IMAGE_BYTES) return false
  const t = file.type?.trim().toLowerCase() ?? ''
  if (t && !t.startsWith('image/') && t !== 'application/octet-stream') return false
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file)
      bmp.close()
      return true
    } catch {
      // fall through to data URL probe
    }
  }
  try {
    const { base64 } = await readImageFileAsBase64(file)
    return base64.length > 64
  } catch {
    return false
  }
}

export async function splitChatAttachmentFiles(
  rawList: File[],
): Promise<{ imageFiles: File[]; nonImageFiles: File[] }> {
  const imageFiles: File[] = []
  const nonImageFiles: File[] = []
  for (const file of rawList) {
    if (await probeFileAsImage(file)) imageFiles.push(file)
    else nonImageFiles.push(file)
  }
  return { imageFiles, nonImageFiles }
}

/**
 * Read PNG / JPEG / WebP / … via `readAsDataURL`, then split off the raw base64 payload.
 * Ollama `/api/chat` `images` expects **only** that raw base64 string (no `data:` prefix, no newlines).
 */
export function readImageFileAsBase64(file: File): Promise<{
  base64: string
  mime: string
}> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const s = reader.result
      if (typeof s !== 'string') {
        reject(new Error('Could not read image'))
        return
      }
      const comma = s.indexOf(',')
      const raw = (comma >= 0 ? s.slice(comma + 1) : s).replace(/\s+/g, '')
      const mime =
        file.type?.trim() ||
        (comma >= 0 && s.startsWith('data:') ? s.slice(5, comma) : '') ||
        'image/png'
      resolve({ base64: raw, mime })
    }
    reader.onerror = () => reject(reader.error ?? new Error('Read failed'))
    reader.readAsDataURL(file)
  })
}

export function imageDataUrl(base64: string, mime: string): string {
  return `data:${mime};base64,${base64}`
}
