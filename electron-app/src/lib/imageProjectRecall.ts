/** Vision recall for PNG/JPEG/WebP/GIF/BMP inside the configured coding project folder. */

const IMAGE_RECALL_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'])
const MAX_PROJECT_IMAGE_BYTES = 8 * 1024 * 1024

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

export function resolveCodingProjectImagePath(projectRoot: string, inputPath: string): string | null {
  const abs = resolveInsideCodingProject(projectRoot, inputPath)
  if (!abs || !isImageRecallExtension(abs)) return null
  return abs
}

export async function readCodingProjectImageForRecall(
  absPath: string,
): Promise<{ mime: string; base64: string } | null> {
  const fn = window.voidcast?.readImageFile
  if (!fn) return null
  try {
    const res = await fn({ path: absPath })
    if (!res.ok || !res.file?.base64?.trim()) return null
    const base64 = res.file.base64.replace(/\s+/g, '')
    const bytes = Math.ceil((base64.length * 3) / 4)
    if (bytes > MAX_PROJECT_IMAGE_BYTES) return null
    const mime = (res.file.mime || mimeFromImagePath(absPath)).trim().toLowerCase()
    return {
      mime: /^image\/[a-z0-9.+-]+$/.test(mime) ? mime : mimeFromImagePath(absPath),
      base64,
    }
  } catch {
    return null
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
    if (!loaded) {
      errors.push(`could not read project image: ${abs}`)
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
