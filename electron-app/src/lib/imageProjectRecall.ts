/** Vision recall for PNG/JPEG/WebP/GIF/BMP inside the configured coding project folder. */

import { prepareBase64ImageForUpload } from './imageAttachment'

const IMAGE_RECALL_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'])

/**
 * Cap the **base64 string**, not the decoded byte count. Providers limit the encoded size
 * (Anthropic rejects a single image above 10 MB of base64), so an 8 MB file — ~10.9 MB once
 * encoded — would 400 on the request. 8 MB of base64 is ~6 MB of pixels: still generous and
 * safely under every provider limit.
 */
const MAX_PROJECT_IMAGE_B64_CHARS = 8 * 1024 * 1024

export type ProjectRecalledImage = {
  index: number
  mime: string
  base64: string
  path: string
}

function normalizeSlashes(p: string): string {
  return p.trim().replace(/\\/g, '/')
}

function extFromPath(filePath: string): string {
  const base = normalizeSlashes(filePath).split('/').pop() || ''
  const dot = base.lastIndexOf('.')
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : ''
}

function mimeFromImagePath(filePath: string): string {
  switch (extFromPath(filePath)) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'gif':
      return 'image/gif'
    case 'webp':
      return 'image/webp'
    case 'bmp':
      return 'image/bmp'
    default:
      return 'image/png'
  }
}

function isImageRecallExtension(filePath: string): boolean {
  return IMAGE_RECALL_EXTENSIONS.has(extFromPath(filePath))
}

/** Resolve a relative or absolute path to an absolute path inside projectRoot, or null if outside. */
export function resolveInsideCodingProject(projectRoot: string, inputPath: string): string | null {
  const root = normalizeSlashes(projectRoot).replace(/\/+$/, '')
  if (!root) return null
  const raw = normalizeSlashes(inputPath.trim() || '.')
  if (!raw) return null
  let abs: string
  if (/^[a-zA-Z]:\//.test(raw) || raw.startsWith('/')) {
    abs = raw
  } else {
    abs = `${root}/${raw.replace(/^\.?\//, '')}`
  }
  const rootLower = root.toLowerCase()
  const absLower = abs.toLowerCase()
  if (absLower !== rootLower && !absLower.startsWith(`${rootLower}/`)) return null
  const rel = abs.slice(root.length).replace(/^\//, '')
  if (/(^|\/)\.\.(\/|$)/.test(rel)) return null
  return abs
}

export function resolveCodingProjectImagePath(
  projectRoot: string,
  inputPath: string,
): string | null {
  const abs = resolveInsideCodingProject(projectRoot, inputPath)
  if (!abs || !isImageRecallExtension(abs)) return null
  return abs
}

export type ProjectImageReadResult =
  { ok: true; mime: string; base64: string } | { ok: false; reason: 'unreadable' | 'too-large' }

export async function readCodingProjectImageForRecall(
  absPath: string,
): Promise<ProjectImageReadResult> {
  const fn = window.voidcast?.readImageFile
  if (!fn) return { ok: false, reason: 'unreadable' }
  try {
    const res = await fn({ path: absPath })
    if (!res.ok || !res.file?.base64?.trim()) return { ok: false, reason: 'unreadable' }
    const declared = (res.file.mime || mimeFromImagePath(absPath)).trim().toLowerCase()
    const mime = /^image\/[a-z0-9.+-]+$/.test(declared) ? declared : mimeFromImagePath(absPath)
    // Shrink before the size check, not after: a 12 MP phone photo or a 4K screenshot is exactly
    // what the cap used to reject, while the provider would have downscaled it server-side anyway.
    // The cap then only guards the formats the browser cannot re-encode (TIFF, HEIC).
    const prepared = await prepareBase64ImageForUpload(res.file.base64, mime)
    if (prepared.base64.length > MAX_PROJECT_IMAGE_B64_CHARS) {
      return { ok: false, reason: 'too-large' }
    }
    return { ok: true, mime: prepared.mime, base64: prepared.base64 }
  } catch {
    return { ok: false, reason: 'unreadable' }
  }
}

export async function loadProjectImageRecalls(
  projectRoot: string,
  paths: string[],
): Promise<{ recalled: ProjectRecalledImage[]; errors: string[] }> {
  const recalled: ProjectRecalledImage[] = []
  const errors: string[] = []
  const seen = new Set<string>()
  for (const raw of paths) {
    const key = normalizeSlashes(raw).toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    const abs = resolveCodingProjectImagePath(projectRoot, raw)
    if (!abs) {
      errors.push(`path not in coding project or not a supported image: ${raw}`)
      continue
    }
    const loaded = await readCodingProjectImageForRecall(abs)
    if (!loaded.ok) {
      errors.push(
        loaded.reason === 'too-large'
          ? `project image still over the ${MAX_PROJECT_IMAGE_B64_CHARS / (1024 * 1024)} MB base64 limit after downscaling (unsupported format?): ${abs}`
          : `could not read project image: ${abs}`,
      )
      continue
    }
    recalled.push({
      index: 0,
      mime: loaded.mime,
      base64: loaded.base64,
      path: abs,
    })
  }
  return { recalled, errors }
}
