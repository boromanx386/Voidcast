import type { CodingFileNode, CodingToolResult } from '@/types/coding'
import {
  applySnippetEdit,
  readFileToolDisplayPrefix,
  type FileLineEndings,
} from '@/lib/codingEol'
import { formatSearchResults } from '@/lib/codingSearch'

function missingBridgeResult(action: string): CodingToolResult {
  return { ok: false, text: `${action} is available only in Electron desktop.` }
}

export async function invokePickCodingDirectory(): Promise<{ ok: true; path: string } | { ok: false }> {
  const fn = window.voidcast?.pickCodingDirectory
  if (!fn) return { ok: false }
  return fn()
}

export async function invokeListCodingDirectory(
  projectPath: string,
  path = '',
): Promise<{ ok: true; entries: CodingFileNode[] } | { ok: false; error: string }> {
  const fn = window.voidcast?.codingListDirectory
  if (!fn) return { ok: false, error: 'Not available outside Electron.' }
  const res = await fn({ projectPath, path })
  if (!res.ok) return { ok: false, error: res.error || 'List directory failed.' }
  return { ok: true, entries: res.entries }
}

export async function invokeReadCodingFile(
  projectPath: string,
  filePath: string,
  options?: {
    startLine?: number
    endLine?: number
    maxChars?: number
    allowLargeRead?: boolean
    /** When true, prepend a one-line CRLF hint for the model (not used for internal edit_code reads). */
    forToolDisplay?: boolean
  },
): Promise<CodingToolResult> {
  const fn = window.voidcast?.codingReadFile
  if (!fn) return missingBridgeResult('Read file')
  const res = await fn({
    projectPath,
    path: filePath,
    startLine: options?.startLine,
    endLine: options?.endLine,
    maxChars: options?.maxChars,
    allowLargeRead: options?.allowLargeRead,
  })
  if (!res.ok) return { ok: false, text: res.error || 'Read failed.' }
  const lineEndings: FileLineEndings = res.lineEndings ?? 'lf'
  const numberedView = options?.startLine !== undefined || options?.endLine !== undefined
  const prefix =
    options?.forToolDisplay === true
      ? readFileToolDisplayPrefix(lineEndings, numberedView)
      : ''
  return { ok: true, text: `${prefix}${res.content}` }
}

export async function invokeWriteCodingFile(projectPath: string, path: string, content: string): Promise<CodingToolResult> {
  const fn = window.voidcast?.codingWriteFile
  if (!fn) return missingBridgeResult('Write file')
  const res = await fn({ projectPath, path, content })
  return { ok: res.ok, text: res.ok ? `Saved ${res.path}` : res.error || 'Write failed.' }
}

export async function invokeEditCodingFile(
  projectPath: string,
  path: string,
  findText: string,
  replaceText: string,
  replaceAll = false,
): Promise<CodingToolResult> {
  const read = await invokeReadCodingFile(projectPath, path, { allowLargeRead: true })
  if (!read.ok) return read
  if (!findText) return { ok: false, text: 'find_text must not be empty.' }

  const applied = applySnippetEdit(read.text, findText, replaceText, replaceAll)
  if (!applied.ok) {
    const lineCount = read.text.split(/\r?\n/).length
    return {
      ok: false,
      text: `Target snippet not found (${lineCount} lines; spaces must match). On Windows/CRLF files you can use \\n in find_text — matching is EOL-aware. Prefer edit_code over rewriting the whole file.`,
    }
  }

  const write = await invokeWriteCodingFile(projectPath, path, applied.next)
  if (!write.ok) return write
  const modeNote =
    applied.mode === 'exact'
      ? replaceAll
        ? 'all matches'
        : 'first match'
      : `${applied.mode === 'crlf-expanded' ? 'CRLF-adjusted' : 'EOL-normalized'} ${replaceAll ? 'all matches' : 'first match'}`
  const lineNote = `lines ${applied.startLine}-${applied.endLine}`
  return { ok: true, text: `Edited ${path} (${lineNote}, ${modeNote})` }
}

export async function invokeSearchCodingFiles(
  projectPath: string,
  query: string,
  options?: { pathPrefix?: string; recentFiles?: string[] },
): Promise<CodingToolResult> {
  const fn = window.voidcast?.codingSearchFiles
  if (!fn) return missingBridgeResult('Search files')
  const res = await fn({
    projectPath,
    query,
    pathPrefix: options?.pathPrefix,
    recentFiles: options?.recentFiles,
  })
  if (!res.ok) return { ok: false, text: res.error || 'Search failed.' }
  return { ok: true, text: formatSearchResults(res.result) }
}

export async function invokeGlobCodingFiles(
  projectPath: string,
  options?: { pathPrefix?: string; extensions?: string[]; maxResults?: number },
): Promise<CodingToolResult> {
  const fn = window.voidcast?.codingGlobFiles
  if (!fn) return missingBridgeResult('Glob files')
  const res = await fn({
    projectPath,
    pathPrefix: options?.pathPrefix,
    extensions: options?.extensions,
    maxResults: options?.maxResults,
  })
  if (!res.ok) return { ok: false, text: res.error || 'Glob failed.' }
  if (res.paths.length === 0) return { ok: true, text: 'No matching files.' }
  return { ok: true, text: res.paths.join('\n') }
}

export async function invokeCodingGit(
  projectPath: string,
  options:
    | { mode: 'status' }
    | { mode: 'diff'; path?: string; staged?: boolean }
    | { mode: 'log'; logMaxCount?: number; logPath?: string }
    | { mode: 'show'; showRef?: string; showPath?: string }
    | { mode: 'stage'; path: string }
    | { mode: 'unstage'; path: string }
    | { mode: 'discard'; path: string }
    | { mode: 'discardAll' }
    | { mode: 'commit'; message: string; all?: boolean },
): Promise<CodingToolResult> {
  const fn = window.voidcast?.codingGit
  if (!fn) return missingBridgeResult('Git')
  const payload =
    options.mode === 'status'
      ? { projectPath, mode: 'status' as const }
      : options.mode === 'diff'
        ? {
            projectPath,
            mode: 'diff' as const,
            path: options.path,
            staged: options.staged,
          }
        : options.mode === 'log'
          ? {
              projectPath,
              mode: 'log' as const,
              logMaxCount: options.logMaxCount,
              logPath: options.logPath,
            }
          : options.mode === 'show'
            ? {
                projectPath,
                mode: 'show' as const,
                showRef: options.showRef,
                showPath: options.showPath,
              }
            : options.mode === 'commit'
              ? {
                  projectPath,
                  mode: 'commit' as const,
                  commitMessage: options.message,
                  commitAll: options.all === true,
                }
              : options.mode === 'discardAll'
                ? { projectPath, mode: 'discardAll' as const }
                : {
                    projectPath,
                    mode: options.mode,
                    path: options.path,
                  }
  const res = await fn(payload)
  return { ok: res.ok, text: res.ok ? res.text : res.error || 'Git command failed.' }
}

export async function invokeCheckCodingTypes(
  projectPath: string,
  options?: { pathPrefix?: string; paths?: string[] },
): Promise<CodingToolResult> {
  const fn = window.voidcast?.codingCheckTypes
  if (!fn) return missingBridgeResult('Check types')
  const res = await fn({
    projectPath,
    pathPrefix: options?.pathPrefix,
    paths: options?.paths,
  })
  return { ok: res.ok, text: res.ok ? res.text : res.error || 'Typecheck failed.' }
}

export async function invokeExecuteCodingCommand(
  projectPath: string,
  command: string,
  options?: { timeoutSec?: number; runInBackground?: boolean },
): Promise<CodingToolResult> {
  const fn = window.voidcast?.codingExecuteCommand
  if (!fn) return missingBridgeResult('Execute command')
  const res = await fn({
    projectPath,
    command,
    timeoutSec: options?.timeoutSec,
    runInBackground: options?.runInBackground,
  })
  if (!res.ok) return { ok: false, text: res.error || 'Command failed.' }
  const output = [res.stdout, res.stderr].filter(Boolean).join('\n').trim() || '(no output)'
  return { ok: true, text: `$ ${command}\n${output}` }
}
