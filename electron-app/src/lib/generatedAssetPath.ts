/**
 * Pure path helpers for saving generated media into a coding project.
 * Shared by renderer validation + unit tests. Electron main mirrors the same rules.
 */

const WINDOWS_ABS_RE = /^[a-zA-Z]:[\\/]/
const UNC_RE = /^\\\\/
const FORBIDDEN_NAME_CHARS_RE = /[<>:"|?*\x00-\x1F]/

export const GENERATED_AUDIO_EXTENSIONS = ['.mp3', '.wav', '.flac', '.ogg', '.m4a'] as const

export type GeneratedAudioExtension = (typeof GENERATED_AUDIO_EXTENSIONS)[number]

export function normalizeSlashes(p: string): string {
  return p.replace(/\\/g, '/')
}

export function hasNul(s: string): boolean {
  return s.includes('\0')
}

/** True if input looks like an absolute Windows/Unix/UNC path. */
export function isAbsoluteFilesystemPath(input: string): boolean {
  const t = input.trim()
  if (!t) return false
  if (t.startsWith('/') || t.startsWith('\\')) return true
  if (WINDOWS_ABS_RE.test(t) || UNC_RE.test(t)) return true
  return false
}

export function extensionFromAudioMime(mime: string | undefined | null): GeneratedAudioExtension {
  const ct = (mime || '').toLowerCase()
  if (ct.includes('wav') || ct.includes('wave')) return '.wav'
  if (ct.includes('flac')) return '.flac'
  if (ct.includes('ogg')) return '.ogg'
  if (ct.includes('mp4') || ct.includes('m4a') || ct.includes('aac')) return '.m4a'
  return '.mp3'
}

export function sanitizeAudioBaseName(input: string): string {
  const clean = input
    .replace(FORBIDDEN_NAME_CHARS_RE, '_')
    .replace(/[\\/]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
  const withoutExt = clean.replace(/\.(mp3|wav|flac|ogg|m4a)$/i, '')
  return withoutExt || 'voidcast-tts'
}

/**
 * Validate a project-relative audio destination.
 * Returns normalized relative path using forward slashes, with a safe extension.
 */
export function validateProjectRelativeAudioPath(
  relativePath: string,
  opts?: { mime?: string; defaultExt?: GeneratedAudioExtension },
): { ok: true; relativePath: string; ext: GeneratedAudioExtension } | { ok: false; error: string } {
  const raw = (relativePath || '').trim()
  if (!raw) return { ok: false, error: 'output_path is empty.' }
  if (hasNul(raw)) return { ok: false, error: 'output_path contains invalid characters.' }
  if (isAbsoluteFilesystemPath(raw)) {
    return { ok: false, error: 'output_path must be project-relative (absolute paths are rejected).' }
  }

  const normalized = normalizeSlashes(raw).replace(/^(\.\/)+/, '')
  if (!normalized || normalized === '.') {
    return { ok: false, error: 'output_path must name a file inside the project.' }
  }
  const parts = normalized.split('/').filter((p) => p.length > 0)
  if (parts.some((p) => p === '..')) {
    return { ok: false, error: 'output_path must not contain "..".' }
  }
  if (parts.some((p) => p === '.')) {
    return { ok: false, error: 'output_path must not contain "." segments.' }
  }
  if (parts.some((p) => FORBIDDEN_NAME_CHARS_RE.test(p))) {
    return { ok: false, error: 'output_path contains invalid filename characters.' }
  }

  const last = parts[parts.length - 1] || ''
  const dot = last.lastIndexOf('.')
  let ext: GeneratedAudioExtension
  let fileBase: string
  if (dot > 0) {
    const given = last.slice(dot).toLowerCase()
    if (!(GENERATED_AUDIO_EXTENSIONS as readonly string[]).includes(given)) {
      return {
        ok: false,
        error: `Unsupported audio extension "${given}". Allowed: ${GENERATED_AUDIO_EXTENSIONS.join(', ')}`,
      }
    }
    ext = given as GeneratedAudioExtension
    fileBase = sanitizeAudioBaseName(last.slice(0, dot))
  } else {
    ext = opts?.defaultExt || extensionFromAudioMime(opts?.mime)
    fileBase = sanitizeAudioBaseName(last)
  }

  const dirParts = parts.slice(0, -1)
  const relative = [...dirParts, `${fileBase}${ext}`].join('/')
  return { ok: true, relativePath: relative, ext }
}

/**
 * Lexical check that `absoluteCandidate` stays under `projectRoot`.
 * Both paths should already be resolved (path.resolve style).
 */
export function isPathInsideRoot(projectRoot: string, absoluteCandidate: string): boolean {
  const root = normalizeSlashes(projectRoot).replace(/\/+$/, '').toLowerCase()
  const abs = normalizeSlashes(absoluteCandidate).replace(/\/+$/, '').toLowerCase()
  if (!root || !abs) return false
  if (abs === root) return false // must be a file inside, not the root itself
  return abs.startsWith(`${root}/`)
}
