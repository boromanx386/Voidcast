/** Primary line ending style detected from file bytes on disk. */
export type FileLineEndings = 'crlf' | 'lf'

export function detectFileLineEndings(text: string): FileLineEndings {
  return text.includes('\r\n') ? 'crlf' : 'lf'
}

export function toLf(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

/** Restore dominant on-disk EOL after editing in LF-normalized space. */
export function restoreLineEndings(text: string, eol: FileLineEndings): string {
  if (eol === 'lf') return text
  return text.replace(/\n/g, '\r\n')
}

function replaceSnippet(
  text: string,
  find: string,
  replace: string,
  replaceAll: boolean,
): string {
  return replaceAll ? text.split(find).join(replace) : text.replace(find, replace)
}

export type SnippetEditMode = 'exact' | 'crlf-expanded' | 'normalized' | 'whitespace-normalized'

export type SnippetEditOptions = {
  replaceAll?: boolean
  /** 1-based inclusive start; restrict search to this range. */
  startLine?: number
  /** 1-based inclusive end; restrict search to this range. */
  endLine?: number
  /** Match after collapsing indentation / runs of spaces. */
  ignoreWhitespace?: boolean
}

export type SnippetEditSuccess = {
  ok: true
  next: string
  mode: SnippetEditMode
  startLine: number
  endLine: number
}

export type ClosestSnippetMatch = {
  startLine: number
  endLine: number
  similarity: number
  excerpt: string
}

export type SnippetEditFailure = {
  ok: false
  closest?: ClosestSnippetMatch
}

export type SnippetEditResult = SnippetEditSuccess | SnippetEditFailure

function lineNumberAt(text: string, index: number): number {
  if (index <= 0) return 1
  return text.slice(0, index).split(/\r?\n/).length
}

function snippetLineCount(text: string): number {
  if (!text) return 0
  return text.split(/\r?\n/).length
}

function editLineRange(
  fileText: string,
  matchIndex: number,
  findUsed: string,
  replaceText: string,
): { startLine: number; endLine: number } {
  const startLine = lineNumberAt(fileText, matchIndex)
  const span = Math.max(snippetLineCount(findUsed) || 1, snippetLineCount(replaceText) || 1)
  return { startLine, endLine: startLine + span - 1 }
}

function firstMatchIndex(text: string, find: string, _replaceAll: boolean): number {
  if (!find) return -1
  return text.indexOf(find)
}

/** Collapse leading indent + internal whitespace runs for indentation-agnostic matching. */
export function normalizeWhitespaceForMatch(text: string): string {
  return toLf(text)
    .split('\n')
    .map((line) => line.replace(/^\s+/, '').replace(/[ \t]+/g, ' ').trimEnd())
    .join('\n')
}

function normalizeLineWs(line: string): string {
  return line.replace(/^\s+/, '').replace(/[ \t]+/g, ' ').trimEnd()
}

function sliceByLineRange(
  text: string,
  startLine?: number,
  endLine?: number,
): { slice: string; lineOffset: number; prefix: string; suffix: string } {
  if (startLine == null && endLine == null) {
    return { slice: text, lineOffset: 0, prefix: '', suffix: '' }
  }
  const lines = text.split(/\r?\n/)
  const start = Math.max(1, startLine ?? 1)
  const end = Math.min(lines.length, endLine ?? lines.length)
  if (start > end || start > lines.length) {
    return { slice: '', lineOffset: 0, prefix: text, suffix: '' }
  }
  const prefix = lines.slice(0, start - 1).join('\n')
  const slice = lines.slice(start - 1, end).join('\n')
  const suffix = lines.slice(end).join('\n')
  const prefixWithNl = prefix.length > 0 ? `${prefix}\n` : ''
  const suffixWithNl = suffix.length > 0 ? `\n${suffix}` : ''
  return { slice, lineOffset: start - 1, prefix: prefixWithNl, suffix: suffixWithNl }
}

function applyReplaceWithRange(
  fileText: string,
  findUsed: string,
  replaceUsed: string,
  replaceAll: boolean,
  mode: SnippetEditMode,
  /** Text used for line numbers (original file or LF view). */
  lineText: string,
  lineOffset = 0,
): SnippetEditResult {
  const matchIndex = firstMatchIndex(lineText, findUsed, replaceAll)
  if (matchIndex < 0) return { ok: false }
  const { startLine, endLine } = editLineRange(lineText, matchIndex, findUsed, replaceUsed)
  return {
    ok: true,
    next: replaceSnippet(fileText, findUsed, replaceUsed, replaceAll),
    mode,
    startLine: startLine + lineOffset,
    endLine: endLine + lineOffset,
  }
}

/** Line-based whitespace-normalized find/replace within an LF haystack. */
function applyWhitespaceNormalizedEdit(
  fileLf: string,
  findLf: string,
  replaceLf: string,
  replaceAll: boolean,
  lineOffset: number,
): SnippetEditResult {
  const fileLines = fileLf.split('\n')
  const findLines = findLf.split('\n')
  const findNorm = findLines.map(normalizeLineWs)
  if (!findNorm.length || findNorm.every((l) => !l)) return { ok: false }

  const findMatchAt = (from: number): number => {
    for (let i = from; i <= fileLines.length - findNorm.length; i++) {
      let ok = true
      for (let j = 0; j < findNorm.length; j++) {
        if (normalizeLineWs(fileLines[i + j]!) !== findNorm[j]) {
          ok = false
          break
        }
      }
      if (ok) return i
    }
    return -1
  }

  const replaceLines = replaceLf.split('\n')
  if (!replaceAll) {
    const at = findMatchAt(0)
    if (at < 0) return { ok: false }
    const nextLines = [
      ...fileLines.slice(0, at),
      ...replaceLines,
      ...fileLines.slice(at + findNorm.length),
    ]
    return {
      ok: true,
      next: nextLines.join('\n'),
      mode: 'whitespace-normalized',
      startLine: at + 1 + lineOffset,
      endLine: at + replaceLines.length + lineOffset,
    }
  }

  const nextLines = [...fileLines]
  let firstStart = -1
  let lastEnd = -1
  let from = 0
  let guard = 0
  while (guard++ < 10_000) {
    const at = (() => {
      for (let i = from; i <= nextLines.length - findNorm.length; i++) {
        let ok = true
        for (let j = 0; j < findNorm.length; j++) {
          if (normalizeLineWs(nextLines[i + j]!) !== findNorm[j]) {
            ok = false
            break
          }
        }
        if (ok) return i
      }
      return -1
    })()
    if (at < 0) break
    if (firstStart < 0) firstStart = at
    nextLines.splice(at, findNorm.length, ...replaceLines)
    lastEnd = at + replaceLines.length
    from = at + replaceLines.length
  }
  if (firstStart < 0) return { ok: false }
  return {
    ok: true,
    next: nextLines.join('\n'),
    mode: 'whitespace-normalized',
    startLine: firstStart + 1 + lineOffset,
    endLine: Math.max(firstStart + 1, lastEnd) + lineOffset,
  }
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  const rows = a.length + 1
  const cols = b.length + 1
  // Rolling two rows for memory
  let prev = new Array<number>(cols)
  let cur = new Array<number>(cols)
  for (let j = 0; j < cols; j++) prev[j] = j
  for (let i = 1; i < rows; i++) {
    cur[0] = i
    const ca = a.charCodeAt(i - 1)
    for (let j = 1; j < cols; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost)
    }
    ;[prev, cur] = [cur, prev]
  }
  return prev[b.length]!
}

/**
 * Find closest region to `findText` in `fileText` (whitespace-normalized comparison).
 * Uses sliding windows of similar line count; cheap one-pass for typical snippets.
 */
export function findClosestSnippetMatch(
  fileText: string,
  findText: string,
  options?: { startLine?: number; endLine?: number },
): ClosestSnippetMatch | null {
  if (!findText.trim()) return null
  const fileLf = toLf(fileText)
  const findLf = toLf(findText)
  const { slice, lineOffset } = sliceByLineRange(fileLf, options?.startLine, options?.endLine)
  if (!slice) return null

  const fileLines = slice.split('\n')
  const findLines = findLf.split('\n')
  const windowSize = Math.max(1, findLines.length)
  const findNorm = normalizeWhitespaceForMatch(findLf)
  if (!findNorm) return null

  let best: ClosestSnippetMatch | null = null
  const maxWindows = Math.max(0, fileLines.length - windowSize + 1)
  // Cap work for huge files
  const step = maxWindows > 5_000 ? Math.ceil(maxWindows / 5_000) : 1

  for (let i = 0; i < maxWindows; i += step) {
    const window = fileLines.slice(i, i + windowSize).join('\n')
    const winNorm = normalizeWhitespaceForMatch(window)
    const maxLen = Math.max(findNorm.length, winNorm.length, 1)
    // Quick reject via length ratio
    if (Math.abs(findNorm.length - winNorm.length) / maxLen > 0.55) continue
    const dist = levenshtein(
      findNorm.length > 400 ? findNorm.slice(0, 400) : findNorm,
      winNorm.length > 400 ? winNorm.slice(0, 400) : winNorm,
    )
    const cmpLen = Math.max(
      Math.min(findNorm.length, 400),
      Math.min(winNorm.length, 400),
      1,
    )
    const similarity = Math.max(0, Math.min(100, Math.round((1 - dist / cmpLen) * 100)))
    if (similarity < 40) continue
    if (!best || similarity > best.similarity) {
      const startLine = i + 1 + lineOffset
      const endLine = i + windowSize + lineOffset
      const excerpt = window
        .split('\n')
        .slice(0, 6)
        .map((l) => (l.length > 100 ? `${l.slice(0, 99)}…` : l))
        .join('\n')
      best = { startLine, endLine, similarity, excerpt }
    }
  }
  return best
}

/**
 * Apply find/replace on file text. Tries exact match first, then CRLF expansion, then LF-normalized match
 * while preserving the file's primary line endings on write.
 * Optional line-range anchor and whitespace-normalized matching.
 */
export function applySnippetEdit(
  fileText: string,
  findText: string,
  replaceText: string,
  replaceAllOrOptions: boolean | SnippetEditOptions = false,
): SnippetEditResult {
  if (!findText) return { ok: false }

  const options: SnippetEditOptions =
    typeof replaceAllOrOptions === 'boolean'
      ? { replaceAll: replaceAllOrOptions }
      : replaceAllOrOptions
  const replaceAll = options.replaceAll === true
  const ignoreWhitespace = options.ignoreWhitespace === true

  const eol = detectFileLineEndings(fileText)
  const fileLfFull = toLf(fileText)
  const { slice, lineOffset, prefix, suffix } = sliceByLineRange(
    fileLfFull,
    options.startLine,
    options.endLine,
  )

  // Work in LF space within the optional line range, then restore EOL for the full file.
  const scopedFile = slice
  const findLf = toLf(findText)
  const replaceLf = toLf(replaceText)

  const tryExactOn = (haystack: string, findUsed: string, replaceUsed: string, mode: SnippetEditMode) => {
    if (!haystack.includes(findUsed)) return null as SnippetEditResult | null
    const matchIndex = firstMatchIndex(haystack, findUsed, replaceAll)
    if (matchIndex < 0) return null
    const nextSlice = replaceSnippet(haystack, findUsed, replaceUsed, replaceAll)
    const nextLf = `${prefix}${nextSlice}${suffix}`
    const { startLine, endLine } = editLineRange(haystack, matchIndex, findUsed, replaceUsed)
    return {
      ok: true as const,
      next: restoreLineEndings(nextLf, eol),
      mode,
      startLine: startLine + lineOffset,
      endLine: endLine + lineOffset,
    }
  }

  // 1) Exact (including original CRLF find if present in scoped LF view — try original first on full when no range)
  if (options.startLine == null && options.endLine == null && !ignoreWhitespace) {
    if (fileText.includes(findText)) {
      return applyReplaceWithRange(fileText, findText, replaceText, replaceAll, 'exact', fileText)
    }
    if (eol === 'crlf' && findText.includes('\n') && !findText.includes('\r\n')) {
      const findCrlf = findText.replace(/\n/g, '\r\n')
      const replaceCrlf = replaceText.replace(/\n/g, '\r\n')
      if (fileText.includes(findCrlf)) {
        return applyReplaceWithRange(
          fileText,
          findCrlf,
          replaceCrlf,
          replaceAll,
          'crlf-expanded',
          fileText,
        )
      }
    }
  }

  // Scoped / LF exact
  const exact = tryExactOn(scopedFile, findLf, replaceLf, 'normalized')
  if (exact) return exact

  // CRLF find against scoped LF already covered by findLf

  if (ignoreWhitespace) {
    const ws = applyWhitespaceNormalizedEdit(
      scopedFile,
      findLf,
      replaceLf,
      replaceAll,
      lineOffset,
    )
    if (ws.ok) {
      const nextLf = `${prefix}${toLf(ws.next)}${suffix}`
      return {
        ok: true,
        next: restoreLineEndings(nextLf, eol),
        mode: 'whitespace-normalized',
        startLine: ws.startLine,
        endLine: ws.endLine,
      }
    }
  }

  const closest = findClosestSnippetMatch(fileText, findText, {
    startLine: options.startLine,
    endLine: options.endLine,
  })
  return { ok: false, closest: closest ?? undefined }
}

export const EDIT_DIFF_MAX_CHARS = 2_500

/**
 * Build a small unified diff for the changed line range (±context lines).
 */
export function buildEditUnifiedDiff(
  before: string,
  after: string,
  path: string,
  changeStartLine: number,
  changeEndLine: number,
  context = 3,
): string {
  const beforeLines = toLf(before).split('\n')
  const afterLines = toLf(after).split('\n')
  const oldStart = Math.max(1, changeStartLine - context)
  const oldEnd = Math.min(beforeLines.length, changeEndLine + context)
  // Estimate new range: same window start, adjusted by length delta of the edited span
  const oldSpan = Math.max(1, changeEndLine - changeStartLine + 1)
  const newSpanGuess = Math.max(1, oldSpan + (afterLines.length - beforeLines.length))
  const newStart = oldStart
  const newEnd = Math.min(afterLines.length, newStart + (oldEnd - oldStart) + (newSpanGuess - oldSpan))

  const oldSlice = beforeLines.slice(oldStart - 1, oldEnd)
  const newSlice = afterLines.slice(newStart - 1, Math.max(newEnd, newStart + newSpanGuess + context - 1))

  // Simple LCS-free line diff for the window
  const lines: string[] = [
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -${oldStart},${oldSlice.length} +${newStart},${newSlice.length} @@`,
  ]

  // Myers-lite: mark lines unique to old as -, unique to new as +, shared as space
  // Use a greedy alignment by equality
  let i = 0
  let j = 0
  while (i < oldSlice.length || j < newSlice.length) {
    if (i < oldSlice.length && j < newSlice.length && oldSlice[i] === newSlice[j]) {
      lines.push(` ${oldSlice[i]}`)
      i++
      j++
      continue
    }
    // Look ahead for resync
    let found = false
    if (i < oldSlice.length) {
      for (let k = j; k < Math.min(j + 8, newSlice.length); k++) {
        if (oldSlice[i] === newSlice[k]) {
          while (j < k) {
            lines.push(`+${newSlice[j]}`)
            j++
          }
          found = true
          break
        }
      }
    }
    if (!found && j < newSlice.length) {
      for (let k = i; k < Math.min(i + 8, oldSlice.length); k++) {
        if (newSlice[j] === oldSlice[k]) {
          while (i < k) {
            lines.push(`-${oldSlice[i]}`)
            i++
          }
          found = true
          break
        }
      }
    }
    if (!found) {
      if (i < oldSlice.length && (j >= newSlice.length || oldSlice.length - i >= newSlice.length - j)) {
        lines.push(`-${oldSlice[i]}`)
        i++
      } else if (j < newSlice.length) {
        lines.push(`+${newSlice[j]}`)
        j++
      }
    }
  }

  let out = lines.join('\n')
  if (out.length > EDIT_DIFF_MAX_CHARS) {
    out = `${out.slice(0, EDIT_DIFF_MAX_CHARS - 1)}…`
  }
  return out
}

export function formatClosestMatchFailure(closest?: ClosestSnippetMatch): string {
  if (!closest) {
    return (
      'Spaces must match. On Windows/CRLF files you can use \\n in find_text — matching is EOL-aware. ' +
      'Prefer edit_code over rewriting the whole file. Tip: pass start_line/end_line or ignore_whitespace=true.'
    )
  }
  const excerpt = closest.excerpt
    .split('\n')
    .map((l) => `  ${l}`)
    .join('\n')
  return (
    `Closest match at L${closest.startLine}-L${closest.endLine}, ` +
    `~${closest.similarity}% similar (often whitespace/indentation). Excerpt:\n${excerpt}\n` +
    `Retry with a tighter find_text, start_line/end_line, or ignore_whitespace=true.`
  )
}

/** Parse `Edited path (lines 12-18, …)` tool results for coding context memo. */
export function parseEditedLineRangeFromToolResult(result: string): {
  startLine: number
  endLine: number
} | null {
  const m = result.trim().match(/\(lines (\d+)-(\d+)/)
  if (!m) return null
  const startLine = Number.parseInt(m[1], 10)
  const endLine = Number.parseInt(m[2], 10)
  if (!Number.isFinite(startLine) || !Number.isFinite(endLine) || startLine < 1 || endLine < startLine) {
    return null
  }
  return { startLine, endLine }
}

export function formatEditedFileMemoEntry(path: string, toolResult: string): string {
  const range = parseEditedLineRangeFromToolResult(toolResult)
  if (range) return `${path} (edited lines ${range.startLine}-${range.endLine})`
  return `${path} (edited)`
}

const READ_FILE_CRLF_HINT =
  '[line endings: CRLF on disk. Use \\n in edit_code find_text; matching is EOL-aware.]\n'

/** One-line hint for the model when read_file returns a view (not used for internal edit reads). */
export function readFileToolDisplayPrefix(lineEndings: FileLineEndings, numberedView: boolean): string {
  if (lineEndings !== 'crlf') return ''
  if (numberedView) {
    return '[line endings: CRLF on disk; numbered lines below use \\n only. edit_code still accepts \\n in find_text.]\n'
  }
  return READ_FILE_CRLF_HINT
}
