/**
 * Image MIME sniffing for raw base64 payloads.
 *
 * Attachments and generated images arrive as bare base64 with no media type attached,
 * so the type has to be read off the magic prefix. Declaring the wrong type makes
 * strict providers reject the request outright — Anthropic's /messages endpoint returns
 * a 400 when a payload labelled `image/png` is actually WebP.
 *
 * Leaf module: no imports, safe to pull in from anywhere.
 */

/**
 * Sniff the image MIME type from the base64 magic prefix.
 * Returns null when the payload matches no known image magic, so callers can choose
 * between a declared type and the PNG fallback themselves.
 */
export function sniffImageMimeOrNull(base64: string): string | null {
  const clean = base64.replace(/\s+/g, '')
  if (clean.startsWith('iVBORw0KGgo')) return 'image/png'
  if (clean.startsWith('/9j/')) return 'image/jpeg'
  if (clean.startsWith('R0lGOD')) return 'image/gif'
  // RIFF container: chars 0-4 ("UklGR") encode "RIFF"; the second "F" is fixed, so this is
  // deterministic regardless of the file size that follows. Bytes 10-12 are "EBP" (of "WEBP"),
  // which encode to "RUJQ" at chars 12-15 — that distinguishes WebP from other RIFF files.
  if (clean.startsWith('UklGR') && clean.slice(12, 16) === 'RUJQ') return 'image/webp'
  return null
}

/** Sniff the image MIME type from the base64 magic prefix. Falls back to PNG. */
export function sniffImageMime(base64: string): string {
  return sniffImageMimeOrNull(base64) ?? 'image/png'
}

/**
 * Turn a raw base64 payload into a `data:` URI, sniffing the MIME type instead of assuming PNG.
 * Passes through values that already carry a data URI or an http(s) URL. Returns '' for empty input.
 */
export function toDataImageUri(value: string): string {
  const raw = (value || '').trim()
  if (!raw) return ''
  if (raw.startsWith('data:image/')) return raw
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw
  const clean = raw.replace(/\s+/g, '')
  return `data:${sniffImageMime(clean)};base64,${clean}`
}
