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
 *
 * Every prefix below was verified by base64-encoding a real header, not derived by hand.
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
  // BMP: "BM" followed by a 4-byte size; char 2 carries the two spare bits of "BM", so it is
  // always one of '0'-'3'.
  if (/^Qk[0-3]/.test(clean)) return 'image/bmp'
  // TIFF: "II*\0" little-endian or "MM\0*" big-endian.
  if (clean.startsWith('SUkq') || clean.startsWith('TU0A')) return 'image/tiff'
  // ICO/CUR: reserved 0, type 1, count 1 → 00 00 01 00 01 00.
  if (clean.startsWith('AAABAAEA')) return 'image/x-icon'
  // ISOBMFF (HEIF/AVIF): 4-byte box size + "ftyp" + brand. Chars 8-11 are the brand's first
  // three bytes, so they survive whatever the size field says.
  if (clean.startsWith('AAAA')) {
    const brand = clean.slice(8, 12)
    if (brand === 'eXBh') return 'image/avif' // avif | avis
    if (brand === 'eXBo' || brand === 'eXBt') return 'image/heic' // heic | heix | mif1 | msf1
  }
  // SVG is text, not pixels. Only a document that opens with `<svg` is matched; one that starts
  // with an XML prolog falls through to the declared type, which the send gate still catches.
  if (clean.startsWith('PHN2Zy')) return 'image/svg+xml'
  return null
}

/** Sniff the image MIME type from the base64 magic prefix. Falls back to PNG. */
export function sniffImageMime(base64: string): string {
  return sniffImageMimeOrNull(base64) ?? 'image/png'
}

/** `detail` values an OpenAI-compatible `image_url` object accepts. */
export type ImageDetailHint = 'low' | 'high' | 'auto'

/**
 * Media types the hosted vision APIs accept. Anthropic and OpenAI take these four only — BMP,
 * TIFF, ICO, HEIC, AVIF and SVG are sniffable (or get declared) but produce a hard 400, so
 * callers should refuse them with a message the user can act on.
 */
const VISION_SENDABLE_MIMES: readonly string[] = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]

export function isVisionSendableImageMime(mime: string): boolean {
  return VISION_SENDABLE_MIMES.includes((mime || '').trim().toLowerCase())
}

/**
 * Resolve the media type to send for a payload — magic prefix first, declared type second.
 * Returns null when no hosted vision API would accept the result.
 */
export function resolveSendableImageMime(base64: string, declaredMime: string): string | null {
  const declared = (declaredMime || '').trim().toLowerCase()
  const mime =
    sniffImageMimeOrNull(base64) ??
    (/^image\/[a-z0-9.+-]+$/i.test(declared) ? declared : 'image/png')
  return isVisionSendableImageMime(mime) ? mime : null
}

/**
 * `detail` hint for OpenAI-compatible `image_url` parts.
 *
 * Providers default to `auto`, which already tiles large images, so this only ever *raises* the
 * hint — for calls that must read every glyph (transcripts, UI text, error dialogs, charts).
 * It never lowers to 'low': a silently downscaled image would degrade the description the main
 * model then reasons about. Returns undefined when the provider default is the right answer.
 */
export function imageDetailForPrompt(prompt: string | undefined): ImageDetailHint | undefined {
  const p = (prompt || '').toLowerCase()
  if (!p) return undefined
  const needsGlyphs =
    /(transcri|ocr|screenshot|stack ?trace|exception|error|terminal|code snippet|read the|text|label|button|menu|dialog|chart|table|graph|receipt|invoice|form)/.test(
      p,
    )
  return needsGlyphs ? 'high' : undefined
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
