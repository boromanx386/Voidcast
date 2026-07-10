import { resolveInsideCodingProject } from '@/lib/imageProjectRecall'

const PREVIEW_IMAGE_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'svg',
  'ico',
  'avif',
])

export const MAX_CODING_PREVIEW_IMAGE_BYTES = 8 * 1024 * 1024

function extFromPath(filePath: string): string {
  const base = filePath.replace(/\\/g, '/').split('/').pop() || ''
  const dot = base.lastIndexOf('.')
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : ''
}

export function isCodingPreviewImage(filePath: string): boolean {
  return PREVIEW_IMAGE_EXTENSIONS.has(extFromPath(filePath))
}

export async function loadCodingPreviewImage(
  projectRoot: string,
  relativePath: string,
): Promise<{ ok: true; dataUrl: string } | { ok: false; error: string }> {
  const abs = resolveInsideCodingProject(projectRoot, relativePath)
  if (!abs) {
    return { ok: false, error: 'Image path is outside the coding project.' }
  }

  const fn = window.voidcast?.readImageFile
  if (!fn) {
    return { ok: false, error: 'Image preview is only available in the desktop app.' }
  }

  try {
    const res = await fn({ path: abs })
    if (!res.ok) {
      return { ok: false, error: res.error || 'Could not read image file.' }
    }
    if (!res.file?.base64?.trim()) {
      return { ok: false, error: 'Could not read image file.' }
    }

    const base64 = res.file.base64.replace(/\s+/g, '')
    const bytes = Math.ceil((base64.length * 3) / 4)
    if (bytes > MAX_CODING_PREVIEW_IMAGE_BYTES) {
      const mb = Math.round(bytes / 1024 / 1024)
      return { ok: false, error: `Image too large to preview (${mb} MB, max 8 MB).` }
    }

    const mime = (res.file.mime || 'image/png').trim().toLowerCase()
    const safeMime = /^image\/[a-z0-9.+-]+$/.test(mime) ? mime : 'image/png'
    return { ok: true, dataUrl: `data:${safeMime};base64,${base64}` }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
