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

export type SnippetEditMode = 'exact' | 'crlf-expanded' | 'normalized'

export type SnippetEditResult =
  | { ok: true; next: string; mode: SnippetEditMode; startLine: number; endLine: number }
  | { ok: false }

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

function firstMatchIndex(text: string, find: string, replaceAll: boolean): number {
  if (!find) return -1
  return replaceAll ? text.indexOf(find) : text.indexOf(find)
}

function applyReplaceWithRange(
  fileText: string,
  findUsed: string,
  replaceUsed: string,
  replaceAll: boolean,
  mode: SnippetEditMode,
  /** Text used for line numbers (original file or LF view). */
  lineText: string,
): SnippetEditResult {
  const matchIndex = firstMatchIndex(lineText, findUsed, replaceAll)
  if (matchIndex < 0) return { ok: false }
  const { startLine, endLine } = editLineRange(lineText, matchIndex, findUsed, replaceUsed)
  return {
    ok: true,
    next: replaceSnippet(fileText, findUsed, replaceUsed, replaceAll),
    mode,
    startLine,
    endLine,
  }
}

/**
 * Apply find/replace on file text. Tries exact match first, then CRLF expansion, then LF-normalized match
 * while preserving the file's primary line endings on write.
 */
export function applySnippetEdit(
  fileText: string,
  findText: string,
  replaceText: string,
  replaceAll: boolean,
): SnippetEditResult {
  if (!findText) return { ok: false }

  if (fileText.includes(findText)) {
    return applyReplaceWithRange(fileText, findText, replaceText, replaceAll, 'exact', fileText)
  }

  const eol = detectFileLineEndings(fileText)

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

  const findLf = toLf(findText)
  const fileLf = toLf(fileText)
  if (findLf && fileLf.includes(findLf)) {
    const replaceLf = toLf(replaceText)
    const matchIndex = firstMatchIndex(fileLf, findLf, replaceAll)
    if (matchIndex < 0) return { ok: false }
    const { startLine, endLine } = editLineRange(fileLf, matchIndex, findLf, replaceLf)
    const nextLf = replaceSnippet(fileLf, findLf, replaceLf, replaceAll)
    return {
      ok: true,
      next: restoreLineEndings(nextLf, eol),
      mode: 'normalized',
      startLine,
      endLine,
    }
  }

  return { ok: false }
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
