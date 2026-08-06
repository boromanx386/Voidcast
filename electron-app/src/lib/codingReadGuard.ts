/**
 * Soft-deny whole-file re-reads when digests / in-turn cache already hold the path.
 * Range-reads and force:true always pass.
 */
import type { CodingFileDigestEntry } from '@/lib/codingContextMemo'

/** Normalize project-relative paths for digest/cache lookup. */
export function normalizeCodingReadPath(path: string): string {
  return path.trim().replace(/\\/g, '/')
}

export function shouldSoftDenyFullRead(params: {
  path: string
  startLine?: number
  endLine?: number
  force?: boolean
  digests?: CodingFileDigestEntry[]
  cachedPaths?: string[]
}): boolean {
  if (params.force === true) return false
  if (params.startLine != null || params.endLine != null) return false
  const path = normalizeCodingReadPath(params.path)
  if (!path) return false

  const inDigests = (params.digests ?? []).some(
    (d) => normalizeCodingReadPath(d.path) === path,
  )
  if (inDigests) return true

  const inCache = (params.cachedPaths ?? []).some(
    (p) => normalizeCodingReadPath(p) === path,
  )
  return inCache
}

export function formatSoftDeniedReadResult(
  path: string,
  digest?: string,
): string {
  const p = normalizeCodingReadPath(path) || path.trim()
  const dig = (digest ?? '').trim()
  const lines = [
    `[Already in context: ${p}]`,
    dig ? `Digest: ${dig}` : 'Digest: (see session digests / prior read this turn)',
    'To re-read the whole file, call read_file with force:true.',
    'For edit_code, prefer find_symbols + start_line/end_line range-read.',
  ]
  return lines.join('\n')
}

/**
 * User-lane block for Plan turn after enter_plan_mode.
 * Empty when context is empty.
 */
export function formatPlanHandoffUserBlock(context: string): string {
  const body = context.trim()
  if (!body) return ''
  return [
    '---',
    '[Plan handoff — prior agent exploration for this same request]',
    body,
  ].join('\n')
}
