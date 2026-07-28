/**
 * Pure, Electron-free symbol outline extraction for the `find_symbols` tool.
 *
 * Regex-based per-language heuristics — zero new deps, matching this repo's
 * "bundled + fallback, no heavy native deps" philosophy (cf. ripgrep + walk
 * fallback in search_files, npx tsc for typecheck). A tree-sitter binding or
 * ts-morph would be more accurate but would break that contract for a
 * navigation aid.
 *
 * Output line numbers mirror `read_file`'s `N|` prefix so they feed straight
 * into `edit_code`'s `start_line` / `end_line` anchor — a closed loop.
 */

export type SymbolKind =
  | 'function'
  | 'async_function'
  | 'class'
  | 'method'
  | 'interface'
  | 'type'
  | 'enum'
  | 'const'
  | 'def'
  | 'async_def'
  | 'struct'
  | 'impl'
  | 'trait'
  | 'heading'

export interface SymbolEntry {
  /** 1-based line number in the source file. */
  line: number
  kind: SymbolKind
  name: string
  /** Trimmed declaration tail, e.g. `handleGlobFiles(args, ctx)` — capped. */
  signature?: string
}

export type OutlineLanguage = 'ts' | 'js' | 'py' | 'go' | 'rs' | 'md'

const SIGNATURE_CAP = 96

function cap(s: string, n = SIGNATURE_CAP): string {
  const t = s.trim()
  return t.length > n ? t.slice(0, n - 1) + '…' : t
}

export function detectLanguageFromExt(filePath: string): OutlineLanguage | null {
  const dot = filePath.lastIndexOf('.')
  if (dot < 0) return null
  const ext = filePath.slice(dot + 1).toLowerCase()
  switch (ext) {
    case 'ts':
    case 'tsx':
      return 'ts'
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return 'js'
    case 'py':
      return 'py'
    case 'go':
      return 'go'
    case 'rs':
      return 'rs'
    case 'md':
    case 'mdx':
      return 'md'
    default:
      return null
  }
}

/** Compose a signature from the remainder of a line after a matched prefix. */
function tailAfter(line: string, name: string, openParenIdx?: number): string {
  // Use everything from the name onward (or from first '(' if provided), trimmed.
  const idx = openParenIdx != null && openParenIdx >= 0 ? openParenIdx : line.indexOf(name)
  if (idx < 0) return ''
  return cap(line.slice(idx))
}

function tsJsSymbol(line: string, indent: number): { kind: SymbolKind; name: string; signature?: string } | null {
  // Block-level (low indent) declarations.
  if (indent <= 1) {
    let m =
      /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s+([\w$]+)/.exec(line)
    if (m) {
      const async = /async\s+function/.test(line)
      return { kind: async ? 'async_function' : 'function', name: m[1], signature: cap(line) }
    }
    m = /^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([\w$]+)/.exec(line)
    if (m) return { kind: 'class', name: m[1], signature: cap(line) }
    m = /^(?:export\s+)?interface\s+([\w$]+)/.exec(line)
    if (m) return { kind: 'interface', name: m[1], signature: cap(line) }
    m = /^(?:export\s+)?type\s+([\w$]+)\b/.exec(line)
    if (m) return { kind: 'type', name: m[1], signature: cap(line) }
    m = /^(?:export\s+)?enum\s+([\w$]+)/.exec(line)
    if (m) return { kind: 'enum', name: m[1], signature: cap(line) }
    m = /^(?:export\s+)?(?:const|let|var)\s+([\w$]+)\s*=/.exec(line)
    if (m) return { kind: 'const', name: m[1], signature: cap(line) }
    // export { name } re-exports — useful but noisy; skip unless it's a single named export.
  }

  // Indented class methods (indent >= 2). Match `name(...) {` or `name = (...) =>`,
  // optionally preceded by modifiers (public/private/protected/static/async/get/set/readonly).
  if (indent >= 2) {
    const m =
      /^\s+(?:(?:public|private|protected|static|readonly|async|get|set|abstract|override)\s+)*([\w$]+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)\s*(?::\s*[^={]+)?\s*(?:\{|=>)/.exec(
        line,
      )
    if (m && !['if', 'for', 'while', 'switch', 'catch', 'return', 'function'].includes(m[1])) {
      // Reconstruct signature from the first '(' onward for readability.
      const pIdx = line.indexOf('(')
      return { kind: 'method', name: m[1], signature: tailAfter(line, m[1], pIdx) }
    }
  }
  return null
}

function pySymbol(line: string): { kind: SymbolKind; name: string; signature?: string } | null {
  let m = /^\s*(async\s+)?def\s+(\w+)\s*\((.*)/.exec(line)
  if (m) return { kind: m[1] ? 'async_def' : 'def', name: m[2], signature: cap(`(${m[3]}`) }
  m = /^\s*class\s+(\w+)\b/.exec(line)
  if (m) return { kind: 'class', name: m[1], signature: cap(line) }
  return null
}

function goSymbol(line: string): { kind: SymbolKind; name: string; signature?: string } | null {
  // func Name(args) or func (recv) Name(args)
  let m = /^func\s+(?:\([^)]*\)\s+)?(\w+)\s*\(/.exec(line)
  if (m) return { kind: 'function', name: m[1], signature: cap(line) }
  m = /^type\s+(\w+)\s+struct\b/.exec(line)
  if (m) return { kind: 'struct', name: m[1], signature: cap(line) }
  m = /^type\s+(\w+)\s+interface\b/.exec(line)
  if (m) return { kind: 'interface', name: m[1], signature: cap(line) }
  m = /^type\s+(\w+)\b/.exec(line)
  if (m) return { kind: 'type', name: m[1], signature: cap(line) }
  return null
}

function rsSymbol(line: string): { kind: SymbolKind; name: string; signature?: string } | null {
  let m =
    /(?:pub\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+(\w+)\s*(?:<[^>]*>)?\s*\(/.exec(line)
  if (m) return { kind: m[0].includes('async') ? 'async_function' : 'function', name: m[1], signature: cap(line) }
  m = /(?:pub\s+)?struct\s+(\w+)/.exec(line)
  if (m) return { kind: 'struct', name: m[1], signature: cap(line) }
  m = /(?:pub\s+)?enum\s+(\w+)/.exec(line)
  if (m) return { kind: 'enum', name: m[1], signature: cap(line) }
  m = /(?:pub\s+)?trait\s+(\w+)/.exec(line)
  if (m) return { kind: 'trait', name: m[1], signature: cap(line) }
  m = /^impl(?:<[^>]*>)?\s+(?:([\w:]+)\s+for\s+)?([\w:]+)/.exec(line)
  if (m) return { kind: 'impl', name: m[2] || m[1] || 'impl', signature: cap(line) }
  return null
}

function mdSymbol(line: string, lineNo: number): { kind: SymbolKind; name: string; signature?: string } | null {
  const m = /^(#{1,6})\s+(.*)$/.exec(line)
  if (m) return { kind: 'heading', name: m[2].trim(), signature: `h${m[1].length}` }
  // Front-matter fence line numbers also useful but skip; headings only.
  void lineNo
  return null
}

/**
 * Extract symbols from file content for a detected language.
 * Line numbers are 1-based. When `query` is set, filter by name substring
 * (case-insensitive) *before* applying the `maxSymbols` cap so late matches
 * are not dropped by an early cap.
 */
export function extractSymbols(
  content: string,
  lang: OutlineLanguage,
  maxSymbols = 400,
  query?: string,
): SymbolEntry[] {
  const lines = content.split(/\r?\n/)
  const out: SymbolEntry[] = []
  const capAt = Math.max(1, Math.floor(maxSymbols || 400))
  const q = query?.trim().toLowerCase() || ''

  for (let i = 0; i < lines.length; i++) {
    if (out.length >= capAt) break
    const line = lines[i]
    const lineNo = i + 1
    const indentMatch = /^(\s*)/.exec(line)
    const indent = indentMatch ? indentMatch[1].length : 0

    let hit: { kind: SymbolKind; name: string; signature?: string } | null = null
    switch (lang) {
      case 'ts':
      case 'js':
        hit = tsJsSymbol(line, indent)
        break
      case 'py':
        hit = pySymbol(line)
        break
      case 'go':
        hit = goSymbol(line)
        break
      case 'rs':
        hit = rsSymbol(line)
        break
      case 'md':
        hit = mdSymbol(line, lineNo)
        break
    }
    if (hit && hit.name) {
      if (q && !hit.name.toLowerCase().includes(q)) continue
      out.push({ line: lineNo, kind: hit.kind, name: hit.name, signature: hit.signature })
    }
  }
  return out
}

export interface FormatOutlineOptions {
  /** Optional substring filter on symbol name (case-insensitive). Prefer filtering in extractSymbols. */
  query?: string
}

/**
 * Format extracted symbols as agent-facing text. One line per symbol, prefixed
 * with the 1-based line number (right-aligned) so it mirrors `read_file`'s
 * `N|` convention and feeds `edit_code` start_line/end_line.
 */
export function formatSymbolsOutline(
  relPath: string,
  symbols: SymbolEntry[],
  fileLineCount: number,
  opts?: FormatOutlineOptions,
): string {
  const query = opts?.query?.trim()
  const filtered = query
    ? symbols.filter((s) => s.name.toLowerCase().includes(query.toLowerCase()))
    : symbols

  const header = `find_symbols: ${relPath} (${fileLineCount} lines, ${filtered.length} symbol${filtered.length === 1 ? '' : 's'}${query ? `, query="${query}"` : ''})`

  if (filtered.length === 0) {
    return `${header}\n(No symbols${query ? ` matching "${query}"` : ''} found.)`
  }

  const width = String(fileLineCount).length
  const rows = filtered.map((s) => {
    const ln = String(s.line).padStart(width, ' ')
    const sig = s.signature ? `  ${s.signature}` : ''
    return `${ln}  ${s.kind.padEnd(14, ' ')}${s.name}${sig}`
  })
  return `${header}\n${rows.join('\n')}`
}