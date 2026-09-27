import type { SubAgentDescribeResult } from '@/lib/subAgent'

/** Session-scoped vision descriptions keyed by {@link imageCatalogKey}. */
export type ImageVisionCache = Record<string, string>

const MAX_CACHE_ENTRIES = 64

export function imageCatalogKey(item: { path?: string; base64: string }): string {
  const path = item.path?.trim()
  if (path) return `path:${path.toLowerCase()}`
  const b64 = item.base64.replace(/\s+/g, '')
  return `b64:${b64.slice(0, 96)}`
}

/** Deterministic 32-bit FNV-1a hash rendered as 8 lowercase hex digits. */
function fnv1aHex(input: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/**
 * Stable, content/path-derived id (format `img_<8 hex>`) for a catalog image.
 * Unlike positional indexes, the same image always maps to the same id across
 * turns and reloads, so ids stay valid in history as context.
 */
export function imageCatalogId(item: { path?: string; base64: string }): string {
  return `img_${fnv1aHex(imageCatalogKey(item))}`
}

/** Normalize optional vision focus from image_recall tool args. */
export function normalizeVisionFocus(focus: string | undefined): string {
  return (focus || '').trim().replace(/\s+/g, ' ')
}

/**
 * Cache key for a vision description. Generic recalls (no focus) use the image key only.
 * Focused recalls are stored separately so repeat calls with different focus re-analyze.
 */
export function visionCacheKey(
  item: { path?: string; base64: string },
  focus?: string,
): string {
  const base = imageCatalogKey(item)
  const f = normalizeVisionFocus(focus)
  if (!f) return base
  return `${base}|focus:${f.toLowerCase()}`
}

/** Return a cached vision description for a recalled image, if present. */
export function lookupVisionCacheDescription(
  item: { path?: string; base64: string },
  cache: ImageVisionCache,
  focus?: string,
): string | undefined {
  const desc = cache[visionCacheKey(item, focus)]?.trim()
  return desc || undefined
}

export function normalizeImageVisionCache(raw: unknown): ImageVisionCache {
  if (!raw || typeof raw !== 'object') return {}
  const out: ImageVisionCache = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof k !== 'string' || typeof v !== 'string') continue
    const desc = v.trim()
    if (desc) out[k] = desc
  }
  const keys = Object.keys(out)
  if (keys.length <= MAX_CACHE_ENTRIES) return out
  const trimmed: ImageVisionCache = {}
  for (const k of keys.slice(-MAX_CACHE_ENTRIES)) trimmed[k] = out[k]!
  return trimmed
}

export function mergeImageVisionCache(
  base: ImageVisionCache,
  entries: ImageVisionCache,
): ImageVisionCache {
  return normalizeImageVisionCache({ ...base, ...entries })
}

export type RecallImageForCache = {
  index: number
  path?: string
  base64: string
  mime?: string
}

export function cacheEntriesFromDescribeResults(
  recalled: RecallImageForCache[],
  results: SubAgentDescribeResult[],
  focus?: string,
): ImageVisionCache {
  const entries: ImageVisionCache = {}
  for (const r of results) {
    if (r.error || !r.description.trim()) continue
    const img = recalled.find((x) => x.index === r.index)
    if (!img) continue
    entries[visionCacheKey({ path: img.path ?? r.path, base64: img.base64 }, focus)] =
      r.description.trim()
  }
  return entries
}
