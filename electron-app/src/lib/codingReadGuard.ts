/**
 * Soft-deny whole-file re-reads of a path already read this turn (in-turn working-set cache).
 * Session digests from earlier turns never deny: only a short digest survives the turn
 * boundary, not the file body, so the model has to be able to read it again.
 * Range-reads and force:true always pass.
 */

/** Normalize project-relative paths for digest/cache lookup. */
export function normalizeCodingReadPath(path: string): string {
  return path.trim().replace(/\\/g, '/')
}

export function shouldSoftDenyFullRead(params: {
  path: string
  startLine?: number
  endLine?: number
  force?: boolean
  cachedPaths?: string[]
}): boolean {
  if (params.force === true) return false
  if (params.startLine != null || params.endLine != null) return false
  const path = normalizeCodingReadPath(params.path)
  if (!path) return false

  return (params.cachedPaths ?? []).some((p) => normalizeCodingReadPath(p) === path)
}

/** Leading marker of a soft-denied read result; such results must not be cached as file content. */
export const SOFT_DENIED_READ_PREFIX = '[Already read this turn:'

export function formatSoftDeniedReadResult(path: string, digest?: string): string {
  const p = normalizeCodingReadPath(path) || path.trim()
  const dig = (digest ?? '').trim()
  const lines = [
    `${SOFT_DENIED_READ_PREFIX} ${p}]`,
    dig ? `Digest: ${dig}` : 'Digest: (see the earlier read_file result or working-set hint)',
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
  return ['---', '[Plan handoff — prior agent exploration for this same request]', body].join('\n')
}
