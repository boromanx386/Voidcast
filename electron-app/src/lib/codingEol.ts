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
  | { ok: true; next: string; mode: SnippetEditMode }
  | { ok: false }

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
    return {
      ok: true,
      next: replaceSnippet(fileText, findText, replaceText, replaceAll),
      mode: 'exact',
    }
  }

  const eol = detectFileLineEndings(fileText)

  if (eol === 'crlf' && findText.includes('\n') && !findText.includes('\r\n')) {
    const findCrlf = findText.replace(/\n/g, '\r\n')
    const replaceCrlf = replaceText.replace(/\n/g, '\r\n')
    if (fileText.includes(findCrlf)) {
      return {
        ok: true,
        next: replaceSnippet(fileText, findCrlf, replaceCrlf, replaceAll),
        mode: 'crlf-expanded',
      }
    }
  }

  const findLf = toLf(findText)
  if (findLf && toLf(fileText).includes(findLf)) {
    const nextLf = replaceSnippet(toLf(fileText), findLf, toLf(replaceText), replaceAll)
    return {
      ok: true,
      next: restoreLineEndings(nextLf, eol),
      mode: 'normalized',
    }
  }

  return { ok: false }
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
