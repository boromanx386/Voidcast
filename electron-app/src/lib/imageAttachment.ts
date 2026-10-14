import { isSupportedChatFileName } from '@/lib/fileAttachment'
import { isVisionSendableImageMime } from '@/lib/imageMime'

/** Max images per message (Ollama payload / UX). */
export const MAX_CHAT_IMAGES = 4

/** Per-file size limit before base64. */
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024

/**
 * Ollama vision prihvaća PNG, JPEG, WebP; ostalo (GIF, BMP, TIFF, …) često radi,
 * ali HEIC/RAW može ne proći na serveru — pokušaj export u JPEG/PNG ako ne radi.
 */
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|avif|tiff?|ico|heic|heif|svg)$/i

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

/**
 * Try decode as image (Android gallery files with empty MIME/name).
 * Known chat document extensions are never probed as images — drag/drop often
 * leaves `type` empty and the old data-URL fallback misclassified .txt/.pdf.
 */
export async function probeFileAsImage(file: File): Promise<boolean> {
  if (isSupportedChatFileName(file.name)) return false
  if (looksLikeImageFile(file)) return true
  if (file.size === 0 || file.size > MAX_IMAGE_BYTES) return false
  const t = file.type?.trim().toLowerCase() ?? ''
  if (t && !t.startsWith('image/') && t !== 'application/octet-stream') return false
  if (typeof createImageBitmap !== 'function') return false
  try {
    const bmp = await createImageBitmap(file)
    bmp.close()
    return true
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
 * Long edge to shrink to. Anthropic reduces anything larger to 1568 px (2576 px on the newer
 * high-resolution tier) before inference, so the extra pixels buy nothing but upload time.
 */
const MAX_IMAGE_EDGE = 2576

/** Below this the re-encode is skipped — the bytes are already cheap to send. */
const SHRINK_SKIP_BYTES = 1_500_000

/** A PNG above this is re-encoded as JPEG: past that size lossless costs more than it buys. */
const PNG_KEEP_BYTES = 3_500_000

/**
 * Shrink an image before upload: cap the long edge and re-encode, so a payload stops being tens
 * of megabytes of pixels the provider throws away anyway.
 *
 * PNG stays PNG when the source may have an alpha channel and when the result is still small —
 * text and UI screenshots keep their crispness. Everything else becomes JPEG, drawn onto white
 * first because a transparent image flattened straight to JPEG paints its transparency black.
 * Returns the input untouched when the image is already small, or when it cannot be decoded
 * (HEIC, SVG) — the send path turns those into a clear "convert it" error.
 *
 * Shared by the `File` attachments and by the base64 payloads read out of the coding project.
 */
async function shrinkImageBlob(
  blob: Blob,
  declaredMime: string,
): Promise<{ blob: Blob; mime: string }> {
  const declared = (declaredMime || '').trim().toLowerCase()
  const original = { blob, mime: declared || 'image/png' }
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') {
    return original
  }
  // Formats the vision APIs refuse (BMP, TIFF, AVIF, HEIC, SVG) are transcoded even when they are
  // already small — re-encoding is the only way to keep them usable, since every send path rejects
  // the declared type before it reaches a provider.
  const needsTranscode = !isVisionSendableImageMime(original.mime)
  let bmp: ImageBitmap
  try {
    bmp = await createImageBitmap(blob)
  } catch {
    return original
  }
  try {
    const longEdge = Math.max(bmp.width, bmp.height)
    if (!needsTranscode && longEdge <= MAX_IMAGE_EDGE && blob.size <= SHRINK_SKIP_BYTES) {
      return original
    }
    const scale = longEdge > MAX_IMAGE_EDGE ? MAX_IMAGE_EDGE / longEdge : 1
    const w = Math.max(1, Math.round(bmp.width * scale))
    const h = Math.max(1, Math.round(bmp.height * scale))
    const canvas = new OffscreenCanvas(w, h)
    const ctx = canvas.getContext('2d')
    if (!ctx) return original
    ctx.drawImage(bmp, 0, 0, w, h)
    const png = await canvas.convertToBlob({ type: 'image/png' })
    // Graphics sources (screenshots, icons, diagrams) stay lossless within the size budget: JPEG
    // ringing around thin glyphs is exactly what makes a screen text unreadable for a model.
    const losslessSource = /png|webp|gif|bmp|tiff|x-icon|svg/.test(original.mime)
    if (losslessSource && png.size <= PNG_KEEP_BYTES) return { blob: png, mime: 'image/png' }
    const flat = new OffscreenCanvas(w, h)
    const fctx = flat.getContext('2d')
    if (!fctx) return { blob: png, mime: 'image/png' }
    fctx.fillStyle = '#ffffff'
    fctx.fillRect(0, 0, w, h)
    const sprite = await createImageBitmap(png)
    try {
      fctx.drawImage(sprite, 0, 0)
    } finally {
      sprite.close()
    }
    const jpeg = await flat.convertToBlob({ type: 'image/jpeg', quality: 0.88 })
    if (jpeg.size > 0 && (needsTranscode || jpeg.size < png.size)) {
      // Re-encoding a photo that needed no resize can grow it — keep the original bytes then.
      if (!needsTranscode && longEdge <= MAX_IMAGE_EDGE && jpeg.size >= blob.size) return original
      return { blob: jpeg, mime: 'image/jpeg' }
    }
    return { blob: png, mime: 'image/png' }
  } catch {
    return original
  } finally {
    bmp.close()
  }
}

export function prepareImageForUpload(file: File): Promise<{ blob: Blob; mime: string }> {
  return shrinkImageBlob(file, file.type)
}

/**
 * The same shrink pass for a payload that arrives already encoded — project files come back from
 * the main process as base64, not as a `File`. Falls through with the input untouched when the
 * browser cannot decode the format, or when the bytes are already small enough.
 */
export async function prepareBase64ImageForUpload(
  base64: string,
  mime: string,
): Promise<{ base64: string; mime: string }> {
  const clean = base64.replace(/\s+/g, '')
  const declared = (mime || '').trim().toLowerCase() || 'image/png'
  let blob: Blob
  try {
    blob = base64ToBlob(clean, declared)
  } catch {
    return { base64: clean, mime: declared }
  }
  const prepared = await shrinkImageBlob(blob, declared)
  // Same object back means the shrink was skipped: hand back the caller's exact bytes.
  if (prepared.blob === blob) return { base64: clean, mime: declared }
  return readBlobAsBase64(prepared.blob, prepared.mime)
}

/** `atob` → bytes → Blob. Payloads here are a few MB at most, so the byte loop is fine. */
function base64ToBlob(base64: string, mime: string): Blob {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

/**
 * Read an image attachment as raw base64, after `prepareImageForUpload` has capped its size.
 * Ollama `/api/chat` `images` expects **only** that base64 string (no `data:` prefix, no newlines).
 */
export async function readImageFileAsBase64(file: File): Promise<{
  base64: string
  mime: string
}> {
  const prepared = await prepareImageForUpload(file)
  return readBlobAsBase64(prepared.blob, prepared.mime)
}

function readBlobAsBase64(
  blob: Blob,
  fallbackMime: string,
): Promise<{ base64: string; mime: string }> {
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
      // A typeless blob is labelled `application/octet-stream` by the reader, and the old code
      // took that label as the MIME type. Only an image/* label — i.e. the bytes we just encoded —
      // is worth anything here.
      const uriMime =
        comma >= 0 && s.startsWith('data:')
          ? s.slice(5, comma).split(';')[0].trim().toLowerCase()
          : ''
      const blobMime = (blob.type || '').trim().toLowerCase()
      const mime =
        (uriMime.startsWith('image/') ? uriMime : '') ||
        (blobMime.startsWith('image/') ? blobMime : '') ||
        fallbackMime ||
        'image/png'
      resolve({ base64: raw, mime })
    }
    reader.onerror = () => reject(reader.error ?? new Error('Read failed'))
    reader.readAsDataURL(blob)
  })
}

export function imageDataUrl(base64: string, mime: string): string {
  return `data:${mime};base64,${base64}`
}
