/** Shared diagnostics + parsers for coding `check_types` (tsc / ruff / pyright / go vet / cargo). */

export type CheckDiagnostic = {
  file: string
  line: number
  column: number
  code: string
  message: string
}

/** @deprecated Use CheckDiagnostic — kept as alias for existing imports. */
export type TscDiagnostic = CheckDiagnostic

export type CheckKind = 'typescript' | 'python' | 'go' | 'rust'

/** Preference order when path counts tie (TypeScript first — historical default). */
const CHECK_KIND_TIE_ORDER: CheckKind[] = ['typescript', 'python', 'go', 'rust']

export const TYPECHECK_MAX_REPORTED_ERRORS = 50

export function normalizeTypecheckPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '')
}

export function isPythonSourcePath(filePath: string): boolean {
  return /\.pyw?$/i.test(filePath.trim())
}

export function isTypeScriptSourcePath(filePath: string): boolean {
  return /\.tsx?$/i.test(filePath.trim())
}

export function isGoSourcePath(filePath: string): boolean {
  return /\.go$/i.test(filePath.trim())
}

export function isRustSourcePath(filePath: string): boolean {
  return /\.rs$/i.test(filePath.trim())
}

/**
 * Decide which checker to run from path hints + on-disk project signals.
 * Explicit source extensions win (majority); ties prefer typescript → python → go → rust.
 * Without paths: tsconfig → Python markers → go.mod → Cargo.toml.
 */
export function detectCheckKind(params: {
  paths?: string[]
  hasTsconfig: boolean
  hasPythonProject: boolean
  hasGoMod?: boolean
  hasCargoToml?: boolean
}): CheckKind | null {
  const paths = (params.paths ?? []).map((p) => p.trim()).filter(Boolean)
  const counts: Record<CheckKind, number> = {
    typescript: paths.filter(isTypeScriptSourcePath).length,
    python: paths.filter(isPythonSourcePath).length,
    go: paths.filter(isGoSourcePath).length,
    rust: paths.filter(isRustSourcePath).length,
  }

  const ranked = (Object.entries(counts) as [CheckKind, number][])
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])

  if (ranked.length === 1) return ranked[0]![0]
  if (ranked.length > 1) {
    const max = ranked[0]![1]
    const tied = ranked.filter(([, n]) => n === max).map(([k]) => k)
    return CHECK_KIND_TIE_ORDER.find((k) => tied.includes(k)) ?? ranked[0]![0]
  }

  if (params.hasTsconfig) return 'typescript'
  if (params.hasPythonProject) return 'python'
  if (params.hasGoMod) return 'go'
  if (params.hasCargoToml) return 'rust'
  return null
}

const TSC_ERROR_PAREN_RE =
  /^(.+?)\((\d+),(\d+)\):\s*error\s+(TS\d+):\s*(.+)$/i
const TSC_ERROR_COLON_RE =
  /^(.+?):(\d+):(\d+)\s*-\s*error\s+(TS\d+):\s*(.+)$/i

export function parseTscDiagnostics(output: string): CheckDiagnostic[] {
  const diags: CheckDiagnostic[] = []
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

/** Parse `ruff check --output-format json` stdout. */
export function parseRuffJsonDiagnostics(output: string): CheckDiagnostic[] {
  const trimmed = output.trim()
  if (!trimmed) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    // Sometimes ruff prints a banner before JSON — try last `[` array.
    const idx = trimmed.indexOf('[')
    if (idx < 0) return []
    try {
      parsed = JSON.parse(trimmed.slice(idx))
    } catch {
      return []
    }
  }
  if (!Array.isArray(parsed)) return []
  const diags: CheckDiagnostic[] = []
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const filename = typeof o.filename === 'string' ? o.filename : ''
    const message = typeof o.message === 'string' ? o.message : ''
    const code = typeof o.code === 'string' && o.code ? o.code : 'RUFF'
    const loc = o.location
    let line = 1
    let column = 1
    if (loc && typeof loc === 'object') {
      const L = loc as Record<string, unknown>
      if (typeof L.row === 'number') line = L.row
      if (typeof L.column === 'number') column = L.column
    }
    if (!filename && !message) continue
    diags.push({
      file: normalizeTypecheckPath(filename),
      line,
      column,
      code,
      message,
    })
  }
  return diags
}

/** Parse `pyright --outputjson` stdout (0-based lines → 1-based). */
export function parsePyrightJsonDiagnostics(output: string): CheckDiagnostic[] {
  const trimmed = output.trim()
  if (!trimmed) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    const idx = trimmed.indexOf('{')
    if (idx < 0) return []
    try {
      parsed = JSON.parse(trimmed.slice(idx))
    } catch {
      return []
    }
  }
  if (!parsed || typeof parsed !== 'object') return []
  const general = (parsed as { generalDiagnostics?: unknown }).generalDiagnostics
  if (!Array.isArray(general)) return []
  const diags: CheckDiagnostic[] = []
  for (const item of general) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const severity = typeof o.severity === 'string' ? o.severity.toLowerCase() : 'error'
    if (severity === 'information' || severity === 'hint') continue
    const file = typeof o.file === 'string' ? o.file : ''
    const message = typeof o.message === 'string' ? o.message : ''
    const code =
      typeof o.rule === 'string' && o.rule
        ? o.rule
        : severity === 'warning'
          ? 'pyright-warning'
          : 'pyright'
    let line = 1
    let column = 1
    const range = o.range
    if (range && typeof range === 'object') {
      const start = (range as { start?: { line?: number; character?: number } }).start
      if (start && typeof start.line === 'number') line = start.line + 1
      if (start && typeof start.character === 'number') column = start.character + 1
    }
    if (!file && !message) continue
    diags.push({
      file: normalizeTypecheckPath(file),
      line,
      column,
      code,
      message,
    })
  }
  return diags
}

/**
 * Parse `go vet` / `go build` style diagnostics:
 *   path/file.go:12:5: message
 */
const GO_VET_DIAG_RE = /^(.+\.go):(\d+):(\d+):\s*(.+)$/i

export function parseGoVetDiagnostics(output: string): CheckDiagnostic[] {
  const diags: CheckDiagnostic[] = []
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const m = line.match(GO_VET_DIAG_RE)
    if (!m) continue
    diags.push({
      file: normalizeTypecheckPath(m[1]!),
      line: Number(m[2]),
      column: Number(m[3]),
      code: 'govet',
      message: m[4]!.trim(),
    })
  }
  return diags
}

/**
 * Parse `cargo check --message-format=json` NDJSON lines (compiler-message records).
 * Keeps error + warning; skips notes/helps.
 */
export function parseCargoJsonDiagnostics(output: string): CheckDiagnostic[] {
  const diags: CheckDiagnostic[] = []
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line[0] !== '{') continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    if (!parsed || typeof parsed !== 'object') continue
    const rec = parsed as Record<string, unknown>
    if (rec.reason !== 'compiler-message') continue
    const message = rec.message
    if (!message || typeof message !== 'object') continue
    const msg = message as Record<string, unknown>
    const level = typeof msg.level === 'string' ? msg.level.toLowerCase() : ''
    if (level !== 'error' && level !== 'warning') continue
    const text = typeof msg.message === 'string' ? msg.message : ''
    let code = level === 'warning' ? 'cargo-warning' : 'cargo'
    const codeObj = msg.code
    if (codeObj && typeof codeObj === 'object') {
      const c = (codeObj as { code?: string }).code
      if (typeof c === 'string' && c) code = c
    }
    const spans = Array.isArray(msg.spans) ? msg.spans : []
    const primary =
      spans.find(
        (s) => s && typeof s === 'object' && (s as { is_primary?: boolean }).is_primary === true,
      ) ?? spans[0]
    let file = ''
    let lineNo = 1
    let column = 1
    if (primary && typeof primary === 'object') {
      const sp = primary as {
        file_name?: string
        line_start?: number
        column_start?: number
      }
      if (typeof sp.file_name === 'string') file = sp.file_name
      if (typeof sp.line_start === 'number') lineNo = sp.line_start
      if (typeof sp.column_start === 'number') column = sp.column_start
    }
    if (!file && !text) continue
    diags.push({
      file: normalizeTypecheckPath(file),
      line: lineNo,
      column,
      code,
      message: text,
    })
  }
  return diags
}

export function filterTscDiagnostics(
  diags: CheckDiagnostic[],
  filterPaths: string[],
  pathPrefix = '',
): CheckDiagnostic[] {
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
        fileWithPrefix.endsWith(`/${f}`) ||
        // Also match when diagnostic paths are absolute-ish / include the filter basename.
        file.endsWith(`/${f.split('/').pop()}`) ||
        f.endsWith(`/${file}`),
    )
  })
}

export function formatTypecheckReport(params: {
  checkRootLabel: string
  diagnostics: CheckDiagnostic[]
  exitCode: number
  timedOut?: boolean
  rawOutput?: string
  /** Human label for the checker, e.g. TypeScript / ruff / pyright. */
  checker?: string
}): string {
  const {
    checkRootLabel,
    diagnostics,
    exitCode,
    timedOut,
    rawOutput,
    checker = 'TypeScript',
  } = params
  const capped = diagnostics.slice(0, TYPECHECK_MAX_REPORTED_ERRORS)
  const truncated = diagnostics.length > capped.length

  if (timedOut) {
    return `${checker} check timed out in ${checkRootLabel}.`
  }

  if (capped.length === 0) {
    if (exitCode === 0) {
      return `No ${checker} errors found (${checkRootLabel}).`
    }
    const tail = (rawOutput ?? '').trim().slice(-2000)
    return tail
      ? `${checker} check failed in ${checkRootLabel} (exit ${exitCode}) but no parseable errors were found. Raw output:\n${tail}`
      : `${checker} check failed in ${checkRootLabel} (exit ${exitCode}) but produced no parseable diagnostics.`
  }

  const lines = [
    `${checker} (${checkRootLabel}): ${diagnostics.length} error${diagnostics.length === 1 ? '' : 's'}${truncated ? ` (showing first ${capped.length})` : ''}.`,
    '',
    ...capped.map(
      (d) => `${d.file}:${d.line}:${d.column} — ${d.code}: ${d.message}`,
    ),
  ]
  return lines.join('\n')
}

/** Filenames that mark a Python project root for check_types auto-detection. */
export const PYTHON_PROJECT_MARKER_FILES = [
  'pyproject.toml',
  'ruff.toml',
  '.ruff.toml',
  'pyrightconfig.json',
  'requirements.txt',
  'requirements-tools.txt',
  'requirements-tts.txt',
  'setup.py',
  'Pipfile',
] as const
