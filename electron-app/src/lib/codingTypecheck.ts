export type TscDiagnostic = {
  file: string
  line: number
  column: number
  code: string
  message: string
}

const TSC_ERROR_PAREN_RE =
  /^(.+?)\((\d+),(\d+)\):\s*error\s+(TS\d+):\s*(.+)$/i
const TSC_ERROR_COLON_RE =
  /^(.+?):(\d+):(\d+)\s*-\s*error\s+(TS\d+):\s*(.+)$/i

export const TYPECHECK_MAX_REPORTED_ERRORS = 50

export function normalizeTypecheckPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '')
}

export function parseTscDiagnostics(output: string): TscDiagnostic[] {
  const diags: TscDiagnostic[] = []
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    const paren = line.match(TSC_ERROR_PAREN_RE)
    if (paren) {
      diags.push({
        file: normalizeTypecheckPath(paren[1]),
        line: Number(paren[2]),
        column: Number(paren[3]),
        code: paren[4],
        message: paren[5].trim(),
      })
      continue
    }
    const colon = line.match(TSC_ERROR_COLON_RE)
    if (colon) {
      diags.push({
        file: normalizeTypecheckPath(colon[1]),
        line: Number(colon[2]),
        column: Number(colon[3]),
        code: colon[4],
        message: colon[5].trim(),
      })
    }
  }
  return diags
}

export function filterTscDiagnostics(
  diags: TscDiagnostic[],
  filterPaths: string[],
  pathPrefix = '',
): TscDiagnostic[] {
  const filters = filterPaths.map((p) => normalizeTypecheckPath(p.trim()).toLowerCase()).filter(Boolean)
  if (filters.length === 0) return diags
  const prefix = normalizeTypecheckPath(pathPrefix.trim())
  return diags.filter((diag) => {
    const file = diag.file.toLowerCase()
    const fileWithPrefix =
      prefix && prefix !== '.'
        ? normalizeTypecheckPath(`${prefix}/${diag.file}`).toLowerCase()
        : file
    return filters.some(
      (f) =>
        file === f ||
        file.endsWith(`/${f}`) ||
        fileWithPrefix === f ||
        fileWithPrefix.endsWith(`/${f}`),
    )
  })
}

export function formatTypecheckReport(params: {
  checkRootLabel: string
  diagnostics: TscDiagnostic[]
  exitCode: number
  timedOut?: boolean
  rawOutput?: string
}): string {
  const { checkRootLabel, diagnostics, exitCode, timedOut, rawOutput } = params
  const capped = diagnostics.slice(0, TYPECHECK_MAX_REPORTED_ERRORS)
  const truncated = diagnostics.length > capped.length

  if (timedOut) {
    return `Typecheck timed out in ${checkRootLabel}.`
  }

  if (capped.length === 0) {
    if (exitCode === 0) {
      return `No TypeScript errors found (${checkRootLabel}).`
    }
    const tail = (rawOutput ?? '').trim().slice(-2000)
    return tail
      ? `Typecheck failed in ${checkRootLabel} (exit ${exitCode}) but no parseable TS errors were found. Raw output:\n${tail}`
      : `Typecheck failed in ${checkRootLabel} (exit ${exitCode}) but produced no parseable diagnostics.`
  }

  const lines = [
    `Typecheck (${checkRootLabel}): ${diagnostics.length} error${diagnostics.length === 1 ? '' : 's'}${truncated ? ` (showing first ${capped.length})` : ''}.`,
    '',
    ...capped.map(
      (d) => `${d.file}:${d.line}:${d.column} — ${d.code}: ${d.message}`,
    ),
  ]
  return lines.join('\n')
}
