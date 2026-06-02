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
): ImageVisionCache {
  const entries: ImageVisionCache = {}
  for (const r of results) {
    if (r.error || !r.description.trim()) continue
    const img = recalled.find((x) => x.index === r.index)
    if (!img) continue
    entries[imageCatalogKey({ path: img.path ?? r.path, base64: img.base64 })] =
      r.description.trim()
  }
  return entries
}
