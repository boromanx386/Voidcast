import { isCodingToolFailure } from '@/lib/codingContextMemo'

export type CodingRevealRequest = {
  path: string
  nonce: number
}

/** Normalize project-relative paths the way the coding tree stores them. */
export function normalizeCodingRevealPath(raw: string): string {
  return raw.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')
}

/** Ancestor directory paths for a file (root → parent), using `/` separators. */
export function codingRevealParentDirs(filePath: string): string[] {
  const normalized = normalizeCodingRevealPath(filePath)
  const parts = normalized.split('/').filter(Boolean)
  if (parts.length <= 1) return []
  const dirs: string[] = []
  for (let i = 0; i < parts.length - 1; i++) {
    dirs.push(parts.slice(0, i + 1).join('/'))
  }
  return dirs
}

/**
 * Path to open in the coding panel after a successful write/edit tool call.
 * `read_file` is excluded — inspecting should not steal focus into preview.
 * Returns null when the tool is unrelated, failed, or missing a path.
 */
export function codingRevealPathFromToolResult(
  name: string,
  result: string,
  args?: Record<string, unknown>,
): string | null {
  if (name !== 'write_file' && name !== 'edit_code') return null
  if (isCodingToolFailure(name, result)) return null
  const raw = typeof args?.path === 'string' ? args.path : ''
  const path = normalizeCodingRevealPath(raw)
  return path || null
}
